import * as fs from 'fs';
import * as path from 'path';
import { createInterface } from 'readline/promises';
import * as yaml from 'yaml';
import { createAdapterDefinitions } from '../adapters';
import type { CaptureFile, DeviceContext } from '../adapters/types';
import { collectSkills, getSkillSources, skillPackageToCaptureFiles, type SkillPackage } from '../core/skills';
import { isRecord, mergeRecords } from '../utils/objects';
import { readManifest, resolveBoundRepository } from '../utils/repository';
import { readState, writeState } from '../utils/state';
import { scanTextForSecrets } from '../utils/sanitize';
import {
  parseStructuredObject,
  stringifyStructuredObject,
  deleteObjectPath,
  type StructuredFormat,
} from '../utils/structured-config';

export interface CaptureOptions {
  dryRun?: boolean;
  json?: boolean;
  yes?: boolean;
  verbose?: boolean;
}

export interface CaptureDependencies {
  confirmCapture?: () => Promise<boolean>;
  selectConflict?: (repositoryPath: string, candidates: string[]) => Promise<number | undefined>;
}

interface PlannedCaptureFile extends CaptureFile {
  change: 'add' | 'modify';
  destinationPath: string;
}

export async function captureConfigurations(
  context: DeviceContext,
  dependencies: CaptureDependencies = {},
  options: CaptureOptions = {},
): Promise<void> {
  const repositoryPath = resolveBoundRepository(context);
  const manifest = readManifest(repositoryPath);
  const definitions = createAdapterDefinitions().filter(
    ({ targetId }) => manifest.targets[targetId]?.enabled === true,
  );
  if (definitions.length === 0) {
    console.log('No IDE targets are enabled in mcv.yaml.');
    return;
  }
  const captureContext = {
    ...context,
    variables: resolveManifestVariables(manifest.variables, context),
  };
  const results = await Promise.all(definitions.map(async ({ adapter }) => {
    const files = await adapter.discoverFiles(captureContext);
    return adapter.capture(files, captureContext);
  }));
  const warnings = results.flatMap((result) => result.warnings);
  const skillCollection = collectSkills(getSkillSources(captureContext, {
    codex: manifest.targets.codex?.enabled === true,
    claudeCode: manifest.targets.claudeCode?.enabled === true,
    gemini: manifest.targets.gemini?.enabled === true,
  }));
  warnings.push(...skillCollection.warnings);
  const skillFiles: CaptureFile[] = [];
  for (const [name, copies] of skillCollection.packages) {
    const unique = uniqueSkillCopies(copies);
    let selected = unique[0];
    if (unique.length > 1) {
      const repositorySkill = `common/skills/${name}`;
      const candidates = unique.map((skill) => `${skill.source.surface}: ${skill.directory}`);
      const choice = dependencies.selectConflict
        ? await dependencies.selectConflict(repositorySkill, candidates)
        : options.yes || options.dryRun || !process.stdin.isTTY
          ? undefined
          : await selectConflictInTerminal(repositorySkill, candidates);
      if (choice === undefined || !unique[choice]) {
        warnings.push(`Skipped conflicting Skill ${name}; choose an authoritative source interactively.`);
        continue;
      }
      selected = unique[choice];
    }
    skillFiles.push(...skillPackageToCaptureFiles(selected));
  }
  const mcpResolvedFiles = await resolveMcpConflicts(
    repositoryPath,
    results.flatMap((result) => result.files),
    dependencies,
    options,
    warnings,
  );
  const adapterFiles = await resolveCanonicalConflicts(
    mcpResolvedFiles,
    dependencies,
    options,
  );
  const plan = buildCapturePlan(
    repositoryPath,
    [...adapterFiles, ...skillFiles],
    warnings,
  );
  if (options.yes && warnings.length > 0) {
    throw new Error('--yes refused because the capture plan contains warnings or skipped conflicts; review it interactively.');
  }
  const summary = results.reduce(
    (total, result) => ({
      sensitiveFieldCount: total.sensitiveFieldCount + result.summary.sensitiveFieldCount,
      parameterizedPathCount: total.parameterizedPathCount + result.summary.parameterizedPathCount,
      excludedFileCount: total.excludedFileCount + result.summary.excludedFileCount,
    }),
    { sensitiveFieldCount: 0, parameterizedPathCount: 0, excludedFileCount: skillCollection.excludedFileCount },
  );
  if (options.json) {
    console.log(JSON.stringify({ repositoryPath, changes: plan.map(publicPlan), warnings, summary }, null, 2));
  } else {
    for (const warning of warnings) console.log(`Warning: ${warning}`);
    if (plan.length === 0) {
      console.log('No configuration changes to capture.');
      return;
    }
    console.log('Capture preview (sanitized and parameterized):');
    for (const file of plan) {
      console.log(`[${file.change}][${file.ownership}] ${file.repositoryPath}`);
      if (typeof file.content === 'string') console.log(file.content.trimEnd());
      if (options.verbose && Buffer.isBuffer(file.content)) console.log(`<binary ${file.content.length} bytes>`);
    }
    console.log(`Summary: ${plan.length} file(s), ${summary.sensitiveFieldCount} sensitive field(s) replaced, ${summary.parameterizedPathCount} path(s) parameterized, ${summary.excludedFileCount} file(s) excluded.`);
  }
  if (plan.length === 0 || options.dryRun) return;
  if (!process.stdin.isTTY && !options.yes && !dependencies.confirmCapture) {
    throw new Error('Capture requires an interactive terminal; use --yes only after reviewing --dry-run.');
  }
  const confirmed = options.yes || await (dependencies.confirmCapture ?? confirmInTerminal)();
  if (!confirmed) {
    console.log('Capture cancelled; repository was not changed.');
    return;
  }
  applyCaptureTransaction(plan);
  const state = readState(context);
  state.lastOperation = { kind: 'capture', time: new Date().toISOString(), success: true };
  writeState(context, state);
  console.log(`Captured ${plan.length} file(s) into ${repositoryPath}.`);
}

