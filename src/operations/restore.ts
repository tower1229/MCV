import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import type { DeviceContext } from '../adapters/types';
import { atomicWriteFile, hashFile } from '../utils/files';
import { isRecord } from '../utils/objects';
import { readManifest } from '../utils/repository';
import { getStateFilePath, readState, writeState, type McvState } from '../utils/state';
import {
  OPERATION_SCHEMA_VERSION,
  type Issue,
  type McvError,
  type Plan,
  type Result,
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

export interface RestoreSelection {
  changeIds: string[];
}

export interface RestoreApplyOptions {
  signal?: AbortSignal;
  nonInteractive?: boolean;
  copyFile?: typeof fs.copyFileSync;
  writeFile?: (targetPath: string, content: Buffer) => void;
  removeFile?: (targetPath: string) => void;
  restoreFile?: (targetPath: string, content: Buffer) => void;
  updateState?: (context: DeviceContext, state: McvState) => void;
}

export interface RestoreResultData {
  appliedChangeIds: string[];
  restoredPaths: string[];
  deletedPaths: string[];
  backupPath: string;
}

export type RestoreResult = Result<RestoreResultData, RestoreChange> & {
  operation: 'restore';
};

interface ActiveRestorePlan {
  operationId: string;
  backupDirectory: string;
}

interface CurrentStateBackupEntry {
  originalPath: string;
  backupPath?: string;
  hash: string;
}

interface CurrentStateBackupManifest {
  createdAt: string;
  status: 'complete';
  files: CurrentStateBackupEntry[];
}

const MISSING_HASH = hashText('<missing>');
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const activeRestorePlans = new WeakMap<RestorePlan, ActiveRestorePlan>();

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
    const plan = freezeRestorePlan(buildRestorePlan(operationId, repositoryPath, backup));
    activeRestorePlans.set(plan, { operationId, backupDirectory: backup.directory });
    return plan;
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

export function applyRestorePlan(
  context: DeviceContext,
  plan: RestorePlan,
  selection: RestoreSelection,
  options: RestoreApplyOptions = {},
): RestoreResult {
  if (plan.status === 'failed') return failedRestoreResult(plan.repositoryPath, plan.error, plan.issues);
  const active = activeRestorePlans.get(plan);
  if (!active || active.operationId !== plan.operationId) {
    return failedRestoreResult(plan.repositoryPath, invalidPlanError());
  }

  const selectedIds = [...new Set(selection.changeIds)];
  const planIds = plan.changes.map((change) => change.id);
  if (selectedIds.length !== planIds.length
    || selectedIds.some((id) => !planIds.includes(id))) {
    activeRestorePlans.delete(plan);
    return failedRestoreResult(plan.repositoryPath, {
      code: 'restore.invalidSelection',
      message: 'Restore must apply the complete selection from the active Plan.',
      nextActions: ['Select every change in the current Restore Plan, or generate a new Plan.'],
    });
  }
  if (plan.issues.some((issue) => issue.severity === 'error')) {
    activeRestorePlans.delete(plan);
    return blockedRestoreResult(plan, plan.issues);
  }
  if (options.nonInteractive && plan.changes.some((change) => change.action === 'delete')) {
    activeRestorePlans.delete(plan);
    return blockedRestoreResult(plan, [{
      severity: 'decisionRequired',
      code: 'restore.nonInteractiveBlocked',
      message: 'Non-interactive Restore cannot delete files.',
    }]);
  }
  if (options.signal?.aborted) {
    activeRestorePlans.delete(plan);
    return cancelledRestoreResult(plan);
  }

  const verifiedBackup = verifyDeployBackup(active.backupDirectory);
  if (!verifiedBackup || !sameRestoreSnapshot(context, plan, verifiedBackup)) {
    activeRestorePlans.delete(plan);
    return failedRestoreResult(plan.repositoryPath, stalePlanError());
  }

  let currentStateBackupPath: string;
  try {
    currentStateBackupPath = createCurrentStateBackup(
      path.dirname(getStateFilePath(context)),
      plan,
      options.copyFile ?? fs.copyFileSync,
    );
  } catch (error) {
    activeRestorePlans.delete(plan);
    return failedRestoreResult(plan.repositoryPath, {
      code: 'restore.backupFailed',
      message: 'Restore could not create and verify the current-state backup before writing.',
      technicalDetails: errorMessage(error),
      nextActions: ['Check local state storage and target file permissions, then generate a new Restore Plan.'],
    });
  }

  const transactionBackup = verifyDeployBackup(active.backupDirectory);
  if (!transactionBackup || !sameRestoreSnapshot(context, plan, transactionBackup)) {
    activeRestorePlans.delete(plan);
    return failedRestoreResult(plan.repositoryPath, stalePlanError());
  }

  let previousState: McvState;
  let statePath: string;
  let previousStateContent: Buffer | undefined;
  try {
    previousState = readState(context);
    statePath = getStateFilePath(context);
    previousStateContent = fs.existsSync(statePath) ? fs.readFileSync(statePath) : undefined;
  } catch (error) {
    activeRestorePlans.delete(plan);
    return failedRestoreResult(plan.repositoryPath, {
      code: 'restore.preparationFailed',
      message: 'Restore could not prepare the device-state transaction before writing.',
      technicalDetails: errorMessage(error),
      nextActions: [`The current configuration is saved at ${currentStateBackupPath}; check local state permissions, then generate a new Restore Plan.`],
    });
  }
  const attemptedPaths = new Set<string>();
  let stateCommitAttempted = false;
  const writeFile = options.writeFile ?? ((targetPath: string, content: Buffer) => atomicWriteFile(targetPath, content));
  const removeFile = options.removeFile ?? ((targetPath: string) => fs.rmSync(targetPath, { force: true }));
  try {
    for (const change of plan.changes) {
      attemptedPaths.add(change.targetPath);
      if (change.action === 'delete') {
        removeFile(change.targetPath);
        continue;
      }
      const source = transactionBackup.manifest.files.find((file) => file.originalPath === change.targetPath);
      if (!source?.backupPath) throw new Error(`Backup path is missing for ${change.targetPath}.`);
      const sourcePath = resolveVerifiedBackupFile(transactionBackup.directory, source.backupPath);
      if (!sourcePath) throw new Error(`Backup file is no longer valid for ${change.targetPath}.`);
      writeFile(change.targetPath, fs.readFileSync(sourcePath));
    }
    const nextState = { ...previousState };
    delete nextState.baselineSnapshot;
    delete nextState.managedInventory;
    nextState.lastOperation = { kind: 'restore', time: new Date().toISOString(), success: true };
    stateCommitAttempted = true;
    (options.updateState ?? writeState)(context, nextState);
  } catch (error) {
    const rollbackErrors = rollbackRestoreWrites(
      currentStateBackupPath,
      plan.changes,
      attemptedPaths,
      removeFile,
      options.restoreFile ?? ((targetPath, content) => atomicWriteFile(targetPath, content)),
    );
    if (stateCommitAttempted) {
      try {
        if (previousStateContent) atomicWriteFile(statePath, previousStateContent);
        else fs.rmSync(statePath, { force: true });
      } catch (rollbackError) {
        rollbackErrors.push(`device state: ${errorMessage(rollbackError)}`);
      }
    }
    activeRestorePlans.delete(plan);
    if (rollbackErrors.length > 0) {
      return failedRestoreResult(plan.repositoryPath, {
        code: 'restore.rollbackFailed',
        message: 'Restore failed and could not fully recover the pre-restore state automatically.',
        technicalDetails: `${errorMessage(error)} Rollback was incomplete: ${rollbackErrors.join('; ')}`,
        nextActions: [`Recover the affected files from ${currentStateBackupPath}, then generate a new Restore Plan.`],
      });
    }
    return failedRestoreResult(plan.repositoryPath, {
      code: 'restore.transactionFailed',
      message: 'Restore could not commit every change and recovered the pre-restore state.',
      technicalDetails: errorMessage(error),
      nextActions: ['Check target permissions, then generate and review a new Restore Plan.'],
    });
  }

  activeRestorePlans.delete(plan);
  return {
    schemaVersion: OPERATION_SCHEMA_VERSION,
    operation: 'restore',
    status: 'succeeded',
    repositoryPath: plan.repositoryPath,
    changes: plan.changes,
    issues: [],
    nextActions: [],
    data: {
      appliedChangeIds: selectedIds,
      restoredPaths: plan.changes.filter((change) => change.action === 'restore').map((change) => change.targetPath),
      deletedPaths: plan.changes.filter((change) => change.action === 'delete').map((change) => change.targetPath),
      backupPath: currentStateBackupPath,
    },
  };
}

function sameRestoreSnapshot(
  context: DeviceContext,
  plan: RestorePlan,
  backup: VerifiedDeployBackup,
): boolean {
  try {
    if (readState(context).repositoryPath !== (plan.repositoryPath ?? undefined)) return false;
    if (plan.repositoryPath) readManifest(plan.repositoryPath);
    if (!plan.backup
      || plan.backup.id !== path.basename(backup.directory)
      || plan.backup.createdAt !== backup.manifest.createdAt
      || plan.preconditions['backup:manifest'] !== backup.manifestHash
      || plan.changes.length !== backup.manifest.files.length) return false;
    for (const file of backup.manifest.files) {
      const action = file.action === 'add' ? 'delete' as const : 'restore' as const;
      const id = stableRestoreId(action, file.originalPath);
      if (!plan.changes.some((change) =>
        change.id === id && change.action === action && change.targetPath === file.originalPath)) return false;
      if (plan.preconditions[`source:${id}`] !== (file.beforeHash ?? MISSING_HASH)
        || plan.preconditions[`target:${id}`] !== currentFileHash(file.originalPath)) return false;
    }
    return true;
  } catch {
    return false;
  }
}

function createCurrentStateBackup(
  stateDirectory: string,
  plan: RestorePlan,
  copyFile: typeof fs.copyFileSync,
): string {
  const root = path.join(stateDirectory, 'restore-backups');
  fs.mkdirSync(root, { recursive: true });
  const directory = fs.mkdtempSync(path.join(root, 'before-restore-'));
  try {
    const files: CurrentStateBackupEntry[] = [];
    for (const [index, change] of plan.changes.entries()) {
      const expectedHash = plan.preconditions[`target:${change.id}`];
      const actualHash = currentFileHash(change.targetPath);
      if (actualHash !== expectedHash) {
        throw new Error(`Restore target changed while its current state was being backed up: ${change.targetPath}`);
      }
      if (actualHash === MISSING_HASH) {
        files.push({ originalPath: change.targetPath, hash: MISSING_HASH });
        continue;
      }
      const backupPath = path.join('files', `${index}-${path.basename(change.targetPath)}`);
      const destination = path.join(directory, backupPath);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      copyFile(change.targetPath, destination);
      if (hashFile(destination) !== actualHash || currentFileHash(change.targetPath) !== expectedHash) {
        throw new Error(`Current-state backup verification failed for ${change.targetPath}.`);
      }
      files.push({ originalPath: change.targetPath, backupPath, hash: actualHash });
    }
    const manifest: CurrentStateBackupManifest = {
      createdAt: new Date().toISOString(),
      status: 'complete',
      files,
    };
    atomicWriteFile(path.join(directory, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    if (!verifyCurrentStateBackup(directory, plan.changes)) {
      throw new Error('The current-state backup manifest could not be verified.');
    }
    return directory;
  } catch (error) {
    fs.rmSync(directory, { recursive: true, force: true });
    throw error;
  }
}

function verifyCurrentStateBackup(
  directory: string,
  changes: RestoreChange[],
): CurrentStateBackupManifest | undefined {
  try {
    const manifestPath = path.join(directory, 'manifest.json');
    const stats = fs.lstatSync(manifestPath);
    if (!stats.isFile() || stats.isSymbolicLink()) return undefined;
    const value = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as unknown;
    if (!isRecord(value)
      || value.status !== 'complete'
      || typeof value.createdAt !== 'string'
      || !Number.isFinite(Date.parse(value.createdAt))
      || !Array.isArray(value.files)
      || value.files.length !== changes.length) return undefined;
    const expectedPaths = new Set(changes.map((change) => change.targetPath));
    const files: CurrentStateBackupEntry[] = [];
    for (const entry of value.files) {
      if (!isRecord(entry)
        || typeof entry.originalPath !== 'string'
        || !expectedPaths.delete(entry.originalPath)
        || typeof entry.hash !== 'string'
        || !SHA256_PATTERN.test(entry.hash)) return undefined;
      if (entry.backupPath === undefined) {
        if (entry.hash !== MISSING_HASH) return undefined;
        files.push({ originalPath: entry.originalPath, hash: entry.hash });
        continue;
      }
      if (typeof entry.backupPath !== 'string') return undefined;
      const sourcePath = resolveVerifiedBackupFile(directory, entry.backupPath);
      if (!sourcePath || hashFile(sourcePath) !== entry.hash) return undefined;
      files.push({ originalPath: entry.originalPath, backupPath: entry.backupPath, hash: entry.hash });
    }
    return expectedPaths.size === 0
      ? { createdAt: value.createdAt, status: 'complete', files }
      : undefined;
  } catch {
    return undefined;
  }
}

function rollbackRestoreWrites(
  backupPath: string,
  changes: RestoreChange[],
  attemptedPaths: Set<string>,
  removeFile: (targetPath: string) => void,
  restoreFile: (targetPath: string, content: Buffer) => void,
): string[] {
  const manifest = verifyCurrentStateBackup(
    backupPath,
    changes,
  );
  if (!manifest) return ['current-state backup verification failed'];
  const errors: string[] = [];
  for (const entry of manifest.files.filter((file) => attemptedPaths.has(file.originalPath)).reverse()) {
    try {
      if (!entry.backupPath) removeFile(entry.originalPath);
      else restoreFile(entry.originalPath, fs.readFileSync(path.join(backupPath, entry.backupPath)));
    } catch (error) {
      errors.push(`${entry.originalPath}: ${errorMessage(error)}`);
    }
  }
  return errors;
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

function invalidPlanError(): McvError {
  return {
    code: 'operation.invalidPlan',
    message: 'The Restore Plan is not the active in-process Plan.',
    nextActions: ['Generate and review a new Restore Plan.'],
  };
}

function stalePlanError(): McvError {
  return {
    code: 'operation.stalePlan',
    message: 'Restore source or target state changed after the Plan was generated.',
    nextActions: ['Generate and review a new Restore Plan.'],
  };
}

function failedRestoreResult(
  repositoryPath: string | null,
  error: McvError,
  issues: Issue[] = [{ severity: 'error', code: error.code, message: error.message }],
): RestoreResult {
  return {
    schemaVersion: OPERATION_SCHEMA_VERSION,
    operation: 'restore',
    status: 'failed',
    repositoryPath,
    changes: [],
    issues,
    nextActions: error.nextActions,
    error,
  };
}

function blockedRestoreResult(plan: RestorePlan, issues: Issue[]): RestoreResult {
  return {
    schemaVersion: OPERATION_SCHEMA_VERSION,
    operation: 'restore',
    status: 'blocked',
    repositoryPath: plan.repositoryPath,
    changes: [],
    issues,
    nextActions: issues.some((issue) => issue.code === 'restore.nonInteractiveBlocked')
      ? ['Run Restore interactively to review and confirm the complete Plan.']
      : ['Back up or manually resolve every Restore Conflict, then generate a new Restore Plan.'],
  };
}

function cancelledRestoreResult(plan: RestorePlan): RestoreResult {
  return {
    schemaVersion: OPERATION_SCHEMA_VERSION,
    operation: 'restore',
    status: 'blocked',
    repositoryPath: plan.repositoryPath,
    changes: [],
    issues: [{
      severity: 'notice',
      code: 'restore.cancelled',
      message: 'Restore was cancelled before the write transaction started.',
    }],
    nextActions: ['Generate a new Restore Plan when you are ready to continue.'],
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
