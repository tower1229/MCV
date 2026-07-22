import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import type { DeviceContext } from '../adapters/types';
import { hashFile } from '../utils/files';
import { isRecord } from '../utils/objects';
import { readManifest } from '../utils/repository';
import { getStateFilePath, readState } from '../utils/state';
import {
  OPERATION_SCHEMA_VERSION,
  type Issue,
  type McvError,
  type Plan,
} from './contracts';

type DeployBackupAction = 'add' | 'modify' | 'delete';

export interface DeployBackupFile {
  action: DeployBackupAction;
  originalPath: string;
  backupPath?: string;
  beforeHash?: string;
  afterHash?: string;
}

interface DeployBackupManifest {
  createdAt: string;
  status: 'complete';
  files: DeployBackupFile[];
}

export interface VerifiedDeployBackup {
  directory: string;
  manifest: DeployBackupManifest;
  manifestHash: string;
}

export interface RestoreChange {
  id: string;
  action: 'restore' | 'delete';
  targetPath: string;
}

export type RestorePlan = Plan<RestoreChange> & {
  operation: 'restore';
  backup: { id: string; createdAt: string } | null;
};

const MISSING_HASH = hashText('<missing>');
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

export function createRestorePlan(context: DeviceContext): RestorePlan {
  const operationId = uuidv4();
  const state = readState(context);
  const repositoryPath = state.repositoryPath ?? null;
  try {
    if (repositoryPath) readManifest(repositoryPath);
    const backupRoot = path.join(path.dirname(getStateFilePath(context)), 'backups');
    const backup = findLatestVerifiedBackup(backupRoot);
    if (!backup) {
      return freezeRestorePlan(failedRestorePlan(
        operationId,
        repositoryPath,
        'restore.backupNotFound',
        'No complete and verified deployment backup is available.',
        ['Run a successful Deploy before trying Restore again.'],
      ));
    }
    return freezeRestorePlan(buildRestorePlan(operationId, repositoryPath, backup));
  } catch (error) {
    return freezeRestorePlan(failedRestorePlan(
      operationId,
      repositoryPath,
      'restore.planFailed',
      'The Restore Plan could not be generated safely.',
      ['Fix the reported local state or Repository problem, then regenerate the Restore Plan.'],
      errorMessage(error),
    ));
  }
}

function buildRestorePlan(
  operationId: string,
  repositoryPath: string | null,
  backup: VerifiedDeployBackup,
): RestorePlan {
  const preconditions: Record<string, string> = {
    'backup:manifest': backup.manifestHash,
  };
  const conflicts: string[] = [];
  const changes = backup.manifest.files.map((file): RestoreChange => {
    const action = file.action === 'add' ? 'delete' as const : 'restore' as const;
    const id = stableRestoreId(action, file.originalPath);
    const targetHash = currentFileHash(file.originalPath);
    const expectedTargetHash = file.afterHash ?? MISSING_HASH;
    preconditions[`source:${id}`] = file.beforeHash ?? MISSING_HASH;
    preconditions[`target:${id}`] = targetHash;
    if (targetHash !== expectedTargetHash) conflicts.push(file.originalPath);
    return { id, action, targetPath: file.originalPath };
  });
  const issues: Issue[] = conflicts.length === 0 ? [] : [{
    severity: 'error',
    code: 'restore.conflict',
    message: 'Restore would overwrite files that changed after the deployment.',
    details: conflicts.join('\n'),
  }];
  return {
    schemaVersion: OPERATION_SCHEMA_VERSION,
    operation: 'restore',
    status: 'planned',
    readyToApply: issues.length === 0,
    operationId,
    preconditions,
    repositoryPath,
    backup: {
      id: path.basename(backup.directory),
      createdAt: backup.manifest.createdAt,
    },
    changes,
    issues,
    nextActions: issues.length === 0
      ? ['Review this Plan, then run `mcv restore` to restore the listed files.']
      : ['Back up or manually resolve every Restore Conflict, then generate a new Restore Plan.'],
  };
}

export function findLatestVerifiedBackup(
  backupRoot: string,
): VerifiedDeployBackup | undefined {
  if (!fs.existsSync(backupRoot)) return undefined;
  return fs.readdirSync(backupRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) => {
      const verified = verifyDeployBackup(path.join(backupRoot, entry.name));
      return verified ? [verified] : [];
    })
    .sort((left, right) =>
      Date.parse(right.manifest.createdAt) - Date.parse(left.manifest.createdAt))[0];
}

