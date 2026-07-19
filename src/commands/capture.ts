import * as fs from 'fs';
import * as path from 'path';
import { createInterface } from 'readline/promises';
import * as yaml from 'yaml';
import { createAdapterDefinitions, type TargetId } from '../adapters';
import type { CaptureFile, DeviceContext } from '../adapters/types';
import { isRecord, mergeRecords } from '../utils/objects';
import {
  parseStructuredObject,
  stringifyStructuredObject,
  type StructuredFormat,
} from '../utils/structured-config';
import { readState } from '../utils/state';

export interface CaptureDependencies {
  confirmCapture?: () => Promise<boolean>;
}

interface PlannedCaptureFile extends CaptureFile {
  change: 'add' | 'modify';
  destinationPath: string;
}

export async function captureConfigurations(
  context: DeviceContext,
  dependencies: CaptureDependencies = {},
): Promise<void> {
  const repositoryPath = resolveRepositoryPath();
  const manifest = readManifest(repositoryPath);
  const definitions = createAdapterDefinitions().filter(
    ({ targetId }) => manifest.targets?.[targetId]?.enabled === true,
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
  const plan = buildCapturePlan(
    repositoryPath,
    results.flatMap((result) => result.files),
  );

  for (const warning of results.flatMap((result) => result.warnings)) {
    console.log(`Warning: ${warning}`);
  }

  if (plan.length === 0) {
    console.log('No configuration changes to capture.');
    return;
  }

  console.log('Capture preview (sanitized and parameterized):');
  for (const file of plan) {
    console.log(`[${file.change}][${file.ownership}] ${file.repositoryPath}`);
    console.log(file.content.trimEnd());
  }
  const summary = results.reduce(
    (total, result) => ({
      sensitiveFieldCount: total.sensitiveFieldCount + result.summary.sensitiveFieldCount,
      parameterizedPathCount: total.parameterizedPathCount + result.summary.parameterizedPathCount,
      excludedFileCount: total.excludedFileCount + result.summary.excludedFileCount,
    }),
    { sensitiveFieldCount: 0, parameterizedPathCount: 0, excludedFileCount: 0 },
  );
  console.log(
    `Summary: ${plan.length} file(s), ${summary.sensitiveFieldCount} sensitive field(s) replaced, ${summary.parameterizedPathCount} path(s) parameterized, ${summary.excludedFileCount} sensitive file(s) excluded.`,
  );

  const confirmed = await (dependencies.confirmCapture ?? confirmInTerminal)();
  if (!confirmed) {
    console.log('Capture cancelled; repository was not changed.');
    return;
  }

  for (const file of plan) {
    fs.mkdirSync(path.dirname(file.destinationPath), { recursive: true });
    fs.writeFileSync(file.destinationPath, file.content, 'utf8');
  }
  console.log(`Captured ${plan.length} file(s) into ${repositoryPath}.`);
}

function resolveRepositoryPath(): string {
  const currentDirectory = process.cwd();
  if (fs.existsSync(path.join(currentDirectory, 'mcv.yaml'))) {
    return currentDirectory;
  }

  const repositoryPath = readState().repositoryPath;
  if (repositoryPath && fs.existsSync(path.join(repositoryPath, 'mcv.yaml'))) {
    return repositoryPath;
  }

  throw new Error('No bound MCV repository found. Run `mcv init` first.');
}

interface CaptureManifest {
  targets?: Partial<Record<TargetId, { enabled?: boolean }>>;
  variables?: Record<string, unknown>;
}

function readManifest(repositoryPath: string): CaptureManifest {
  const manifestPath = path.join(repositoryPath, 'mcv.yaml');
  const parsed: unknown = yaml.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (!isRecord(parsed)) {
    throw new Error(`${manifestPath} must contain a YAML object.`);
  }
  return parsed as CaptureManifest;
}

function buildCapturePlan(
  repositoryPath: string,
  files: CaptureFile[],
): PlannedCaptureFile[] {
  const planned = new Map<string, PlannedCaptureFile>();
  for (const file of files) {
    const destinationPath = path.join(
      repositoryPath,
      ...file.repositoryPath.split('/'),
    );
    const previous = planned.get(destinationPath);
    if (
      previous?.ownership === 'managed'
      && file.ownership === 'managed'
      && file.repositoryPath !== 'common/mcp.yaml'
      && previous.content !== file.content
    ) {
      throw new Error(
        `Conflicting managed captures for ${file.repositoryPath}: ${previous.sourcePath} and ${file.sourcePath}.`,
      );
    }
    const existingContent = previous?.content
      ?? (fs.existsSync(destinationPath)
        ? fs.readFileSync(destinationPath, 'utf8')
        : undefined);
    const content = mergeWithRepository(file, existingContent);
    if (existingContent === content) continue;

    planned.set(destinationPath, {
      ...file,
      content,
      change: fs.existsSync(destinationPath) ? 'modify' : 'add',
      destinationPath,
    });
  }
  return [...planned.values()];
}

function mergeWithRepository(
  file: CaptureFile,
  existingContent: string | undefined,
): string {
  if (existingContent === undefined) return file.content;

  const format = getStructuredFormat(file.repositoryPath);
  if (file.ownership === 'native' && format) {
    const existing = parseStructuredObject(existingContent, format, file.repositoryPath);
    const captured = parseStructuredObject(file.content, format, file.repositoryPath);
    return stringifyStructuredObject(mergeRecords(existing, captured), format);
  }

  if (file.repositoryPath === 'common/mcp.yaml') {
    const existing = yaml.parse(existingContent) as unknown;
    const captured = yaml.parse(file.content) as unknown;
    if (!isRecord(existing) || !isRecord(captured)) {
      throw new Error('common/mcp.yaml must contain a YAML object.');
    }
    return yaml.stringify(mergeRecords(existing, captured));
  }

  return file.content;
}

function getStructuredFormat(repositoryPath: string): StructuredFormat | undefined {
  if (repositoryPath.endsWith('.json')) return 'json';
  if (repositoryPath.endsWith('.yaml') || repositoryPath.endsWith('.yml')) return 'yaml';
  if (repositoryPath.endsWith('.toml')) return 'toml';
  return undefined;
}

function resolveManifestVariables(
  variables: Record<string, unknown> | undefined,
  context: DeviceContext,
): Record<string, string> {
  const platform = context.platform ?? process.platform;
  const platformKey = platform === 'win32'
    ? 'windows'
    : platform === 'darwin'
      ? 'macos'
      : 'linux';
  const resolved: Record<string, string> = {};

  for (const [name, declaration] of Object.entries(variables ?? {})) {
    const value = typeof declaration === 'string'
      ? declaration
      : isRecord(declaration) && typeof declaration[platformKey] === 'string'
        ? declaration[platformKey]
        : undefined;
    if (value) {
      resolved[name] = value.replace(/\$\{HOME\}/g, context.homeDir);
    }
  }
  return resolved;
}

async function confirmInTerminal(): Promise<boolean> {
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await prompt.question('Write these changes to the repository? [y/N] ');
    return /^(y|yes)$/i.test(answer.trim());
  } finally {
    prompt.close();
  }
}