async function resolveMcpConflicts(
  repositoryPath: string,
  files: CaptureFile[],
  dependencies: CaptureDependencies,
  options: CaptureOptions,
  warnings: string[],
): Promise<CaptureFile[]> {
  const mcpFiles = files.filter((file) => file.repositoryPath === 'common/mcp.yaml' && typeof file.content === 'string');
  if (mcpFiles.length === 0) return files;
  const candidates = [...mcpFiles];
  const existingPath = path.join(repositoryPath, 'common', 'mcp.yaml');
  if (fs.existsSync(existingPath)) candidates.unshift({ sourcePath: existingPath, repositoryPath: 'common/mcp.yaml', content: fs.readFileSync(existingPath, 'utf8'), ownership: 'managed' });
  const byName = new Map<string, Array<{ sourcePath: string; value: Record<string, unknown> }>>();
  for (const candidate of candidates) {
    const parsed = yaml.parse(candidate.content as string) as unknown;
    if (!isRecord(parsed) || !isRecord(parsed.servers)) throw new Error(`${candidate.sourcePath}: MCP registry must contain a servers object.`);
    for (const [name, value] of Object.entries(parsed.servers)) {
      if (!isRecord(value) || /^(node_repl|browser-use|computer-use)$/i.test(name)) {
        if (/^(node_repl|browser-use|computer-use)$/i.test(name)) warnings.push(`Excluded runtime MCP ${name}.`);
        continue;
      }
      byName.set(name, [...(byName.get(name) ?? []), { sourcePath: candidate.sourcePath, value }]);
    }
  }
  const servers: Record<string, unknown> = {};
  for (const [name, copies] of byName) {
    const unique = copies.filter((copy, index) => copies.findIndex((other) => stableValue(other.value) === stableValue(copy.value)) === index);
    if (unique.length === 1) { servers[name] = unique[0].value; continue; }
    const sameCore = unique.every((copy) => stableValue(withoutOverrides(copy.value)) === stableValue(withoutOverrides(unique[0].value)));
    if (sameCore) {
      servers[name] = withoutOverrides(unique[0].value);
      continue;
    }
    const choice = dependencies.selectConflict
      ? await dependencies.selectConflict(`common/mcp.yaml#${name}`, unique.map((copy) => copy.sourcePath))
      : options.yes || options.dryRun || !process.stdin.isTTY ? undefined : await selectConflictInTerminal(`MCP ${name}`, unique.map((copy) => copy.sourcePath));
    if (choice === undefined || !unique[choice]) {
      warnings.push(`Skipped conflicting MCP ${name}; choose an authoritative source interactively.`);
      continue;
    }
    servers[name] = unique[choice].value;
  }
  const sourcePath = mcpFiles.map((file) => file.sourcePath).join(', ');
  return [...files.filter((file) => file.repositoryPath !== 'common/mcp.yaml'), { sourcePath, repositoryPath: 'common/mcp.yaml', content: yaml.stringify({ servers }), ownership: 'managed' }];
}

