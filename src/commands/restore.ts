import * as fs from 'fs';
import * as path from 'path';
import { atomicWriteFile } from '../utils/files';
import { isRecord } from '../utils/objects';
import { getStateFilePath } from '../utils/state';

interface BackupManifest {
  createdAt: string;
  files: Array<{ originalPath: string; backupPath: string }>;
}

interface BackupCandidate {
  directory: string;
  manifest: BackupManifest;
}

export function restoreLatestBackup(): void {
  const backupRoot = path.join(path.dirname(getStateFilePath()), 'backups');
  const latest = findLatestBackup(backupRoot);
  if (!latest) {
    throw new Error('No deployment backup found.');
  }

  const files = latest.manifest.files.map((file) => {
    const sourcePath = path.resolve(latest.directory, file.backupPath);
    const relativePath = path.relative(latest.directory, sourcePath);
    if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
      throw new Error(`Backup file path escapes its backup directory: ${file.backupPath}`);
    }
    if (!fs.existsSync(sourcePath)) {
      throw new Error(`Backup file is missing: ${sourcePath}`);
    }
    return { targetPath: file.originalPath, content: fs.readFileSync(sourcePath) };
  });

  for (const file of files) {
    atomicWriteFile(file.targetPath, file.content);
    console.log(`[restored] ${file.targetPath}`);
  }
  console.log(`Restored ${files.length} file(s) from the latest backup.`);
}

function findLatestBackup(backupRoot: string): BackupCandidate | undefined {
  if (!fs.existsSync(backupRoot)) return undefined;

  return fs.readdirSync(backupRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) => {
      const directory = path.join(backupRoot, entry.name);
      const manifest = readBackupManifest(path.join(directory, 'manifest.json'));
      return manifest ? [{ directory, manifest }] : [];
    })
    .sort((left, right) => Date.parse(right.manifest.createdAt) - Date.parse(left.manifest.createdAt))[0];
}

function readBackupManifest(manifestPath: string): BackupManifest | undefined {
  if (!fs.existsSync(manifestPath)) return undefined;
  try {
    const value = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as unknown;
    if (
      !isRecord(value)
      || typeof value.createdAt !== 'string'
      || Number.isNaN(Date.parse(value.createdAt))
      || !Array.isArray(value.files)
      || !value.files.every(
        (file) => isRecord(file)
          && typeof file.originalPath === 'string'
          && typeof file.backupPath === 'string',
      )
    ) {
      return undefined;
    }
    return value as unknown as BackupManifest;
  } catch {
    return undefined;
  }
}
