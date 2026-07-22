import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'yaml';
import { execFileSync } from 'child_process';
import type { DeviceContext } from '../adapters/types';
import { isRecord } from '../utils/objects';
import { readManifest, type McvManifest } from '../utils/repository';
import { readState, writeState } from '../utils/state';
import {
  OPERATION_SCHEMA_VERSION,
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

export interface RepositoryUnbindData {
  repositoryId: string | null;
  previousRepositoryPath: string | null;
}

export type UnbindResult = Result<RepositoryUnbindData, never> & {
  operation: 'unbind';
  changes: [];
};

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

  let inspectedRepositoryId = state.defaultRepositoryId ?? null;
  let inspectedSchemaVersion: number | null = null;
  try {
    const raw = yaml.parse(
      fs.readFileSync(path.join(repositoryPath, 'mcv.yaml'), 'utf8'),
    ) as unknown;
    if (isRecord(raw)) {
      if (typeof raw.repositoryId === 'string') inspectedRepositoryId = raw.repositoryId;
      if (typeof raw.schemaVersion === 'number') inspectedSchemaVersion = raw.schemaVersion;
    }
  } catch {
    // Full validation below provides the stable Issue and technical details.
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

export function bindRepository(
  context: DeviceContext,
  repositoryPath: string = process.cwd(),
): BindResult {
  const resolvedPath = path.resolve(repositoryPath);
  let manifest: McvManifest;
  try {
    manifest = readManifest(resolvedPath);
  } catch (error) {
    return {
      schemaVersion: OPERATION_SCHEMA_VERSION,
      operation: 'bind',
      status: 'failed',
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
        technicalDetails: error instanceof Error ? error.message : String(error),
        nextActions: ['Choose a directory containing a valid mcv.yaml manifest.'],
      },
    };
  }
  const state = readState(context);
  const previousRepositoryPath = state.repositoryPath ?? null;

  if (
    state.defaultRepositoryId
    && state.defaultRepositoryId !== manifest.repositoryId
  ) {
    return {
      schemaVersion: OPERATION_SCHEMA_VERSION,
      operation: 'bind',
      status: 'failed',
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
    };
  }

  state.schemaVersion = 2;
  state.repositoryPath = resolvedPath;
  state.defaultRepositoryId = manifest.repositoryId;
  writeState(context, state);

  return {
    schemaVersion: OPERATION_SCHEMA_VERSION,
    operation: 'bind',
    status: 'succeeded',
    repositoryPath: resolvedPath,
    changes: [],
    issues: [],
    nextActions: [],
    data: {
      repositoryId: manifest.repositoryId,
      repositorySchemaVersion: manifest.schemaVersion,
      previousRepositoryPath,
    },
  };
}

export function unbindRepository(context: DeviceContext): UnbindResult {
  const state = readState(context);
  const previousRepositoryPath = state.repositoryPath ?? null;
  const repositoryId = state.defaultRepositoryId ?? null;

  delete state.repositoryPath;
  delete state.defaultRepositoryId;
  writeState(context, state);

  return {
    schemaVersion: OPERATION_SCHEMA_VERSION,
    operation: 'unbind',
    status: 'succeeded',
    repositoryPath: previousRepositoryPath,
    changes: [],
    issues: [],
    nextActions: [],
    data: {
      repositoryId,
      previousRepositoryPath,
    },
  };
}
