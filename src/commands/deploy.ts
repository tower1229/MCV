import * as fs from 'fs';
import * as path from 'path';
import { createInterface } from 'readline/promises';
import { createAdapterDefinitions, type TargetId } from '../adapters';
import type { DeployFile, DeviceContext } from '../adapters/types';
import { atomicWriteTextFile, hashFile } from '../utils/files';
import { isRecord } from '../utils/objects';
import { getStateFilePath, readState, writeState } from '../utils/state';
import { resolveVariableDefinitions } from '../utils/variables';
import { readManifest, resolveBoundRepository } from '../utils/repository';

export interface DeployDependencies {
  confirmDeploy?: () => Promise<boolean>;
}

export interface DeployOptions { dryRun?: boolean; json?: boolean; yes?: boolean; pruneManaged?: boolean; }

interface DeployManifest {
  targets?: Partial<Record<TargetId, { enabled?: boolean }>>;
  variables?: Record<string, unknown>;
}

export interface PlannedDeployFile {
  targetPath: string;
  content: string | Buffer;
  change: 'add' | 'modify' | 'delete';
  write?: (file: DeployFile) => void;
}

interface LegacySkillDuplicates {
  names: string[];
  files: string[];
}

interface DeployTransactionIo { remove(targetPath: string): void; }

interface DeploymentBackupEntry {
  action: 'add' | 'modify' | 'delete';
  originalPath: string;
  backupPath?: string;
  beforeHash?: string;
  afterHash?: string;
}

export async function deployConfigurations(
  context: DeviceContext,
  dependencies: DeployDependencies = {},
  options: DeployOptions = {},
): Promise<void> {
  const repositoryPath = resolveBoundRepository(context);
  const manifest = readManifest(repositoryPath);
  const definitions = createAdapterDefinitions().filter(
    ({ targetId }) => manifest.targets?.[targetId]?.enabled === true,
  );
  if (definitions.length === 0) {
    console.log('No IDE targets are enabled in mcv.yaml.');
    return;
  }

  const variables = resolveManifestVariables(
    manifest.variables,
    context,
    repositoryPath,
  );
  const operations = await Promise.all(definitions.map(async (definition) => ({
    definition,
    operation: await definition.adapter.deploy(repositoryPath, {
      ...context,
      variables,
    }),
  })));
  const deployFiles = operations.flatMap(({ operation }) =>
    operation.files.map((file) => ({ ...file, write: operation.write })),
  );
  const skippedLinks = new Map<string, string>();
  const safeDeployFiles = deployFiles.filter((file) => {
    const link = findSymbolicLinkAncestor(file.targetPath);
    if (!link) return true;
    skippedLinks.set(file.targetPath, link);
    return false;
  });
  const legacySkillDuplicates = findLegacyCodexSkillDuplicates(
    context,
    safeDeployFiles,
    definitions.some(({ targetId }) => targetId === 'codex'),
  );
  const state = options.pruneManaged === true ? readState(context) : undefined;
  const managedInventory = state?.managedInventory ?? {};
  for (const targetPath of legacySkillDuplicates.files) {
    managedInventory[targetPath] = { source: 'codex-legacy-duplicate', hash: hashFile(targetPath) };
  }
  const plan = buildDeployPlan(safeDeployFiles, options.pruneManaged === true ? managedInventory : undefined);
  if (options.yes && plan.some((file) => file.change === 'delete')) throw new Error('--yes never applies deletions; review and confirm --prune-managed interactively.');
  if (plan.length === 0) {
    recordDeploymentBaseline(context, safeDeployFiles, repositoryPath);
    if (options.json) console.log(JSON.stringify({ repositoryPath, changes: [], skipped: [...skippedLinks].map(([targetPath, linkPath]) => ({ targetPath, reason: 'symbolic-link-ancestor', linkPath })), legacySkillDuplicates: legacySkillDuplicates.names }, null, 2));
    else {
      reportSkippedLinks(skippedLinks);
      reportLegacySkillDuplicates(legacySkillDuplicates);
    }
    const subject = definitions.length === 1
      ? `${definitions[0].name} configuration is`
      : 'Configurations are';
    console.log(`${subject} already in sync.`);
    return;
  }

  if (options.json) console.log(JSON.stringify({ repositoryPath, changes: plan.map(({ targetPath, change }) => ({ targetPath, change })), skipped: [...skippedLinks].map(([targetPath, linkPath]) => ({ targetPath, reason: 'symbolic-link-ancestor', linkPath })), legacySkillDuplicates: options.pruneManaged ? [] : legacySkillDuplicates.names }, null, 2));
  else {
    console.log('Deploy preview:');
    for (const file of plan) console.log(`[${file.change}] ${file.targetPath}`);
    reportSkippedLinks(skippedLinks);
    if (!options.pruneManaged) reportLegacySkillDuplicates(legacySkillDuplicates);
  }
  if (options.dryRun) return;
  if (!process.stdin.isTTY && !options.yes && !dependencies.confirmDeploy) {
    throw new Error('Deploy requires an interactive terminal; use --yes only after reviewing --dry-run.');
  }

  const confirmed = options.yes || await (dependencies.confirmDeploy ?? confirmInTerminal)();
  if (!confirmed) {
    console.log('Deploy cancelled; local configuration was not changed.');
    return;
  }

  const backupDirectory = createDeploymentBackup(context, plan);
  try {
    applyDeployTransaction(plan, backupDirectory);
  } catch (error) {
    markDeploymentBackupFailed(backupDirectory, error);
    const state = readState(context);
    state.lastOperation = { kind: 'deploy', time: new Date().toISOString(), success: false };
    writeState(context, state);
    throw error;
  }
  finalizeDeploymentBackup(backupDirectory, plan);
  recordDeploymentBaseline(context, safeDeployFiles, repositoryPath);
  console.log(`Deployed ${plan.length} file(s) from ${repositoryPath}.`);
}

