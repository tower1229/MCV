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

interface PlannedDeployFile {
  targetPath: string;
  content: string | Buffer;
  change: 'add' | 'modify' | 'delete';
  write?: (file: DeployFile) => void;
}

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
  const repositoryPath = resolveBoundRepository();
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
  const plan = buildDeployPlan(deployFiles, options.pruneManaged === true ? readState().managedInventory : undefined);
  if (options.yes && plan.some((file) => file.change === 'delete')) throw new Error('--yes never applies deletions; review and confirm --prune-managed interactively.');
  if (plan.length === 0) {
    recordDeploymentBaseline(deployFiles);
    const subject = definitions.length === 1
      ? `${definitions[0].name} configuration is`
      : 'Configurations are';
    console.log(`${subject} already in sync.`);
    return;
  }

  if (options.json) console.log(JSON.stringify({ repositoryPath, changes: plan.map(({ targetPath, change }) => ({ targetPath, change })) }, null, 2));
  else {
    console.log('Deploy preview:');
    for (const file of plan) console.log(`[${file.change}] ${file.targetPath}`);
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

  const backupDirectory = createDeploymentBackup(plan);
  applyDeployTransaction(plan, backupDirectory);
  finalizeDeploymentBackup(backupDirectory, plan);
  recordDeploymentBaseline(deployFiles, repositoryPath);
  console.log(`Deployed ${plan.length} file(s) from ${repositoryPath}.`);
}

function recordDeploymentBaseline(files: DeployFile[], repositoryPath?: string): void {
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
  state.managedInventory = Object.fromEntries(files
    .filter((file) => fs.existsSync(file.targetPath))
    .map((file) => [file.targetPath, { source: repositoryPath ?? 'repository', hash: hashFile(file.targetPath) }]));
  state.lastOperation = { kind: 'deploy', time: new Date().toISOString(), success: true };
  writeState(state);
}

function createDeploymentBackup(plan: PlannedDeployFile[]): string {
  const backupRoot = path.join(path.dirname(getStateFilePath()), 'backups');
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
    `${JSON.stringify({ createdAt: new Date().toISOString(), files }, null, 2)}\n`,
  );
  return backupDirectory;
}

function finalizeDeploymentBackup(backupDirectory: string, plan: PlannedDeployFile[]): void {
  const manifestPath = path.join(backupDirectory, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as { createdAt: string; files: DeploymentBackupEntry[] };
  for (const entry of manifest.files) {
    if (fs.existsSync(entry.originalPath)) entry.afterHash = hashFile(entry.originalPath);
  }
  atomicWriteTextFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

function applyDeployTransaction(plan: PlannedDeployFile[], backupDirectory?: string): void {
  const created: string[] = [];
  try {
    for (const file of plan) {
      if (file.change === 'add') created.push(file.targetPath);
      if (file.change === 'delete') fs.rmSync(file.targetPath, { force: true });
      else file.write!(file);
    }
  } catch (error) {
    for (const targetPath of created) fs.rmSync(targetPath, { force: true });
    if (backupDirectory) {
      const manifest = JSON.parse(fs.readFileSync(path.join(backupDirectory, 'manifest.json'), 'utf8')) as { files: Array<{ originalPath: string; backupPath: string }> };
      for (const file of manifest.files) fs.copyFileSync(path.join(backupDirectory, file.backupPath), file.originalPath);
    }
    throw error;
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

async function confirmInTerminal(): Promise<boolean> {
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await prompt.question('Write these changes to this device? [y/N] ');
    return /^(y|yes)$/i.test(answer.trim());
  } finally {
    prompt.close();
  }
}
