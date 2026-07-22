import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'yaml';
import { execFileSync } from 'child_process';
import { createHash } from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import type { DeviceContext } from '../adapters/types';
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

const activeRepositoryPlans = new WeakMap<object, string>();

export function inspectRepository(context: DeviceContext): RepositoryReport {
  const state = readState(context);
  const repositoryPath = state.repositoryPath ?? null;

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
    return { git: { branch, clean: status.trim().length === 0 } };
  } catch {
    return {};
  }
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
