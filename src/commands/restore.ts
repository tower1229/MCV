import * as fs from 'fs';
import * as path from 'path';
import { atomicWriteFile, atomicWriteTextFile, hashFile } from '../utils/files';
import { isRecord } from '../utils/objects';
import { getStateFilePath, readState, writeState } from '../utils/state';

interface BackupFile {
  action?: 'add' | 'modify' | 'delete';
  originalPath: string;
  backupPath?: string;
  beforeHash?: string;
  afterHash?: string;
}
interface BackupManifest { createdAt: string; files: BackupFile[]; }
interface BackupCandidate { directory: string; manifest: BackupManifest; }

export function restoreLatestBackup(): void {
  const stateDirectory = path.dirname(getStateFilePath());
  const latest = findLatestBackup(path.join(stateDirectory, 'backups'));
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
  const state = readState();
  delete state.baselineSnapshot;
  delete state.managedInventory;
  state.lastOperation = { kind: 'restore', time: new Date().toISOString(), success: true };
  writeState(state);
  console.log(`Current pre-restore state saved to ${restoreBackup}.`);
  console.log(`Restored ${latest.manifest.files.length} file(s) from the latest backup.`);
}

function backupCurrentState(stateDirectory: string, files: BackupFile[]): string {
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

function findLatestBackup(backupRoot: string): BackupCandidate | undefined {
  if (!fs.existsSync(backupRoot)) return undefined;
  return fs.readdirSync(backupRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory()).flatMap((entry) => {
    const directory = path.join(backupRoot, entry.name);
    const manifest = readBackupManifest(path.join(directory, 'manifest.json'));
    return manifest ? [{ directory, manifest }] : [];
  }).sort((left, right) => Date.parse(right.manifest.createdAt) - Date.parse(left.manifest.createdAt))[0];
}

function readBackupManifest(manifestPath: string): BackupManifest | undefined {
  if (!fs.existsSync(manifestPath)) return undefined;
  try {
    const value = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as unknown;
    if (!isRecord(value) || typeof value.createdAt !== 'string' || !Array.isArray(value.files) || !value.files.every((file) => isRecord(file) && typeof file.originalPath === 'string')) return undefined;
    return value as unknown as BackupManifest;
  } catch { return undefined; }
}
