import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'yaml';
import { execFileSync } from 'child_process';
import { createHash } from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import type { DeviceContext } from '../adapters/types';
import { normalizeMcpServers } from '../core/mcp';
import { atomicWriteTextFile } from '../utils/files';
import { isRecord } from '../utils/objects';
import {
  CURRENT_SCHEMA_VERSION,
  readManifest,
  validateManifest,
  type McvManifest,
} from '../utils/repository';
import {
  getStateFilePath,
  readState,
  writeState,
  type McvState,
} from '../utils/state';
import {
  OPERATION_SCHEMA_VERSION,
  type Issue,
  type McvError,
  type Plan,
  type Report,
  type Result,
} from './contracts';

export interface GitRepositoryStatus {
  branch: string | null;
  clean: boolean;
  uncommittedChanges: number;
}

export type RepositoryReport = Report<never> & {
  operation: 'repository';
  changes: [];
  repositoryId: string | null;
  repositorySchemaVersion: number | null;
  valid: boolean;
  git?: GitRepositoryStatus;
};

export interface RepositoryBindingData {
  repositoryId: string;
  repositorySchemaVersion: number;
  previousRepositoryPath: string | null;
}

export type BindResult = Result<RepositoryBindingData, never> & {
  operation: 'bind';
  changes: [];
};

export interface RepositoryBindingChange {
  id: 'repository-binding';
  kind: 'bind' | 'unbind';
  previousRepositoryPath: string | null;
  repositoryPath: string | null;
  repositoryId: string | null;
}

export type BindPlan = Plan<RepositoryBindingChange> & {
  operation: 'bind';
};

export interface RepositoryUnbindData {
  repositoryId: string | null;
  previousRepositoryPath: string | null;
}

export type UnbindResult = Result<RepositoryUnbindData, never> & {
  operation: 'unbind';
  changes: [];
};

export type UnbindPlan = Plan<RepositoryBindingChange> & {
  operation: 'unbind';
};

export interface InitChange {
  id: 'repository-manifest' | 'repository-binding';
  kind: 'add' | 'bind';
  path?: string;
  repositoryPath: string;
  repositoryId: string;
  initializedAt?: string;
  schemaVersion?: typeof CURRENT_SCHEMA_VERSION;
}

export type InitPlan = Plan<InitChange> & { operation: 'init' };

export interface InitData {
  repositoryId: string;
  repositorySchemaVersion: typeof CURRENT_SCHEMA_VERSION;
}

export type InitResult = Result<InitData, never> & {
  operation: 'init';
  changes: [];
};

export interface MigrationChange {
  id: string;
  kind: 'backup' | 'modify' | 'move';
  path?: string;
  sourcePath?: string;
  targetPath?: string;
  before?: number;
  after?: number;
}

export type MigrationPlan = Plan<MigrationChange> & { operation: 'migrate' };

export interface MigrationData {
  repositoryId: string;
  previousSchemaVersion: 1;
  repositorySchemaVersion: typeof CURRENT_SCHEMA_VERSION;
  backupPath: string;
  backupVerified: true;
}

export type MigrationResult = Result<MigrationData, never> & {
  operation: 'migrate';
  changes: [];
};

const activeRepositoryPlans = new WeakMap<object, string>();
const activeLifecyclePlans = new WeakMap<object, string>();

export function inspectRepository(
  context: DeviceContext,
  explicitPath?: string,
): RepositoryReport {
  const state = readState(context);
  const repositoryPath = explicitPath ?? state.repositoryPath ?? null;

  if (!repositoryPath) {
    return {
      schemaVersion: OPERATION_SCHEMA_VERSION,
      operation: 'repository',
      status: 'reported',
      ready: false,
      repositoryPath: null,
      repositoryId: state.defaultRepositoryId ?? null,
      repositorySchemaVersion: null,
      valid: false,
      changes: [],
      issues: [{
        severity: 'notice',
        code: 'repository.notBound',
        message: 'This device is not bound to an MCV Repository.',
      }],
      nextActions: ['Run `mcv bind [path]` to bind a Repository.'],
    };
  }

  const identity = inspectManifestIdentity(repositoryPath);
  const inspectedRepositoryId = identity.repositoryId ?? state.defaultRepositoryId ?? null;
  const inspectedSchemaVersion = identity.schemaVersion;

  if (
    inspectedSchemaVersion !== null
    && inspectedSchemaVersion !== CURRENT_SCHEMA_VERSION
  ) {
    const migratable = inspectedSchemaVersion === 1;
    const code = migratable
      ? 'repository.migrationRequired'
      : 'repository.unsupportedSchema';
    const message = migratable
      ? `Repository schema ${inspectedSchemaVersion} requires migration.`
      : `Repository schema ${inspectedSchemaVersion} is not supported by this MCV version.`;
    const nextActions = migratable
      ? ['Run `mcv migrate --dry-run` to review the required migration.']
      : ['Update MCV to a version that supports this Repository schema.'];
    return {
      schemaVersion: OPERATION_SCHEMA_VERSION,
      operation: 'repository',
      status: 'reported',
      ready: false,
      repositoryPath,
      repositoryId: inspectedRepositoryId,
      repositorySchemaVersion: inspectedSchemaVersion,
      valid: false,
      changes: [],
      issues: [{
        severity: 'error',
        code,
        message,
      }],
      nextActions,
    };
  }

  let manifest: McvManifest;
  try {
    manifest = readManifest(repositoryPath);
  } catch (error) {
    return {
      schemaVersion: OPERATION_SCHEMA_VERSION,
      operation: 'repository',
      status: 'reported',
      ready: false,
      repositoryPath,
      repositoryId: inspectedRepositoryId,
      repositorySchemaVersion: inspectedSchemaVersion,
      valid: false,
      changes: [],
      issues: [{
        severity: 'error',
        code: 'repository.invalidManifest',
        message: 'The bound path does not contain a valid MCV Repository manifest.',
        details: error instanceof Error ? error.message : String(error),
      }],
      nextActions: ['Move the Repository back or run `mcv bind [path]` with its new location.'],
    };
  }

  if (
    state.defaultRepositoryId
    && state.defaultRepositoryId !== manifest.repositoryId
  ) {
    return {
      schemaVersion: OPERATION_SCHEMA_VERSION,
      operation: 'repository',
      status: 'reported',
      ready: false,
      repositoryPath,
      repositoryId: manifest.repositoryId,
      repositorySchemaVersion: manifest.schemaVersion,
      valid: false,
      changes: [],
      issues: [{
        severity: 'error',
        code: 'repository.idMismatch',
        message: 'The Repository ID does not match the current local binding.',
      }],
      nextActions: ['Restore the expected Repository or rebind its moved location.'],
    };
  }

  return {
    schemaVersion: OPERATION_SCHEMA_VERSION,
    operation: 'repository',
    status: 'reported',
    ready: true,
    repositoryPath,
    repositoryId: manifest.repositoryId,
    repositorySchemaVersion: manifest.schemaVersion,
    valid: true,
    changes: [],
    issues: [],
    nextActions: [],
    ...inspectGitRepository(repositoryPath),
  };
}