function reportSkippedLinks(skippedLinks: Map<string, string>): void {
  const counts = new Map<string, number>();
  for (const linkPath of skippedLinks.values()) counts.set(linkPath, (counts.get(linkPath) ?? 0) + 1);
  for (const [linkPath, count] of counts) console.log(`[skip:symlink] ${count} file(s) under ${linkPath}`);
}

function reportLegacySkillDuplicates(duplicates: LegacySkillDuplicates): void {
  if (duplicates.names.length === 0) return;
  console.log(`[duplicate:codex-legacy] ${duplicates.names.join(', ')}; run deploy --prune-managed to remove the backed-up legacy copies.`);
}

function findLegacyCodexSkillDuplicates(
  context: DeviceContext,
  deployFiles: DeployFile[],
  codexEnabled: boolean,
): LegacySkillDuplicates {
  if (!codexEnabled) return { names: [], files: [] };
  const officialRoot = path.resolve(context.homeDir, '.agents', 'skills');
  const codexHome = context.env.CODEX_HOME || path.join(context.homeDir, '.codex');
  const legacyRoot = path.resolve(codexHome, 'skills');
  if (samePath(officialRoot, legacyRoot, context.platform) || findSymbolicLinkAncestor(legacyRoot)) {
    return { names: [], files: [] };
  }

  const desiredBySkill = new Map<string, Map<string, Buffer>>();
  for (const file of deployFiles) {
    const relativePath = path.relative(officialRoot, path.resolve(file.targetPath));
    if (!relativePath || relativePath.startsWith(`..${path.sep}`) || path.isAbsolute(relativePath)) continue;
    const [skillName, ...rest] = relativePath.split(path.sep);
    if (!skillName || rest.length === 0) continue;
    const skillFiles = desiredBySkill.get(skillName) ?? new Map<string, Buffer>();
    skillFiles.set(rest.join('/'), Buffer.isBuffer(file.content) ? file.content : Buffer.from(file.content));
    desiredBySkill.set(skillName, skillFiles);
  }

  const names: string[] = [];
  const files: string[] = [];
  for (const [skillName, desiredFiles] of desiredBySkill) {
    const legacySkillRoot = path.join(legacyRoot, skillName);
    const legacyFiles = collectRegularFiles(legacySkillRoot);
    if (!legacyFiles || legacyFiles.size !== desiredFiles.size) continue;
    const exactDuplicate = [...desiredFiles].every(([relativePath, content]) => {
      const legacyPath = legacyFiles.get(relativePath);
      return legacyPath !== undefined && fs.readFileSync(legacyPath).equals(content);
    });
    if (!exactDuplicate) continue;
    names.push(skillName);
    files.push(...legacyFiles.values());
  }
  return { names: names.sort(), files: files.sort() };
}

