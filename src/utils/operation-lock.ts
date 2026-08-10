import { createHash, randomUUID } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

interface OperationLockRecord {
  token: string;
  pid: number;
  createdAt: string;
}

export interface OperationLockHandle {
  lockPath: string;
  token: string;
}

export interface OperationLockOptions {
  lockRoot?: string;
}

export class OperationLockBusyError extends Error {
  constructor() {
    super('Another MCV process is already modifying this resource.');
    this.name = 'OperationLockBusyError';
  }
}

export function repositoryOperationLockResource(repositoryPath: string): string {
  return `repository:${canonicalResourcePath(repositoryPath)}`;
}

export function deployOperationLockResource(
  scope: 'project' | 'global',
  targetRoot: string,
): string {
  return `deploy:${scope}:${canonicalResourcePath(targetRoot)}`;
}

export function acquireOperationLock(
  resource: string,
  options: OperationLockOptions = {},
): OperationLockHandle {
  const lockRoot = options.lockRoot ?? path.join(os.tmpdir(), 'mcv-operation-locks');
  fs.mkdirSync(lockRoot, { recursive: true, mode: 0o700 });
  const identity = createHash('sha256').update(resource).digest('hex');
  const lockPath = path.join(lockRoot, `${identity}.lock`);

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const token = randomUUID();
    const record: OperationLockRecord = {
      token,
      pid: process.pid,
      createdAt: new Date().toISOString(),
    };
    try {
      const descriptor = fs.openSync(lockPath, 'wx', 0o600);
      try {
        fs.writeFileSync(descriptor, `${JSON.stringify(record)}\n`);
        fs.fsyncSync(descriptor);
      } finally {
        fs.closeSync(descriptor);
      }
      return { lockPath, token };
    } catch (error) {
      if (!isAlreadyExistsError(error)) throw error;
      const current = readOperationLockRecord(lockPath);
      if (!current || processIsAlive(current.pid)) {
        throw new OperationLockBusyError();
      }
      if (!quarantineStaleLock(lockPath)) {
        throw new OperationLockBusyError();
      }
    }
  }

  throw new OperationLockBusyError();
}

export function releaseOperationLock(handle: OperationLockHandle): void {
  const current = readOperationLockRecord(handle.lockPath);
  if (!current || current.token !== handle.token) return;
  try {
    fs.rmSync(handle.lockPath, { force: true });
  } catch {
    // A failed release leaves a recoverable stale lock owned by this process.
  }
}

function readOperationLockRecord(lockPath: string): OperationLockRecord | undefined {
  try {
    const value = JSON.parse(fs.readFileSync(lockPath, 'utf8')) as unknown;
    if (
      typeof value !== 'object'
      || value === null
      || !('token' in value)
      || !('pid' in value)
      || !('createdAt' in value)
      || typeof value.token !== 'string'
      || typeof value.pid !== 'number'
      || !Number.isInteger(value.pid)
      || value.pid <= 0
      || typeof value.createdAt !== 'string'
    ) {
      return undefined;
    }
    return {
      token: value.token,
      pid: value.pid,
      createdAt: value.createdAt,
    };
  } catch {
    return undefined;
  }
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !(
      typeof error === 'object'
      && error !== null
      && 'code' in error
      && error.code === 'ESRCH'
    );
  }
}

function quarantineStaleLock(lockPath: string): boolean {
  const stalePath = `${lockPath}.${process.pid}.${randomUUID()}.stale`;
  try {
    fs.renameSync(lockPath, stalePath);
  } catch {
    return false;
  }
  try {
    fs.rmSync(stalePath, { force: true });
  } catch {
    // The quarantined path no longer blocks acquisition.
  }
  return true;
}

function isAlreadyExistsError(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && error.code === 'EEXIST';
}

function canonicalResourcePath(candidate: string): string {
  let canonical: string;
  try {
    canonical = fs.realpathSync.native(candidate);
  } catch {
    canonical = path.resolve(candidate);
  }
  const normalized = path.normalize(canonical);
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}
