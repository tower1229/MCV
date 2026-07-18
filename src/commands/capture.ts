import * as fs from 'fs';
import * as path from 'path';
import { createInterface } from 'readline/promises';
import * as yaml from 'yaml';
import { ClaudeCodeAdapter } from '../adapters/claude-code';
import type { CaptureFile, DeviceContext } from '../adapters/types';
import { isRecord, mergeRecords } from '../utils/objects';
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

  if (manifest.targets?.claudeCode?.enabled === false) {
    console.log('Claude Code capture is disabled in mcv.yaml.');
    return;
  }

  const adapter = new ClaudeCodeAdapter();
  const captureContext = {
    ...context,
    variables: resolveManifestVariables(manifest.variables, context),
  };
  const files = await adapter.discoverFiles(captureContext);
  const result = await adapter.capture(files, captureContext);
  const plan = buildCapturePlan(repositoryPath, result.files);

  for (const warning of result.warnings) {
    console.log(`Warning: ${warning}`);
  }

  if (plan.length === 0) {
    console.log('No Claude Code configuration changes to capture.');
    return;
  }

  console.log('Capture preview (sanitized and parameterized):');
  for (const file of plan) {
    console.log(`[${file.change}][${file.ownership}] ${file.repositoryPath}`);
    console.log(file.content.trimEnd());
  }
  console.log(
    `Summary: ${plan.length} file(s), ${result.summary.sensitiveFieldCount} sensitive field(s) replaced, ${result.summary.parameterizedPathCount} path(s) parameterized, ${result.summary.excludedFileCount} sensitive file(s) excluded.`,
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
  targets?: { claudeCode?: { enabled?: boolean } };
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
  return files.flatMap((file) => {
    const destinationPath = path.join(
      repositoryPath,
      ...file.repositoryPath.split('/'),
    );
    const existingContent = fs.existsSync(destinationPath)
      ? fs.readFileSync(destinationPath, 'utf8')
      : undefined;
    const content = mergeWithRepository(file, existingContent);
    if (existingContent === content) return [];

    return [{
      ...file,
      content,
      change: existingContent === undefined ? 'add' : 'modify',
      destinationPath,
    }];
  });
}

function mergeWithRepository(
  file: CaptureFile,
  existingContent: string | undefined,
): string {
  if (existingContent === undefined) return file.content;

  if (file.ownership === 'native' && file.repositoryPath.endsWith('.json')) {
    const existing = JSON.parse(existingContent) as unknown;
    const captured = JSON.parse(file.content) as unknown;
    if (!isRecord(existing) || !isRecord(captured)) {
      throw new Error(`${file.repositoryPath} must contain a JSON object.`);
    }
    return `${JSON.stringify(mergeRecords(existing, captured), null, 2)}\n`;
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