function withoutOverrides(value: Record<string, unknown>): Record<string, unknown> {
  const copy = { ...value };
  delete copy.overrides;
  return copy;
}

function stableValue(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableValue).join(',')}]`;
  if (isRecord(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableValue(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

async function resolveCanonicalConflicts(
  files: CaptureFile[],
  dependencies: CaptureDependencies,
  options: CaptureOptions,
): Promise<CaptureFile[]> {
  const result: CaptureFile[] = [];
  const groups = new Map<string, CaptureFile[]>();
  for (const file of files) groups.set(file.repositoryPath, [...(groups.get(file.repositoryPath) ?? []), file]);
  for (const [repositoryPath, candidates] of groups) {
    if (repositoryPath === 'common/mcp.yaml' || candidates.length === 1) {
      result.push(...candidates);
      continue;
    }
    const unique = candidates.filter((candidate, index) => candidates.findIndex((other) => sameContent(other.content, candidate.content)) === index);
    if (unique.length === 1) {
      result.push(unique[0]);
      continue;
    }
    const labels = unique.map((candidate) => candidate.sourcePath);
    const choice = dependencies.selectConflict
      ? await dependencies.selectConflict(repositoryPath, labels)
      : options.yes || options.dryRun || !process.stdin.isTTY
        ? undefined
        : await selectConflictInTerminal(repositoryPath, labels);
    if (choice === undefined || !unique[choice]) {
      throw new Error(`Conflicting managed captures for ${repositoryPath}; choose an authoritative source interactively.`);
    }
    result.push(unique[choice]);
  }
  return result;
}

function uniqueSkillCopies(copies: SkillPackage[]): SkillPackage[] {
  const seen = new Set<string>();
  return copies.filter((copy) => !seen.has(copy.hash) && seen.add(copy.hash));
}

function buildCapturePlan(repositoryPath: string, files: CaptureFile[], warnings: string[]): PlannedCaptureFile[] {
  const planned = new Map<string, PlannedCaptureFile>();
  for (const file of files) {
    const contentBuffer = toBuffer(file.content);
    if (!contentBuffer.subarray(0, Math.min(contentBuffer.length, 8_192)).includes(0)) {
      const findings = scanTextForSecrets(contentBuffer.toString('utf8'));
      if (findings.length > 0) throw new Error(`Blocked ${file.sourcePath}: suspected plaintext secret (${findings.join(', ')}).`);
    }
    const destinationPath = path.join(repositoryPath, ...file.repositoryPath.split('/'));
    const previous = planned.get(destinationPath);
    if (previous && !sameContent(previous.content, file.content) && file.repositoryPath !== 'common/mcp.yaml') {
      warnings.push(`Skipped conflict for ${file.repositoryPath}: ${previous.sourcePath} vs ${file.sourcePath}`);
      continue;
    }
    const existingBuffer = previous
      ? toBuffer(previous.content)
      : fs.existsSync(destinationPath) ? fs.readFileSync(destinationPath) : undefined;
    const content = mergeWithRepository(file, existingBuffer);
    if (existingBuffer?.equals(toBuffer(content))) continue;
    planned.set(destinationPath, {
      ...file,
      content,
      change: fs.existsSync(destinationPath) ? 'modify' : 'add',
      destinationPath,
    });
  }
  return [...planned.values()];
}

function mergeWithRepository(file: CaptureFile, existingBuffer: Buffer | undefined): string | Buffer {
  if (!existingBuffer) return file.content;
  if (Buffer.isBuffer(file.content)) return file.content;
  const existingContent = existingBuffer.toString('utf8');
  const format = getStructuredFormat(file.repositoryPath);
  if (file.ownership === 'native' && format) {
    if (format === 'json') {
      const existingValue = JSON.parse(existingContent) as unknown;
      const capturedValue = JSON.parse(file.content) as unknown;
      if (!isRecord(existingValue) || !isRecord(capturedValue)) return file.content;
    }
    const existing = parseStructuredObject(existingContent, format, file.repositoryPath);
    const captured = parseStructuredObject(file.content, format, file.repositoryPath);
    const merged = mergeRecords(existing, captured);
    for (const localPath of file.localPaths ?? []) deleteObjectPath(merged, localPath);
    return stringifyStructuredObject(merged, format);
  }
  if (file.repositoryPath === 'common/mcp.yaml') {
    const captured = yaml.parse(file.content) as unknown;
    if (!isRecord(captured)) throw new Error('common/mcp.yaml must contain a YAML object.');
    return file.content;
  }
  return file.content;
}

function applyCaptureTransaction(plan: PlannedCaptureFile[]): void {
  const originals = new Map<string, Buffer | undefined>();
  try {
    for (const file of plan) {
      originals.set(file.destinationPath, fs.existsSync(file.destinationPath) ? fs.readFileSync(file.destinationPath) : undefined);
      fs.mkdirSync(path.dirname(file.destinationPath), { recursive: true });
      const temp = `${file.destinationPath}.mcv-${process.pid}.tmp`;
      fs.writeFileSync(temp, file.content);
      fs.renameSync(temp, file.destinationPath);
    }
  } catch (error) {
    for (const [destination, original] of originals) {
      if (original === undefined) fs.rmSync(destination, { force: true });
      else fs.writeFileSync(destination, original);
    }
    throw error;
  }
}

function getStructuredFormat(repositoryPath: string): StructuredFormat | undefined {
  if (repositoryPath.endsWith('.json')) return 'json';
  if (repositoryPath.endsWith('.yaml') || repositoryPath.endsWith('.yml')) return 'yaml';
  if (repositoryPath.endsWith('.toml')) return 'toml';
  return undefined;
}

function resolveManifestVariables(variables: Record<string, unknown> | undefined, context: DeviceContext): Record<string, string> {
  const platform = context.platform;
  const key = platform === 'win32' ? 'windows' : platform === 'darwin' ? 'macos' : 'linux';
  return Object.fromEntries(Object.entries(variables ?? {}).flatMap(([name, declaration]) => {
    const value = typeof declaration === 'string' ? declaration : isRecord(declaration) && typeof declaration[key] === 'string' ? declaration[key] : undefined;
    return value ? [[name, value.replace(/\$\{HOME\}/g, context.homeDir)]] : [];
  }));
}

function publicPlan(file: PlannedCaptureFile): object {
  return { change: file.change, ownership: file.ownership, repositoryPath: file.repositoryPath, sourcePath: file.sourcePath, bytes: toBuffer(file.content).length };
}
function toBuffer(content: string | Buffer): Buffer { return Buffer.isBuffer(content) ? content : Buffer.from(content); }
function sameContent(left: string | Buffer, right: string | Buffer): boolean { return toBuffer(left).equals(toBuffer(right)); }

async function confirmInTerminal(): Promise<boolean> {
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  try { return /^(y|yes)$/i.test((await prompt.question('Write these changes to the repository? [y/N] ')).trim()); }
  finally { prompt.close(); }
}

async function selectConflictInTerminal(name: string, candidates: string[]): Promise<number | undefined> {
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  try {
    console.log(`Conflict: ${name}`);
    candidates.forEach((candidate, index) => console.log(`  ${index + 1}. ${candidate}`));
    const answer = Number(await prompt.question('Choose authoritative source (blank to skip): '));
    return Number.isInteger(answer) && answer > 0 && answer <= candidates.length ? answer - 1 : undefined;
  } finally { prompt.close(); }
}