function verifyDeployBackup(directory: string): VerifiedDeployBackup | undefined {
  const manifestPath = path.join(directory, 'manifest.json');
  try {
    const manifestStats = fs.lstatSync(manifestPath);
    if (!manifestStats.isFile() || manifestStats.isSymbolicLink()) return undefined;
    const manifestContent = fs.readFileSync(manifestPath);
    const value = JSON.parse(manifestContent.toString('utf8')) as unknown;
    if (!isRecord(value)
      || value.status !== 'complete'
      || typeof value.createdAt !== 'string'
      || !Number.isFinite(Date.parse(value.createdAt))
      || !Array.isArray(value.files)
      || value.files.length === 0) return undefined;

    const seenPaths = new Set<string>();
    const files: DeployBackupFile[] = [];
    for (const entry of value.files) {
      const file = verifyDeployBackupFile(directory, entry);
      if (!file || seenPaths.has(file.originalPath)) return undefined;
      seenPaths.add(file.originalPath);
      files.push(file);
    }
    return {
      directory,
      manifest: { createdAt: value.createdAt, status: 'complete', files },
      manifestHash: hashBuffer(manifestContent),
    };
  } catch {
    return undefined;
  }
}

function verifyDeployBackupFile(
  directory: string,
  value: unknown,
): DeployBackupFile | undefined {
  if (!isRecord(value)
    || (value.action !== 'add' && value.action !== 'modify' && value.action !== 'delete')
    || typeof value.originalPath !== 'string'
    || !path.isAbsolute(value.originalPath)) return undefined;
  const action = value.action;
  if (action === 'add') {
    if (value.backupPath !== undefined
      || value.beforeHash !== undefined
      || typeof value.afterHash !== 'string'
      || !SHA256_PATTERN.test(value.afterHash)) return undefined;
    return { action, originalPath: value.originalPath, afterHash: value.afterHash };
  }
  if (typeof value.backupPath !== 'string'
    || typeof value.beforeHash !== 'string'
    || !SHA256_PATTERN.test(value.beforeHash)
    || (action === 'modify'
      ? typeof value.afterHash !== 'string' || !SHA256_PATTERN.test(value.afterHash)
      : value.afterHash !== undefined)) return undefined;
  const sourcePath = resolveVerifiedBackupFile(directory, value.backupPath);
  if (!sourcePath || hashFile(sourcePath) !== value.beforeHash) return undefined;
  return {
    action,
    originalPath: value.originalPath,
    backupPath: value.backupPath,
    beforeHash: value.beforeHash,
    ...(action === 'modify' ? { afterHash: value.afterHash as string } : {}),
  };
}

function resolveVerifiedBackupFile(directory: string, backupPath: string): string | undefined {
  const sourcePath = path.resolve(directory, backupPath);
  if (!isContainedPath(directory, sourcePath)) return undefined;
  const stats = fs.lstatSync(sourcePath);
  if (!stats.isFile() || stats.isSymbolicLink()) return undefined;
  const realDirectory = fs.realpathSync(directory);
  const realSource = fs.realpathSync(sourcePath);
  return isContainedPath(realDirectory, realSource) ? sourcePath : undefined;
}

function isContainedPath(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function currentFileHash(targetPath: string): string {
  let stats: fs.Stats;
  try {
    stats = fs.lstatSync(targetPath);
  } catch (error) {
    if (isMissingPathError(error)) return MISSING_HASH;
    throw error;
  }
  if (!stats.isFile() || stats.isSymbolicLink()) {
    return hashText(`<unsupported:${stats.mode}>`);
  }
  return hashFile(targetPath);
}

function isMissingPathError(error: unknown): boolean {
  return isRecord(error) && error.code === 'ENOENT';
}

function stableRestoreId(action: RestoreChange['action'], targetPath: string): string {
  return `restore-${hashText(`${action}\0${targetPath}`).slice(0, 16)}`;
}

function failedRestorePlan(
  operationId: string,
  repositoryPath: string | null,
  code: string,
  message: string,
  nextActions: string[],
  technicalDetails?: string,
): RestorePlan {
  const error: McvError = { code, message, technicalDetails, nextActions };
  return {
    schemaVersion: OPERATION_SCHEMA_VERSION,
    operation: 'restore',
    status: 'failed',
    readyToApply: false,
    operationId,
    preconditions: {},
    repositoryPath,
    backup: null,
    changes: [],
    issues: [{ severity: 'error', code, message }],
    nextActions,
    error,
  };
}

function freezeRestorePlan(plan: RestorePlan): RestorePlan {
  if (plan.backup) Object.freeze(plan.backup);
  for (const change of plan.changes) Object.freeze(change);
  Object.freeze(plan.changes);
  for (const issue of plan.issues) Object.freeze(issue);
  Object.freeze(plan.issues);
  Object.freeze(plan.nextActions);
  Object.freeze(plan.preconditions);
  if (plan.status === 'failed') {
    Object.freeze(plan.error.nextActions);
    Object.freeze(plan.error);
  }
  return Object.freeze(plan);
}

function hashBuffer(value: Buffer): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function hashText(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
