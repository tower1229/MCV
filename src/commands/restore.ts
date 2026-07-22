import * as fs from 'fs';
import * as path from 'path';
import { atomicWriteFile, atomicWriteTextFile, hashFile } from '../utils/files';
import { getStateFilePath, readState, writeState } from '../utils/state';
import type { DeviceContext } from '../adapters/types';
import { readManifest } from '../utils/repository';
import {
  createRestorePlan,
  findLatestVerifiedBackup,
  type DeployBackupFile,
} from '../operations/restore';
import { renderJson } from '../renderers/json';
import { renderRestorePlanPlain } from '../renderers/restore';

export interface RestoreOptions {
  dryRun?: boolean;
  json?: boolean;
}

export function restoreLatestBackup(
  context: DeviceContext,
  options: RestoreOptions = {},
): void {
  if (options.dryRun) {
    const plan = createRestorePlan(context);
    if (options.json) console.log(renderJson(plan));
    else for (const line of renderRestorePlanPlain(plan)) console.log(line);
    if (plan.status === 'failed') process.exitCode = 1;
    return;
  }
  const boundRepositoryPath = readState(context).repositoryPath;
  if (boundRepositoryPath) readManifest(boundRepositoryPath);
  const stateDirectory = path.dirname(getStateFilePath(context));
  const latest = findLatestVerifiedBackup(path.join(stateDirectory, 'backups'));
  if (!latest) throw new Error('No deployment backup found.');

  for (const file of latest.manifest.files) {
    if (!file.afterHash) continue;
    if (!fs.existsSync(file.originalPath) || hashFile(file.originalPath) !== file.afterHash) {
      throw new Error(`Refusing to restore because the deployed file changed afterwards: ${file.originalPath}`);
    }
  }

  const restoreBackup = backupCurrentState(stateDirectory, latest.manifest.files);
  const originals = new Map<string, Buffer | undefined>();
  try {
    for (const file of latest.manifest.files) {
      originals.set(file.originalPath, fs.existsSync(file.originalPath) ? fs.readFileSync(file.originalPath) : undefined);
      const action = file.action ?? 'modify';
      if (action === 'add') {
        fs.rmSync(file.originalPath, { force: true });
        console.log(`[removed] ${file.originalPath}`);
        continue;
      }
      if (!file.backupPath) throw new Error(`Backup path is missing for ${file.originalPath}.`);
      const sourcePath = resolveBackupPath(latest.directory, file.backupPath);
      atomicWriteFile(file.originalPath, fs.readFileSync(sourcePath));
      console.log(`[restored] ${file.originalPath}`);
    }
  } catch (error) {
    for (const [targetPath, content] of originals) {
      if (content === undefined) fs.rmSync(targetPath, { force: true });
      else atomicWriteFile(targetPath, content);
    }
    throw error;
  }
  const state = readState(context);
  delete state.baselineSnapshot;
  delete state.managedInventory;
  state.lastOperation = { kind: 'restore', time: new Date().toISOString(), success: true };
  writeState(context, state);
  console.log(`Current pre-restore state saved to ${restoreBackup}.`);
  console.log(`Restored ${latest.manifest.files.length} file(s) from the latest backup.`);
}

function backupCurrentState(
  stateDirectory: string,
  files: DeployBackupFile[],
): string {
  const root = path.join(stateDirectory, 'restore-backups');
  fs.mkdirSync(root, { recursive: true });
  const directory = fs.mkdtempSync(path.join(root, 'before-restore-'));
  const entries = files.flatMap((file, index) => {
    if (!fs.existsSync(file.originalPath)) return [];
    const backupPath = path.join('files', `${index}-${path.basename(file.originalPath)}`);
    fs.mkdirSync(path.dirname(path.join(directory, backupPath)), { recursive: true });
    fs.copyFileSync(file.originalPath, path.join(directory, backupPath));
    return [{ originalPath: file.originalPath, backupPath, hash: hashFile(file.originalPath) }];
  });
  atomicWriteTextFile(path.join(directory, 'manifest.json'), `${JSON.stringify({ createdAt: new Date().toISOString(), files: entries }, null, 2)}\n`);
  return directory;
}

function resolveBackupPath(directory: string, backupPath: string): string {
  const sourcePath = path.resolve(directory, backupPath);
  const relativePath = path.relative(directory, sourcePath);
  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) throw new Error(`Backup file path escapes its backup directory: ${backupPath}`);
  if (!fs.existsSync(sourcePath)) throw new Error(`Backup file is missing: ${sourcePath}`);
  return sourcePath;
}
