import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DeviceContext } from '../adapters/types';
import { readState, writeState } from '../utils/state';
import { applyRestorePlan, createRestorePlan } from './restore';

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

  it('applies the complete reviewed Restore Plan and saves the current state', () => {
    const addedPath = path.join(testRoot, 'target', 'added.txt');
    fs.writeFileSync(addedPath, 'added by deploy');
    const directory = path.join(backupRoot, 'valid');
    fs.mkdirSync(path.join(directory, 'files'), { recursive: true });
    fs.writeFileSync(path.join(directory, 'files', 'settings.json'), 'original content');
    fs.writeFileSync(path.join(directory, 'manifest.json'), `${JSON.stringify({
      createdAt: '2026-07-19T00:00:00.000Z',
      status: 'complete',
      files: [
        {
          action: 'modify',
          originalPath: targetPath,
          backupPath: 'files/settings.json',
          beforeHash: hash('original content'),
          afterHash: hash('latest deployed content'),
        },
        {
          action: 'add',
          originalPath: addedPath,
          afterHash: hash('added by deploy'),
        },
      ],
    }, null, 2)}\n`);

    const plan = createRestorePlan(context);
    const result = applyRestorePlan(context, plan, {
      changeIds: plan.changes.map((change) => change.id),
    });

    expect(result).toMatchObject({
      status: 'succeeded',
      changes: [
        { action: 'restore', targetPath },
        { action: 'delete', targetPath: addedPath },
      ],
      data: {
        appliedChangeIds: plan.changes.map((change) => change.id),
        restoredPaths: [targetPath],
        deletedPaths: [addedPath],
        backupPath: expect.stringContaining('restore-backups'),
      },
    });
    expect(fs.readFileSync(targetPath, 'utf8')).toBe('original content');
    expect(fs.existsSync(addedPath)).toBe(false);
    expect(fs.existsSync(path.join(result.status === 'succeeded' ? result.data?.backupPath ?? '' : '', 'manifest.json'))).toBe(true);
  });

  it('rejects an incomplete selection before creating a current-state backup', () => {
    createBackup('valid', '2026-07-19T00:00:00.000Z', 'original content');
    const plan = createRestorePlan(context);

    const result = applyRestorePlan(context, plan, { changeIds: [] });

    expect(result).toMatchObject({
      status: 'failed',
      error: { code: 'restore.invalidSelection' },
    });
    expect(fs.readFileSync(targetPath, 'utf8')).toBe('latest deployed content');
    expect(fs.existsSync(path.join(homeDir, 'mcv', 'restore-backups'))).toBe(false);
  });

  it('blocks non-interactive deletion before creating a current-state backup', () => {
    const directory = path.join(backupRoot, 'valid-add');
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify({
      createdAt: '2026-07-19T00:00:00.000Z',
      status: 'complete',
      files: [{
        action: 'add',
        originalPath: targetPath,
        afterHash: hash('latest deployed content'),
      }],
    }));
    const plan = createRestorePlan(context);

    const result = applyRestorePlan(
      context,
      plan,
      { changeIds: plan.changes.map((change) => change.id) },
      { nonInteractive: true },
    );

    expect(result).toMatchObject({
      status: 'blocked',
      issues: [{ severity: 'decisionRequired', code: 'restore.nonInteractiveBlocked' }],
    });
    expect(fs.readFileSync(targetPath, 'utf8')).toBe('latest deployed content');
    expect(fs.existsSync(path.join(homeDir, 'mcv', 'restore-backups'))).toBe(false);
  });

  it('rejects stale source or target hashes before creating a current-state backup', () => {
    createBackup('valid', '2026-07-19T00:00:00.000Z', 'original content');
    const plan = createRestorePlan(context);
    fs.writeFileSync(targetPath, 'changed after review');

    const result = applyRestorePlan(context, plan, {
      changeIds: plan.changes.map((change) => change.id),
    });

    expect(result).toMatchObject({ status: 'failed', error: { code: 'operation.stalePlan' } });
    expect(fs.readFileSync(targetPath, 'utf8')).toBe('changed after review');
    expect(fs.existsSync(path.join(homeDir, 'mcv', 'restore-backups'))).toBe(false);
  });

  it('rejects a changed Restore source before creating a current-state backup', () => {
    createBackup('valid', '2026-07-19T00:00:00.000Z', 'original content');
    const plan = createRestorePlan(context);
    fs.writeFileSync(path.join(backupRoot, 'valid', 'files', 'settings.json'), 'changed backup');

    const result = applyRestorePlan(context, plan, {
      changeIds: plan.changes.map((change) => change.id),
    });

    expect(result).toMatchObject({ status: 'failed', error: { code: 'operation.stalePlan' } });
    expect(fs.readFileSync(targetPath, 'utf8')).toBe('latest deployed content');
    expect(fs.existsSync(path.join(homeDir, 'mcv', 'restore-backups'))).toBe(false);
  });

  it('blocks a Restore Conflict before creating a current-state backup', () => {
    createBackup('valid', '2026-07-19T00:00:00.000Z', 'original content');
    fs.writeFileSync(targetPath, 'changed after deploy');
    const plan = createRestorePlan(context);

    const result = applyRestorePlan(context, plan, {
      changeIds: plan.changes.map((change) => change.id),
    });

    expect(result).toMatchObject({
      status: 'blocked',
      issues: [{ code: 'restore.conflict' }],
    });
    expect(fs.existsSync(path.join(homeDir, 'mcv', 'restore-backups'))).toBe(false);
  });

  it('fails before the first target write when the current-state backup fails', () => {
    createBackup('valid', '2026-07-19T00:00:00.000Z', 'original content');
    const plan = createRestorePlan(context);

    const result = applyRestorePlan(
      context,
      plan,
      { changeIds: plan.changes.map((change) => change.id) },
      { copyFile: () => { throw new Error('backup disk full'); } },
    );

    expect(result).toMatchObject({
      status: 'failed',
      error: {
        code: 'restore.backupFailed',
        technicalDetails: expect.stringContaining('backup disk full'),
      },
    });
    expect(fs.readFileSync(targetPath, 'utf8')).toBe('latest deployed content');
  });

  it('restores a deleted target when a later Restore write fails', () => {
    const addedPath = path.join(testRoot, 'target', 'added.txt');
    fs.writeFileSync(addedPath, 'added by deploy');
    const directory = path.join(backupRoot, 'valid');
    fs.mkdirSync(path.join(directory, 'files'), { recursive: true });
    fs.writeFileSync(path.join(directory, 'files', 'settings.json'), 'original content');
    fs.writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify({
      createdAt: '2026-07-19T00:00:00.000Z',
      status: 'complete',
      files: [
        { action: 'add', originalPath: addedPath, afterHash: hash('added by deploy') },
        {
          action: 'modify',
          originalPath: targetPath,
          backupPath: 'files/settings.json',
          beforeHash: hash('original content'),
          afterHash: hash('latest deployed content'),
        },
      ],
    }));
    const plan = createRestorePlan(context);

    const result = applyRestorePlan(
      context,
      plan,
      { changeIds: plan.changes.map((change) => change.id) },
      { writeFile: () => { throw new Error('simulated write failure'); } },
    );

    expect(result).toMatchObject({
      status: 'failed',
      error: { code: 'restore.transactionFailed', technicalDetails: expect.stringContaining('simulated write failure') },
    });
    expect(fs.readFileSync(addedPath, 'utf8')).toBe('added by deploy');
    expect(fs.readFileSync(targetPath, 'utf8')).toBe('latest deployed content');
  });

  it('rolls back restored files and device state when the state commit fails', () => {
    createBackup('valid', '2026-07-19T00:00:00.000Z', 'original content');
    const originalState = {
      schemaVersion: 2 as const,
      baselineSnapshot: { recordedAt: '2026-07-19T00:00:00.000Z', files: { [targetPath]: hash('latest deployed content') } },
      managedInventory: { [targetPath]: { source: 'repository', hash: hash('latest deployed content') } },
    };
    writeState(context, originalState);
    const plan = createRestorePlan(context);

    const result = applyRestorePlan(
      context,
      plan,
      { changeIds: plan.changes.map((change) => change.id) },
      {
        updateState: (stateContext, state) => {
          writeState(stateContext, state);
          throw new Error('state commit failed');
        },
      },
    );

    expect(result).toMatchObject({
      status: 'failed',
      error: { code: 'restore.transactionFailed', technicalDetails: expect.stringContaining('state commit failed') },
    });
    expect(fs.readFileSync(targetPath, 'utf8')).toBe('latest deployed content');
    expect(readState(context)).toEqual(originalState);
  });

  it('preserves the verified recovery path when automatic rollback is incomplete', () => {
    createBackup('valid', '2026-07-19T00:00:00.000Z', 'original content');
    const plan = createRestorePlan(context);

    const result = applyRestorePlan(
      context,
      plan,
      { changeIds: plan.changes.map((change) => change.id) },
      {
        writeFile: () => { throw new Error('write failed'); },
        restoreFile: () => { throw new Error('rollback denied'); },
      },
    );

    expect(result).toMatchObject({
      status: 'failed',
      error: {
        code: 'restore.rollbackFailed',
        technicalDetails: expect.stringContaining('rollback denied'),
        nextActions: [expect.stringContaining('restore-backups')],
      },
    });
  });

  it('honors cancellation before backup and ignores it once commit starts', () => {
    createBackup('valid', '2026-07-19T00:00:00.000Z', 'original content');
    const cancelledPlan = createRestorePlan(context);
    const cancelled = new AbortController();
    cancelled.abort();

    const cancelledResult = applyRestorePlan(
      context,
      cancelledPlan,
      { changeIds: cancelledPlan.changes.map((change) => change.id) },
      { signal: cancelled.signal },
    );

    expect(cancelledResult).toMatchObject({ status: 'blocked', issues: [{ code: 'restore.cancelled' }] });
    expect(fs.existsSync(path.join(homeDir, 'mcv', 'restore-backups'))).toBe(false);

    const activePlan = createRestorePlan(context);
    const duringCommit = new AbortController();
    const result = applyRestorePlan(
      context,
      activePlan,
      { changeIds: activePlan.changes.map((change) => change.id) },
      {
        signal: duringCommit.signal,
        writeFile: (pathToWrite, content) => {
          duringCommit.abort();
          fs.writeFileSync(pathToWrite, content);
        },
      },
    );

    expect(result.status).toBe('succeeded');
    expect(fs.readFileSync(targetPath, 'utf8')).toBe('original content');
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