function collectRegularFiles(root: string): Map<string, string> | undefined {
  if (!fs.existsSync(root) || fs.lstatSync(root).isSymbolicLink()) return undefined;
  const files = new Map<string, string>();
  const visit = (directory: string): boolean => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) return false;
      const current = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!visit(current)) return false;
      } else if (entry.isFile()) {
        files.set(path.relative(root, current).replace(/\\/g, '/'), current);
      }
    }
    return true;
  };
  return visit(root) ? files : undefined;
}

function samePath(left: string, right: string, platform: NodeJS.Platform | undefined): boolean {
  return platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right;
}

function recordDeploymentBaseline(context: DeviceContext, files: DeployFile[], repositoryPath?: string): void {
  const state = readState(context);
  state.baselineSnapshot = {
    recordedAt: new Date().toISOString(),
    files: Object.fromEntries(
      files
        .filter((file) => fs.existsSync(file.targetPath))
        .map((file) => [
          file.targetPath,
          hashFile(file.targetPath),
        ]),
    ),
  };
  state.managedInventory = Object.fromEntries(files
    .filter((file) => fs.existsSync(file.targetPath))
    .map((file) => [file.targetPath, { source: repositoryPath ?? 'repository', hash: hashFile(file.targetPath) }]));
  state.lastOperation = { kind: 'deploy', time: new Date().toISOString(), success: true };
  writeState(context, state);
}

