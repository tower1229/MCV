import * as fs from 'fs';
import * as path from 'path';
import { createInterface } from 'readline/promises';
import * as yaml from 'yaml';
import { ClaudeCodeAdapter } from '../adapters/claude-code';
import type { DeployFile, DeviceContext } from '../adapters/types';
import { atomicWriteTextFile, hashFile } from '../utils/files';
import { isRecord } from '../utils/objects';
import { getStateFilePath, readState, writeState } from '../utils/state';
import { resolveVariableDefinitions } from '../utils/variables';

export interface DeployDependencies {
  confirmDeploy?: () => Promise<boolean>;
}

interface DeployManifest {
  targets?: { claudeCode?: { enabled?: boolean } };
  variables?: Record<string, unknown>;
}

interface PlannedDeployFile {
  targetPath: string;
  content: string | Buffer;
  change: 'add' | 'modify';
}

export async function deployConfigurations(
  context: DeviceContext,
  dependencies: DeployDependencies = {},
): Promise<void> {
  const repositoryPath = resolveRepositoryPath();
  const manifest = readManifest(repositoryPath);
  if (manifest.targets?.claudeCode?.enabled === false) {
    console.log('Claude Code deploy is disabled in mcv.yaml.');
    return;
  }

  const variables = resolveManifestVariables(
    manifest.variables,
    context,
    repositoryPath,
  );
  const adapter = new ClaudeCodeAdapter();
  const operation = await adapter.deploy(repositoryPath, {
    ...context,
    variables,
  });
  const plan = buildDeployPlan(operation.files);
  if (plan.length === 0) {
    recordDeploymentBaseline(operation.files);
    console.log('Claude Code configuration is already in sync.');
    return;
  }

  console.log('Deploy preview:');
  for (const file of plan) {
    console.log(`[${file.change}] ${file.targetPath}`);
  }

  const confirmed = await (dependencies.confirmDeploy ?? confirmInTerminal)();
  if (!confirmed) {
    console.log('Deploy cancelled; local configuration was not changed.');
    return;
  }

  backupModifiedFiles(plan);
  for (const file of plan) {
    operation.write(file);
  }
  recordDeploymentBaseline(operation.files);
  console.log(`Deployed ${plan.length} file(s) from ${repositoryPath}.`);
}

function recordDeploymentBaseline(files: DeployFile[]): void {
  const state = readState();
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
  writeState(state);
}

function backupModifiedFiles(plan: PlannedDeployFile[]): void {
  const modifiedFiles = plan.filter((file) => file.change === 'modify');
  if (modifiedFiles.length === 0) return;

  const backupRoot = path.join(path.dirname(getStateFilePath()), 'backups');
  fs.mkdirSync(backupRoot, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDirectory = fs.mkdtempSync(path.join(backupRoot, `${timestamp}-`));
  const filesDirectory = path.join(backupDirectory, 'files');
  fs.mkdirSync(filesDirectory);
  const files = modifiedFiles.map((file, index) => {
    const backupPath = path.join('files', `${index}-${path.basename(file.targetPath)}`);
    fs.copyFileSync(file.targetPath, path.join(backupDirectory, backupPath));
    return { originalPath: file.targetPath, backupPath };
  });
  atomicWriteTextFile(
    path.join(backupDirectory, 'manifest.json'),
    `${JSON.stringify({ createdAt: new Date().toISOString(), files }, null, 2)}\n`,
  );
}

function buildDeployPlan(files: DeployFile[]): PlannedDeployFile[] {
  return files.flatMap((file) => {
    const existingContent = fs.existsSync(file.targetPath)
      ? fs.readFileSync(file.targetPath)
      : undefined;
    const desiredContent = Buffer.isBuffer(file.content)
      ? file.content
      : Buffer.from(file.content);
    if (existingContent?.equals(desiredContent)) return [];
    return [{
      ...file,
      change: existingContent === undefined ? 'add' : 'modify',
    }];
  });
}

function resolveManifestVariables(
  declarations: Record<string, unknown> | undefined,
  context: DeviceContext,
  repositoryPath: string,
): Record<string, string> {
  const platform = context.platform ?? process.platform;
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

function readManifest(repositoryPath: string): DeployManifest {
  const manifestPath = path.join(repositoryPath, 'mcv.yaml');
  const parsed = yaml.parse(fs.readFileSync(manifestPath, 'utf8')) as unknown;
  if (!isRecord(parsed)) {
    throw new Error(`${manifestPath} must contain a YAML object.`);
  }
  return parsed as DeployManifest;
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