function inspectGitRepository(
  repositoryPath: string,
): { git?: GitRepositoryStatus } {
  try {
    execFileSync('git', ['rev-parse', '--is-inside-work-tree'], {
      cwd: repositoryPath,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const branch = execFileSync('git', ['branch', '--show-current'], {
      cwd: repositoryPath,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim() || null;
    const status = execFileSync('git', ['status', '--porcelain'], {
      cwd: repositoryPath,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const trimmedStatus = status.trim();
    const uncommittedChanges = trimmedStatus === '' ? 0 : trimmedStatus.split(/\r?\n/).length;
    return { git: { branch, clean: uncommittedChanges === 0, uncommittedChanges } };
  } catch {
    return {};
  }
}

export function createInitPlan(
  context: DeviceContext,
  repositoryPath: string = process.cwd(),
): InitPlan {
  const resolvedPath = path.resolve(repositoryPath);
  const manifestPath = path.join(resolvedPath, 'mcv.yaml');
  const stateSnapshot = readStateSnapshot(context);
  const preconditions = {
    manifest: hashOptionalFile(manifestPath),
    manifestTarget: hashText(manifestPath),
    state: stateSnapshot.hash,
    stateTarget: hashText(stateSnapshot.path),
  };
  const operationId = uuidv4();
  const failed = (error: McvError): InitPlan => freezeLifecyclePlan({
    schemaVersion: OPERATION_SCHEMA_VERSION,
    operation: 'init',
    status: 'failed',
    readyToApply: false,
    operationId,
    preconditions,
    repositoryPath: resolvedPath,
    changes: [],
    issues: [{ severity: 'error', code: error.code, message: error.message }],
    nextActions: error.nextActions,
    error,
  });

  let entries: string[];
  try {
    if (!fs.statSync(resolvedPath).isDirectory()) {
      return failed({
        code: 'repository.invalidInitTarget',
        message: 'The Init target is not a directory.',
        nextActions: ['Choose an existing writable directory.'],
      });
    }
    entries = fs.readdirSync(resolvedPath).filter((entry) => entry !== '.git');
  } catch (error) {
    return failed({
      code: 'repository.invalidInitTarget',
      message: 'MCV could not inspect the Init target directory.',
      technicalDetails: error instanceof Error ? error.message : String(error),
      nextActions: ['Choose an existing writable directory and try again.'],
    });
  }
  if (preconditions.manifest !== 'missing') {
    return failed({
      code: 'repository.alreadyInitialized',
      message: 'An mcv.yaml manifest already exists in this directory.',
      nextActions: ['Run `mcv bind [path]` to bind the existing Repository.'],
    });
  }
  if (stateSnapshot.state.repositoryPath || stateSnapshot.state.defaultRepositoryId) {
    return failed({
      code: 'repository.alreadyBound',
      message: 'This device is already bound to an MCV Repository.',
      nextActions: ['Run `mcv unbind` before initializing a different Repository.'],
    });
  }

  const repositoryId = uuidv4();
  const initializedAt = new Date().toISOString();
  const issues: Issue[] = entries.length === 0 ? [] : [{
    severity: 'warning',
    code: 'repository.initTargetNotEmpty',
    message: 'The Init target contains existing files that MCV will leave unchanged.',
    details: `${entries.length} existing entr${entries.length === 1 ? 'y' : 'ies'}.`,
  }];
  return registerLifecyclePlan({
    schemaVersion: OPERATION_SCHEMA_VERSION,
    operation: 'init',
    status: 'planned',
    readyToApply: true,
    operationId,
    preconditions,
    repositoryPath: resolvedPath,
    changes: [{
      id: 'repository-manifest',
      kind: 'add',
      path: manifestPath,
      repositoryPath: resolvedPath,
      repositoryId,
      initializedAt,
      schemaVersion: CURRENT_SCHEMA_VERSION,
    }, {
      id: 'repository-binding',
      kind: 'bind',
      repositoryPath: resolvedPath,
      repositoryId,
    }],
    issues,
    nextActions: [],
  });
}

export function applyInitPlan(context: DeviceContext, plan: InitPlan): InitResult {
  if (plan.status === 'failed') return failedInitResult(plan.repositoryPath, plan.error, plan.issues);
  const validation = validateLifecyclePlan(context, plan);
  if ('error' in validation) return failedInitResult(plan.repositoryPath, validation.error);
  const manifestChange = plan.changes.find((change) => change.id === 'repository-manifest');
  const bindingChange = plan.changes.find((change) => change.id === 'repository-binding');
  if (!manifestChange?.path || !manifestChange.initializedAt || !bindingChange) {
    return failedInitResult(plan.repositoryPath, {
      code: 'operation.invalidPlan',
      message: 'The Init Plan does not contain the required manifest and binding changes.',
      nextActions: ['Generate a new Init Plan.'],
    });
  }

  const manifest = createEmptyManifest(manifestChange.repositoryId, manifestChange.initializedAt);
  const state = validation.state;
  state.schemaVersion = 2;
  state.deviceId ??= uuidv4();
  state.defaultRepositoryId = bindingChange.repositoryId;
  state.repositoryPath = bindingChange.repositoryPath;
  state.baselineSnapshot = { recordedAt: manifestChange.initializedAt, files: {} };
  let manifestWritten = false;
  try {
    atomicWriteTextFile(manifestChange.path, yaml.stringify(manifest));
    manifestWritten = true;
    writeState(context, state);
  } catch (error) {
    if (manifestWritten) {
      try { fs.rmSync(manifestChange.path, { force: true }); } catch { /* best effort rollback */ }
    }
    return failedInitResult(plan.repositoryPath, {
      code: 'repository.initWriteFailed',
      message: 'MCV could not initialize and bind the Repository.',
      technicalDetails: error instanceof Error ? error.message : String(error),
      nextActions: ['Check directory permissions and generate a new Init Plan.'],
    });
  } finally {
    activeLifecyclePlans.delete(plan);
  }
  return {
    schemaVersion: OPERATION_SCHEMA_VERSION,
    operation: 'init',
    status: 'succeeded',
    repositoryPath: bindingChange.repositoryPath,
    changes: [],
    issues: [],
    nextActions: [],
    data: {
      repositoryId: bindingChange.repositoryId,
      repositorySchemaVersion: CURRENT_SCHEMA_VERSION,
    },
  };
}

export function createMigrationPlan(
  context: DeviceContext,
  repositoryPath: string = process.cwd(),
): MigrationPlan {
  const resolvedPath = path.resolve(repositoryPath);
  const operationId = uuidv4();
  const preconditions = {
    repository: hashDirectory(resolvedPath),
    repositoryTarget: hashText(resolvedPath),
    stateTarget: hashText(path.dirname(getStateFilePath(context))),
  };
  const failed = (error: McvError): MigrationPlan => freezeLifecyclePlan({
    schemaVersion: OPERATION_SCHEMA_VERSION,
    operation: 'migrate',
    status: 'failed',
    readyToApply: false,
    operationId,
    preconditions,
    repositoryPath: resolvedPath,
    changes: [],
    issues: [{ severity: 'error', code: error.code, message: error.message }],
    nextActions: error.nextActions,
    error,
  });

  const manifestPath = path.join(resolvedPath, 'mcv.yaml');
  let raw: Record<string, unknown>;
  try {
    const parsed = yaml.parse(fs.readFileSync(manifestPath, 'utf8')) as unknown;
    if (!isRecord(parsed)) throw new Error(`${manifestPath} must contain a YAML object.`);
    raw = parsed;
  } catch (error) {
    return failed({
      code: 'repository.invalidManifest',
      message: 'The selected directory does not contain a readable MCV Repository manifest.',
      technicalDetails: error instanceof Error ? error.message : String(error),
      nextActions: ['Choose a Repository containing a schema v1 mcv.yaml manifest.'],
    });
  }
  if (raw.schemaVersion !== 1) {
    const current = raw.schemaVersion === CURRENT_SCHEMA_VERSION;
    return failed({
      code: current ? 'repository.migrationNotRequired' : 'repository.unsupportedSchema',
      message: current
        ? 'This Repository already uses the current schema.'
        : `Repository schema ${String(raw.schemaVersion)} is not supported by this MCV version.`,
      nextActions: current
        ? ['Continue with the requested Repository operation.']
        : ['Update MCV to a version that supports this Repository schema.'],
    });
  }
  if (typeof raw.repositoryId !== 'string' || raw.repositoryId.length === 0) {
    return failed({
      code: 'repository.invalidManifest',
      message: 'The schema v1 manifest does not contain a Repository ID.',
      nextActions: ['Repair repositoryId in mcv.yaml before migrating.'],
    });
  }

  const changes: MigrationChange[] = [{
    id: 'repository-backup',
    kind: 'backup',
    path: path.join(path.dirname(getStateFilePath(context)), 'repository-backups'),
  }, {
    id: 'schema-version',
    kind: 'modify',
    path: manifestPath,
    before: 1,
    after: CURRENT_SCHEMA_VERSION,
  }];
  for (const mapping of geminiLayoutMappings(resolvedPath)) {
    if (fs.existsSync(mapping.sourcePath) && !fs.existsSync(mapping.targetPath)) {
      changes.push({ id: mapping.id, kind: 'move', sourcePath: mapping.sourcePath, targetPath: mapping.targetPath });
    }
  }
  const registryPath = path.join(resolvedPath, 'common', 'mcp.yaml');
  const normalizedRegistry = readNormalizedMcpRegistry(registryPath);
  if (normalizedRegistry !== undefined && normalizedRegistry !== fs.readFileSync(registryPath, 'utf8')) {
    changes.push({ id: 'mcp-registry', kind: 'modify', path: registryPath });
  }
  return registerLifecyclePlan({
    schemaVersion: OPERATION_SCHEMA_VERSION,
    operation: 'migrate',
    status: 'planned',
    readyToApply: true,
    operationId,
    preconditions,
    repositoryPath: resolvedPath,
    changes,
    issues: [],
    nextActions: [],
  });
}

export function applyMigrationPlan(
  context: DeviceContext,
  plan: MigrationPlan,
): MigrationResult {
  if (plan.status === 'failed') return failedMigrationResult(plan.repositoryPath, plan.error, plan.issues);
  const validation = validateLifecyclePlan(context, plan);
  if ('error' in validation) return failedMigrationResult(plan.repositoryPath, validation.error);
  if (!plan.repositoryPath) {
    return failedMigrationResult(null, {
      code: 'operation.invalidPlan',
      message: 'The Migration Plan does not identify a Repository.',
      nextActions: ['Generate a new Migration Plan.'],
    });
  }

  const repositoryPath = plan.repositoryPath;
  const backupRoot = path.join(path.dirname(getStateFilePath(context)), 'repository-backups');
  let backupPath: string | undefined;
  let backupVerified = false;
  try {
    fs.mkdirSync(backupRoot, { recursive: true });
    const backupDirectory = fs.mkdtempSync(path.join(backupRoot, 'schema-v1-'));
    backupPath = path.join(backupDirectory, 'repository');
    fs.cpSync(repositoryPath, backupPath, { recursive: true, verbatimSymlinks: true });
    if (hashDirectory(backupPath) !== plan.preconditions.repository) {
      throw new Error('The Repository backup did not match the planned source snapshot.');
    }
    backupVerified = true;

    const manifestPath = path.join(repositoryPath, 'mcv.yaml');
    const raw = yaml.parse(fs.readFileSync(manifestPath, 'utf8')) as unknown;
    if (!isRecord(raw) || raw.schemaVersion !== 1) throw new Error('The Repository is no longer schema v1.');
    const migrated = migrateV1Manifest(raw);
    validateManifest(migrated as unknown as Record<string, unknown>, manifestPath);
    for (const change of plan.changes) {
      if (change.kind === 'move' && change.sourcePath && change.targetPath) {
        fs.mkdirSync(path.dirname(change.targetPath), { recursive: true });
        fs.renameSync(change.sourcePath, change.targetPath);
      }
      if (change.id === 'mcp-registry' && change.path) {
        const content = readNormalizedMcpRegistry(change.path);
        if (content === undefined) throw new Error('The MCP registry can no longer be normalized.');
        atomicWriteTextFile(change.path, content);
      }
    }
    atomicWriteTextFile(manifestPath, yaml.stringify(migrated));
    readManifest(repositoryPath);
  } catch (error) {
    if (backupVerified && backupPath && fs.existsSync(backupPath)) {
      try {
        fs.rmSync(repositoryPath, { recursive: true, force: true });
        fs.cpSync(backupPath, repositoryPath, { recursive: true, verbatimSymlinks: true });
      } catch { /* preserve the verified backup for manual recovery */ }
    }
    return failedMigrationResult(repositoryPath, {
      code: 'repository.migrationFailed',
      message: 'MCV could not back up and migrate the Repository safely.',
      technicalDetails: error instanceof Error ? error.message : String(error),
      nextActions: backupVerified && backupPath
        ? [`Recover the Repository from ${backupPath} before retrying.`]
        : ['Check local state and Repository permissions before retrying.'],
    });
  } finally {
    activeLifecyclePlans.delete(plan);
  }

  const manifest = readManifest(repositoryPath);
  return {
    schemaVersion: OPERATION_SCHEMA_VERSION,
    operation: 'migrate',
    status: 'succeeded',
    repositoryPath,
    changes: [],
    issues: [],
    nextActions: [],
    data: {
      repositoryId: manifest.repositoryId,
      previousSchemaVersion: 1,
      repositorySchemaVersion: CURRENT_SCHEMA_VERSION,
      backupPath: backupPath as string,
      backupVerified: true,
    },
  };
}

export function createBindPlan(
  context: DeviceContext,
  repositoryPath: string = process.cwd(),
): BindPlan {
  const resolvedPath = path.resolve(repositoryPath);
  const operationId = uuidv4();
  const stateSnapshot = readStateSnapshot(context);
  const manifestPath = path.join(resolvedPath, 'mcv.yaml');
  const manifestSnapshot = readManifestSnapshot(manifestPath);
  const preconditions = {
    manifest: manifestSnapshot.hash,
    state: stateSnapshot.hash,
    stateTarget: hashText(stateSnapshot.path),
  };
  const identity = manifestSnapshot.identity;
  if (
    identity.schemaVersion !== null
    && identity.schemaVersion !== CURRENT_SCHEMA_VERSION
  ) {
    const migratable = identity.schemaVersion === 1;
    const code = migratable
      ? 'repository.migrationRequired'
      : 'repository.unsupportedSchema';
    const nextActions = migratable
      ? ['Run `mcv migrate --dry-run` to review the required migration.']
      : ['Update MCV to a version that supports this Repository schema.'];
    const message = migratable
      ? `Repository schema ${identity.schemaVersion} requires migration.`
      : `Repository schema ${identity.schemaVersion} is not supported by this MCV version.`;
    return freezePlan({
      schemaVersion: OPERATION_SCHEMA_VERSION,
      operation: 'bind',
      status: 'failed',
      readyToApply: false,
      operationId,
      preconditions,
      repositoryPath: resolvedPath,
      changes: [],
      issues: [{
        severity: 'error',
        code,
        message,
      }],
      nextActions,
      error: {
        code,
        message,
        nextActions,
      },
    });
  }
  const manifest = manifestSnapshot.manifest;
  if (!manifest) {
    const error = manifestSnapshot.error;
    return freezePlan({
      schemaVersion: OPERATION_SCHEMA_VERSION,
      operation: 'bind',
      status: 'failed',
      readyToApply: false,
      operationId,
      preconditions,
      repositoryPath: resolvedPath,
      changes: [],
      issues: [{
        severity: 'error',
        code: 'repository.invalidManifest',
        message: 'The selected directory is not a valid MCV Repository.',
      }],
      nextActions: ['Choose a directory containing a valid mcv.yaml manifest.'],
      error: {
        code: 'repository.invalidManifest',
        message: 'The selected directory is not a valid MCV Repository.',
        technicalDetails: error,
        nextActions: ['Choose a directory containing a valid mcv.yaml manifest.'],
      },
    });
  }
  const state = stateSnapshot.state;
  const previousRepositoryPath = state.repositoryPath ?? null;

  if (
    state.defaultRepositoryId
    && state.defaultRepositoryId !== manifest.repositoryId
  ) {
    return freezePlan({
      schemaVersion: OPERATION_SCHEMA_VERSION,
      operation: 'bind',
      status: 'failed',
      readyToApply: false,
      operationId,
      preconditions,
      repositoryPath: resolvedPath,
      changes: [],
      issues: [{
        severity: 'error',
        code: 'repository.idMismatch',
        message: 'The Repository ID does not match the current local binding.',
      }],
      nextActions: ['Unbind the current Repository before binding a different one.'],
      error: {
        code: 'repository.idMismatch',
        message: 'The Repository ID does not match the current local binding.',
        nextActions: ['Unbind the current Repository before binding a different one.'],
      },
    });
  }

  const plan: BindPlan = {
    schemaVersion: OPERATION_SCHEMA_VERSION,
    operation: 'bind',
    status: 'planned',
    readyToApply: true,
    operationId,
    preconditions,
    repositoryPath: resolvedPath,
    changes: [{
      id: 'repository-binding',
      kind: 'bind',
      previousRepositoryPath,
      repositoryPath: resolvedPath,
      repositoryId: manifest.repositoryId,
    }],
    issues: [],
    nextActions: [],
  };
  return registerPlan(plan);
}

export function applyBindPlan(
  context: DeviceContext,
  plan: BindPlan,
): BindResult {
  if (plan.status === 'failed') return failedResultFromPlan(plan);
  const validation = validateActivePlan(context, plan);
  if ('error' in validation) return failedBindResult(plan.repositoryPath, validation.error);

  const change = plan.changes[0];
  if (!change?.repositoryPath || !change.repositoryId) {
    return failedBindResult(plan.repositoryPath, {
      code: 'operation.invalidPlan',
      message: 'The Bind Plan does not contain a valid Repository binding change.',
      nextActions: ['Generate a new Bind Plan.'],
    });
  }

  const state = validation.state;
  state.schemaVersion = 2;
  state.repositoryPath = change.repositoryPath;
  state.defaultRepositoryId = change.repositoryId;
  try {
    writeState(context, state);
  } catch (error) {
    return failedBindResult(plan.repositoryPath, {
      code: 'repository.stateWriteFailed',
      message: 'MCV could not write the local Repository binding.',
      technicalDetails: error instanceof Error ? error.message : String(error),
      nextActions: ['Check permissions for the MCV local state directory and try again.'],
    });
  } finally {
    activeRepositoryPlans.delete(plan);
  }

  return {
    schemaVersion: OPERATION_SCHEMA_VERSION,
    operation: 'bind',
    status: 'succeeded',
    repositoryPath: change.repositoryPath,
    changes: [],
    issues: [],
    nextActions: [],
    data: {
      repositoryId: change.repositoryId,
      repositorySchemaVersion: CURRENT_SCHEMA_VERSION,
      previousRepositoryPath: change.previousRepositoryPath,
    },
  };
}

export function createUnbindPlan(context: DeviceContext): UnbindPlan {
  const stateSnapshot = readStateSnapshot(context);
  const state = stateSnapshot.state;
  const previousRepositoryPath = state.repositoryPath ?? null;
  const repositoryId = state.defaultRepositoryId ?? null;
  const plan: UnbindPlan = {
    schemaVersion: OPERATION_SCHEMA_VERSION,
    operation: 'unbind',
    status: 'planned',
    readyToApply: true,
    operationId: uuidv4(),
    preconditions: {
      state: stateSnapshot.hash,
      stateTarget: hashText(stateSnapshot.path),
    },
    repositoryPath: previousRepositoryPath,
    changes: [{
      id: 'repository-binding',
      kind: 'unbind',
      previousRepositoryPath,
      repositoryPath: null,
      repositoryId,
    }],
    issues: [],
    nextActions: [],
  };
  return registerPlan(plan);
}

export function applyUnbindPlan(
  context: DeviceContext,
  plan: UnbindPlan,
): UnbindResult {
  if (plan.status === 'failed') return failedUnbindResult(plan.repositoryPath, plan.error);
  const validation = validateActivePlan(context, plan);
  if ('error' in validation) return failedUnbindResult(plan.repositoryPath, validation.error);

  const change = plan.changes[0];
  if (!change) {
    return failedUnbindResult(plan.repositoryPath, {
      code: 'operation.invalidPlan',
      message: 'The Unbind Plan does not contain a binding change.',
      nextActions: ['Generate a new Unbind Plan.'],
    });
  }

  const state = validation.state;

  delete state.repositoryPath;
  delete state.defaultRepositoryId;
  try {
    writeState(context, state);
  } catch (error) {
    return failedUnbindResult(plan.repositoryPath, {
      code: 'repository.stateWriteFailed',
      message: 'MCV could not remove the local Repository binding.',
      technicalDetails: error instanceof Error ? error.message : String(error),
      nextActions: ['Check permissions for the MCV local state directory and try again.'],
    });
  } finally {
    activeRepositoryPlans.delete(plan);
  }

  return {
    schemaVersion: OPERATION_SCHEMA_VERSION,
    operation: 'unbind',
    status: 'succeeded',
    repositoryPath: change.previousRepositoryPath,
    changes: [],
    issues: [],
    nextActions: [],
    data: {
      repositoryId: change.repositoryId,
      previousRepositoryPath: change.previousRepositoryPath,
    },
  };
}

function registerPlan<T extends BindPlan | UnbindPlan>(plan: T): T {
  freezePlan(plan);
  activeRepositoryPlans.set(plan, plan.operationId);
  return plan;
}

function freezePlan<T extends BindPlan | UnbindPlan>(plan: T): T {
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
  Object.freeze(plan);
  return plan;
}

function validateActivePlan(
  context: DeviceContext,
  plan: BindPlan | UnbindPlan,
): { state: McvState } | { error: McvError } {
  if (activeRepositoryPlans.get(plan) !== plan.operationId) {
    return { error: {
      code: 'operation.invalidPlan',
      message: 'The Repository Plan is not the active in-process Plan.',
      nextActions: ['Generate a new Repository Plan.'],
    } };
  }

  const stateSnapshot = readStateSnapshot(context);
  const manifestPath = plan.repositoryPath
    ? path.join(plan.repositoryPath, 'mcv.yaml')
    : null;
  const stale = hashText(stateSnapshot.path) !== plan.preconditions.stateTarget
    || stateSnapshot.hash !== plan.preconditions.state
    || (
      plan.operation === 'bind'
      && manifestPath !== null
      && hashOptionalFile(manifestPath) !== plan.preconditions.manifest
    );
  if (!stale) return { state: stateSnapshot.state };

  activeRepositoryPlans.delete(plan);
  return { error: {
    code: 'operation.stalePlan',
    message: 'Repository or local binding state changed after the Plan was generated.',
    nextActions: ['Generate and review a new Repository Plan.'],
  } };
}

function failedResultFromPlan(plan: BindPlan): BindResult {
  const error = plan.status === 'failed'
    ? plan.error
    : {
      code: 'operation.invalidPlan',
      message: 'The Bind Plan cannot be applied.',
      nextActions: ['Generate a new Bind Plan.'],
    };
  return failedBindResult(plan.repositoryPath, error, plan.issues);
}

function failedBindResult(
  repositoryPath: string | null,
  error: McvError,
  issues: Issue[] = [{ severity: 'error', code: error.code, message: error.message }],
): BindResult {
  return {
    schemaVersion: OPERATION_SCHEMA_VERSION,
    operation: 'bind',
    status: 'failed',
    repositoryPath,
    changes: [],
    issues,
    nextActions: error.nextActions,
    error,
  };
}

function failedUnbindResult(
  repositoryPath: string | null,
  error: McvError,
): UnbindResult {
  return {
    schemaVersion: OPERATION_SCHEMA_VERSION,
    operation: 'unbind',
    status: 'failed',
    repositoryPath,
    changes: [],
    issues: [{ severity: 'error', code: error.code, message: error.message }],
    nextActions: error.nextActions,
    error,
  };
}

function hashOptionalFile(filePath: string): string {
  try {
    return createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 'missing';
    return 'unreadable';
  }
}

function hashText(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function readStateSnapshot(context: DeviceContext): {
  path: string;
  hash: string;
  state: McvState;
} {
  const statePath = getStateFilePath(context);
  try {
    const content = fs.readFileSync(statePath);
    let state: McvState = {};
    try {
      state = JSON.parse(content.toString('utf8')) as McvState;
    } catch {
      // Match readState(): invalid local state is treated as empty.
    }
    return {
      path: statePath,
      hash: createHash('sha256').update(content).digest('hex'),
      state,
    };
  } catch (error) {
    return {
      path: statePath,
      hash: (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'missing' : 'unreadable',
      state: {},
    };
  }
}

function readManifestSnapshot(manifestPath: string): {
  hash: string;
  identity: { repositoryId: string | null; schemaVersion: number | null };
  manifest?: McvManifest;
  error?: string;
} {
  let content: Buffer;
  try {
    content = fs.readFileSync(manifestPath);
  } catch (error) {
    return {
      hash: (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'missing' : 'unreadable',
      identity: { repositoryId: null, schemaVersion: null },
      error: error instanceof Error ? error.message : String(error),
    };
  }

  const hash = createHash('sha256').update(content).digest('hex');
  try {
    const raw = yaml.parse(content.toString('utf8')) as unknown;
    if (!isRecord(raw)) {
      return {
        hash,
        identity: { repositoryId: null, schemaVersion: null },
        error: `${manifestPath} must contain a YAML object.`,
      };
    }
    const identity = {
      repositoryId: typeof raw.repositoryId === 'string' ? raw.repositoryId : null,
      schemaVersion: typeof raw.schemaVersion === 'number' ? raw.schemaVersion : null,
    };
    if (identity.schemaVersion !== CURRENT_SCHEMA_VERSION) return { hash, identity };
    validateManifest(raw, manifestPath);
    return { hash, identity, manifest: raw as unknown as McvManifest };
  } catch (error) {
    return {
      hash,
      identity: { repositoryId: null, schemaVersion: null },
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function inspectManifestIdentity(repositoryPath: string): {
  repositoryId: string | null;
  schemaVersion: number | null;
} {
  try {
    const raw = yaml.parse(
      fs.readFileSync(path.join(repositoryPath, 'mcv.yaml'), 'utf8'),
    ) as unknown;
    if (!isRecord(raw)) return { repositoryId: null, schemaVersion: null };
    return {
      repositoryId: typeof raw.repositoryId === 'string' ? raw.repositoryId : null,
      schemaVersion: typeof raw.schemaVersion === 'number' ? raw.schemaVersion : null,
    };
  } catch {
    return { repositoryId: null, schemaVersion: null };
  }
}

function createEmptyManifest(repositoryId: string, initializedAt: string): McvManifest {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    repositoryId,
    initializedAt,
    targets: {
      codex: { enabled: true },
      claudeCode: { enabled: true },
      gemini: {
        enabled: true,
        surfaces: { geminiCli: 'auto', antigravity: 'auto' },
      },
    },
    variables: {},
    security: { scanSecrets: true, allowPlaintextSecrets: false },
    capture: { preserveUnknownNativeFields: true },
    deploy: { backupBeforeWrite: true, useSymlinks: false },
  };
}

function migrateV1Manifest(raw: Record<string, unknown>): McvManifest {
  const targets = isRecord(raw.targets) ? raw.targets : {};
  const gemini = isRecord(targets.gemini) ? targets.gemini : {};
  const migrated = {
    ...raw,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    repositoryId: String(raw.repositoryId),
    initializedAt: typeof raw.initializedAt === 'string' ? raw.initializedAt : new Date().toISOString(),
    targets: {
      ...targets,
      codex: {
        ...(isRecord(targets.codex) ? targets.codex : {}),
        enabled: isRecord(targets.codex) ? targets.codex.enabled !== false : true,
      },
      claudeCode: {
        ...(isRecord(targets.claudeCode) ? targets.claudeCode : {}),
        enabled: isRecord(targets.claudeCode) ? targets.claudeCode.enabled !== false : true,
      },
      gemini: {
        ...gemini,
        enabled: gemini.enabled !== false,
        surfaces: { geminiCli: 'auto', antigravity: 'auto' },
      },
    },
    variables: isRecord(raw.variables) ? raw.variables : {},
    security: { scanSecrets: true, allowPlaintextSecrets: false },
    capture: {
      preserveUnknownNativeFields: !isRecord(raw.capture)
        || raw.capture.preserveUnknownNativeFields !== false,
    },
    deploy: { backupBeforeWrite: true, useSymlinks: false },
  } as unknown as McvManifest;
  delete (migrated as unknown as Record<string, unknown>).includeRuntimeState;
  delete (migrated as unknown as Record<string, unknown>).allowPlaintextSecrets;
  return migrated;
}

function geminiLayoutMappings(repositoryPath: string): Array<{
  id: string;
  sourcePath: string;
  targetPath: string;
}> {
  const nativeRoot = path.join(repositoryPath, 'ide', 'gemini', 'native');
  return [
    { id: 'gemini-settings-layout', sourcePath: path.join(nativeRoot, 'settings.json'), targetPath: path.join(nativeRoot, 'gemini-cli', 'settings.json') },
    { id: 'antigravity-config-layout', sourcePath: path.join(nativeRoot, 'config.json'), targetPath: path.join(nativeRoot, 'antigravity', 'config.json') },
    { id: 'antigravity-mcp-layout', sourcePath: path.join(nativeRoot, 'mcp_config.json'), targetPath: path.join(nativeRoot, 'antigravity', 'mcp_config.json') },
  ];
}

function readNormalizedMcpRegistry(registryPath: string): string | undefined {
  if (!fs.existsSync(registryPath)) return undefined;
  const registry = yaml.parse(fs.readFileSync(registryPath, 'utf8')) as unknown;
  if (!isRecord(registry) || !isRecord(registry.servers)) return undefined;
  const normalized = normalizeMcpServers(registry.servers, 'codex');
  return yaml.stringify({ ...registry, servers: normalized.servers });
}

function hashDirectory(root: string): string {
  const hash = createHash('sha256');
  const visit = (current: string, relative: string): void => {
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink()) {
      hash.update(`link\0${relative}\0${fs.readlinkSync(current)}\0`);
      return;
    }
    if (stat.isDirectory()) {
      hash.update(`directory\0${relative}\0`);
      for (const entry of fs.readdirSync(current).sort()) {
        visit(path.join(current, entry), relative ? `${relative}/${entry}` : entry);
      }
      return;
    }
    if (stat.isFile()) {
      hash.update(`file\0${relative}\0`);
      hash.update(fs.readFileSync(current));
      hash.update('\0');
      return;
    }
    hash.update(`other\0${relative}\0`);
  };
  try {
    visit(root, '');
    return hash.digest('hex');
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'missing' : 'unreadable';
  }
}

function registerLifecyclePlan<T extends InitPlan | MigrationPlan>(plan: T): T {
  freezeLifecyclePlan(plan);
  activeLifecyclePlans.set(plan, plan.operationId);
  return plan;
}

function freezeLifecyclePlan<T extends InitPlan | MigrationPlan>(plan: T): T {
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
  Object.freeze(plan);
  return plan;
}

function validateLifecyclePlan(
  context: DeviceContext,
  plan: InitPlan | MigrationPlan,
): { state: McvState } | { error: McvError } {
  if (activeLifecyclePlans.get(plan) !== plan.operationId) {
    return { error: {
      code: 'operation.invalidPlan',
      message: 'The Repository lifecycle Plan is not the active in-process Plan.',
      nextActions: [`Generate a new ${plan.operation === 'init' ? 'Init' : 'Migration'} Plan.`],
    } };
  }
  if (plan.operation === 'init') {
    const stateSnapshot = readStateSnapshot(context);
    const manifestPath = plan.repositoryPath ? path.join(plan.repositoryPath, 'mcv.yaml') : '';
    const stale = hashText(stateSnapshot.path) !== plan.preconditions.stateTarget
      || stateSnapshot.hash !== plan.preconditions.state
      || hashText(manifestPath) !== plan.preconditions.manifestTarget
      || hashOptionalFile(manifestPath) !== plan.preconditions.manifest;
    if (!stale) return { state: stateSnapshot.state };
  } else {
    const backupTarget = path.dirname(getStateFilePath(context));
    const stale = hashText(plan.repositoryPath ?? '') !== plan.preconditions.repositoryTarget
      || hashText(backupTarget) !== plan.preconditions.stateTarget
      || hashDirectory(plan.repositoryPath ?? '') !== plan.preconditions.repository;
    if (!stale) return { state: readState(context) };
  }
  activeLifecyclePlans.delete(plan);
  return { error: {
    code: 'operation.stalePlan',
    message: 'Repository or local binding state changed after the Plan was generated.',
    nextActions: [`Generate and review a new ${plan.operation === 'init' ? 'Init' : 'Migration'} Plan.`],
  } };
}

function failedInitResult(
  repositoryPath: string | null,
  error: McvError,
  issues: Issue[] = [{ severity: 'error', code: error.code, message: error.message }],
): InitResult {
  return {
    schemaVersion: OPERATION_SCHEMA_VERSION,
    operation: 'init',
    status: 'failed',
    repositoryPath,
    changes: [],
    issues,
    nextActions: error.nextActions,
    error,
  };
}

function failedMigrationResult(
  repositoryPath: string | null,
  error: McvError,
  issues: Issue[] = [{ severity: 'error', code: error.code, message: error.message }],
): MigrationResult {
  return {
    schemaVersion: OPERATION_SCHEMA_VERSION,
    operation: 'migrate',
    status: 'failed',
    repositoryPath,
    changes: [],
    issues,
    nextActions: error.nextActions,
    error,
  };
}