function createDeploymentBackup(context: DeviceContext, plan: PlannedDeployFile[]): string {
  const backupRoot = path.join(path.dirname(getStateFilePath(context)), 'backups');
  fs.mkdirSync(backupRoot, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDirectory = fs.mkdtempSync(path.join(backupRoot, `${timestamp}-`));
  const filesDirectory = path.join(backupDirectory, 'files');
  fs.mkdirSync(filesDirectory);
  const files: DeploymentBackupEntry[] = plan.map((file, index) => {
    if (file.change === 'add') return { action: 'add', originalPath: file.targetPath };
    const backupPath = path.join('files', `${index}-${path.basename(file.targetPath)}`);
    fs.copyFileSync(file.targetPath, path.join(backupDirectory, backupPath));
    return { action: file.change, originalPath: file.targetPath, backupPath, beforeHash: hashFile(file.targetPath) };
  });
  atomicWriteTextFile(
    path.join(backupDirectory, 'manifest.json'),
    `${JSON.stringify({ createdAt: new Date().toISOString(), status: 'pending', files }, null, 2)}\n`,
  );
  return backupDirectory;
}

function finalizeDeploymentBackup(backupDirectory: string, plan: PlannedDeployFile[]): void {
  const manifestPath = path.join(backupDirectory, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as { createdAt: string; status?: string; completedAt?: string; files: DeploymentBackupEntry[] };
  for (const entry of manifest.files) {
    if (fs.existsSync(entry.originalPath)) entry.afterHash = hashFile(entry.originalPath);
  }
  manifest.status = 'complete';
  manifest.completedAt = new Date().toISOString();
  atomicWriteTextFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

function markDeploymentBackupFailed(backupDirectory: string, error: unknown): void {
  const manifestPath = path.join(backupDirectory, 'manifest.json');
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as Record<string, unknown>;
    manifest.status = 'failed';
    manifest.failedAt = new Date().toISOString();
    manifest.error = error instanceof Error ? error.message : String(error);
    atomicWriteTextFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  } catch { /* Preserve the primary deployment error if failure recording itself fails. */ }
}

export function applyDeployTransaction(
  plan: PlannedDeployFile[],
  backupDirectory?: string,
  io: DeployTransactionIo = { remove: (targetPath) => fs.rmSync(targetPath, { force: true }) },
): void {
  const created: string[] = [];
  try {
    for (const file of plan) {
      if (file.change === 'delete') io.remove(file.targetPath);
      else {
        file.write!(file);
        if (file.change === 'add') created.push(file.targetPath);
      }
    }
  } catch (error) {
    const rollbackErrors: unknown[] = [];
    for (const targetPath of created.reverse()) {
      try { io.remove(targetPath); } catch (rollbackError) { rollbackErrors.push(rollbackError); }
    }
    if (backupDirectory) {
      const manifest = JSON.parse(fs.readFileSync(path.join(backupDirectory, 'manifest.json'), 'utf8')) as { files: Array<{ originalPath: string; backupPath: string }> };
      for (const file of manifest.files) {
        if (!file.backupPath) continue;
        try { fs.copyFileSync(path.join(backupDirectory, file.backupPath), file.originalPath); } catch (rollbackError) { rollbackErrors.push(rollbackError); }
      }
    }
    if (rollbackErrors.length > 0) throw new AggregateError([error, ...rollbackErrors], `Deployment failed and rollback encountered ${rollbackErrors.length} additional error(s).`, { cause: error });
    throw error;
  }
}

export function findSymbolicLinkAncestor(targetPath: string): string | undefined {
  let current = path.resolve(targetPath);
  while (true) {
    try { if (fs.lstatSync(current).isSymbolicLink()) return current; } catch { /* Missing descendants are expected. */ }
    const parent = path.dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

function buildDeployPlan(
  files: Array<DeployFile & { write: (file: DeployFile) => void }>,
  managedInventory?: Record<string, { source: string; hash: string }>,
): PlannedDeployFile[] {
  const desiredPaths = new Set(files.map((file) => file.targetPath));
  const changes: PlannedDeployFile[] = files.flatMap((file) => {
    const existingContent = fs.existsSync(file.targetPath)
      ? fs.readFileSync(file.targetPath)
      : undefined;
    const desiredContent = Buffer.isBuffer(file.content)
      ? file.content
      : Buffer.from(file.content);
    if (existingContent?.equals(desiredContent)) return [];
    return [{
      ...file,
      change: existingContent === undefined ? 'add' as const : 'modify' as const,
    }];
  });
  const deletions: PlannedDeployFile[] = Object.keys(managedInventory ?? {}).flatMap((targetPath) =>
    desiredPaths.has(targetPath) || !fs.existsSync(targetPath) ? [] : [{ targetPath, content: Buffer.alloc(0), change: 'delete' as const }]);
  return [...changes, ...deletions];
}

function resolveManifestVariables(
  declarations: Record<string, unknown> | undefined,
  context: DeviceContext,
  repositoryPath: string,
): Record<string, string> {
  const platform = context.platform;
  const platformKey = platform === 'win32'
    ? 'windows'
    : platform === 'darwin'
      ? 'macos'
      : 'linux';
  const definitions: Record<string, string> = {};

  for (const [name, declaration] of Object.entries(declarations ?? {})) {
    const value = typeof declaration === 'string'
      ? declaration
      : isRecord(declaration) && typeof declaration[platformKey] === 'string'
        ? declaration[platformKey]
        : undefined;
    if (value !== undefined) {
      definitions[name] = value;
    }
  }
  return resolveVariableDefinitions(
    definitions,
    {
      ...context.variables,
      HOME: context.homeDir,
      MCV_REPO: repositoryPath,
    },
    platform,
  );
}

async function confirmInTerminal(): Promise<boolean> {
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await prompt.question('Write these changes to this device? [y/N] ');
    return /^(y|yes)$/i.test(answer.trim());
  } finally {
    prompt.close();
  }
}
