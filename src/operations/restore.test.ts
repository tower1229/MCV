import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DeviceContext } from '../adapters/types';
import { createRestorePlan } from './restore';

describe('Restore operations', () => {
  let testRoot: string;
  let homeDir: string;
  let context: DeviceContext;
  let backupRoot: string;
  let targetPath: string;

  beforeEach(() => {
    testRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mcv-restore-operation-')));
    homeDir = path.join(testRoot, 'home');
    context = {
      homeDir,
      platform: 'win32',
      env: { APPDATA: homeDir },
    };
    backupRoot = path.join(homeDir, 'mcv', 'backups');
    targetPath = path.join(testRoot, 'target', 'settings.json');
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.writeFileSync(targetPath, 'latest deployed content');
  });

  afterEach(() => {
    fs.rmSync(testRoot, { recursive: true, force: true });
  });

  it('selects the latest complete verified Deploy backup without writing', () => {
    createBackup('older-valid', '2026-07-18T00:00:00.000Z', 'older original');
    createBackup('latest-valid', '2026-07-19T00:00:00.000Z', 'latest original');
    createBackup('newer-failed', '2026-07-20T00:00:00.000Z', 'failed original', 'failed');
    createBackup('newest-corrupt', '2026-07-21T00:00:00.000Z', 'corrupt original', 'complete', {
      beforeHash: hash('different content'),
    });
    const before = hashDirectory(testRoot);

    const plan = createRestorePlan(context);

    expect(plan).toMatchObject({
      schemaVersion: 1,
      operation: 'restore',
      status: 'planned',
      readyToApply: true,
      operationId: expect.any(String),
      repositoryPath: null,
      backup: { createdAt: '2026-07-19T00:00:00.000Z' },
      changes: [{
        id: expect.stringMatching(/^restore-[a-f0-9]{16}$/),
        action: 'restore',
        targetPath,
      }],
      issues: [],
      nextActions: [expect.stringContaining('restore')],
    });
    expect(plan.preconditions).toMatchObject({
      [`source:${plan.changes[0].id}`]: hash('latest original'),
      [`target:${plan.changes[0].id}`]: hash('latest deployed content'),
    });
    expect(Object.isFrozen(plan)).toBe(true);
    expect(hashDirectory(testRoot)).toBe(before);
  });

  it('blocks post-deploy changes with a structured Restore Conflict', () => {
    createBackup('valid', '2026-07-19T00:00:00.000Z', 'original content');
    fs.writeFileSync(targetPath, 'changed after deploy');

    const plan = createRestorePlan(context);

    expect(plan).toMatchObject({
      status: 'planned',
      readyToApply: false,
      changes: [{ action: 'restore', targetPath }],
      issues: [{
        severity: 'error',
        code: 'restore.conflict',
        message: expect.stringContaining('changed after the deployment'),
        details: targetPath,
      }],
      nextActions: [expect.stringContaining('manually resolve')],
    });
    expect(plan.issues[0].code).not.toContain('drift');
  });

  it('plans deletion when Restore reverses a file added by Deploy', () => {
    const directory = path.join(backupRoot, 'valid-add');
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, 'manifest.json'), `${JSON.stringify({
      createdAt: '2026-07-19T00:00:00.000Z',
      status: 'complete',
      files: [{
        action: 'add',
        originalPath: targetPath,
        afterHash: hash('latest deployed content'),
      }],
    }, null, 2)}\n`);

    const plan = createRestorePlan(context);

    expect(plan).toMatchObject({
      status: 'planned',
      readyToApply: true,
      changes: [{ action: 'delete', targetPath }],
    });
  });

  function createBackup(
    name: string,
    createdAt: string,
    originalContent: string,
    status: 'complete' | 'failed' | 'pending' = 'complete',
    overrides: Record<string, unknown> = {},
  ): void {
    const directory = path.join(backupRoot, name);
    const relativeBackupPath = path.join('files', 'settings.json');
    fs.mkdirSync(path.join(directory, 'files'), { recursive: true });
    fs.writeFileSync(path.join(directory, relativeBackupPath), originalContent);
    fs.writeFileSync(path.join(directory, 'manifest.json'), `${JSON.stringify({
      createdAt,
      status,
      files: [{
        action: 'modify',
        originalPath: targetPath,
        backupPath: relativeBackupPath,
        beforeHash: hash(originalContent),
        afterHash: hash('latest deployed content'),
        ...overrides,
      }],
    }, null, 2)}\n`);
  }
});

function hash(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function hashDirectory(root: string): string {
  const hashValue = crypto.createHash('sha256');
  const visit = (directory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name))) {
      const current = path.join(directory, entry.name);
      hashValue.update(path.relative(root, current));
      if (entry.isDirectory()) visit(current);
      else hashValue.update(fs.readFileSync(current));
    }
  };
  visit(root);
  return hashValue.digest('hex');
}
