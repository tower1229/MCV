import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  acquireOperationLock,
  OperationLockBusyError,
  releaseOperationLock,
} from './operation-lock.js';

describe('Operation Lock', () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('fails immediately while a live owner holds the same resource', () => {
    const lockRoot = createLockRoot();
    const first = acquireOperationLock('repository:/private/example', { lockRoot });

    expect(() => acquireOperationLock('repository:/private/example', { lockRoot }))
      .toThrow(OperationLockBusyError);

    releaseOperationLock(first);
    const second = acquireOperationLock('repository:/private/example', { lockRoot });
    releaseOperationLock(second);
  });

  it('does not release a newer lock when the ownership token differs', () => {
    const lockRoot = createLockRoot();
    const lock = acquireOperationLock('deploy:project:/private/example', { lockRoot });

    releaseOperationLock({ ...lock, token: 'not-the-owner' });

    expect(() => acquireOperationLock('deploy:project:/private/example', { lockRoot }))
      .toThrow(OperationLockBusyError);
    releaseOperationLock(lock);
  });

  it('reclaims a lock left by a process that no longer exists', () => {
    const lockRoot = createLockRoot();
    const previous = acquireOperationLock('repository:/private/stale', { lockRoot });
    releaseOperationLock(previous);
    fs.writeFileSync(previous.lockPath, `${JSON.stringify({
      token: 'stale-owner',
      pid: 2_147_483_647,
      createdAt: '2026-08-10T00:00:00.000Z',
    })}\n`);

    const current = acquireOperationLock('repository:/private/stale', { lockRoot });

    expect(current.token).not.toBe('stale-owner');
    releaseOperationLock(current);
  });

  it('hashes resource identity without storing the resource path', () => {
    const lockRoot = createLockRoot();
    const resource = 'deploy:project:/private/customer-project';
    const lock = acquireOperationLock(resource, { lockRoot });

    expect(lock.lockPath).not.toContain('customer-project');
    expect(fs.readFileSync(lock.lockPath, 'utf8')).not.toContain(resource);
    releaseOperationLock(lock);
  });

  function createLockRoot(): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mcv-operation-lock-'));
    roots.push(root);
    return root;
  }
});
