import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DeviceContext } from '../adapters/types';
import { atomicWriteFile } from '../utils/files';
import { readState, writeState } from '../utils/state';
import { applyDeployPlan, createDeployPlan } from './deploy';

describe('Deploy operations', () => {
  let testRoot: string;
  let homeDir: string;
  let repositoryPath: string;
  let context: DeviceContext;

  beforeEach(() => {
    testRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mcv-deploy-operation-')));
    homeDir = path.join(testRoot, 'home');
    repositoryPath = path.join(testRoot, 'repository');
    fs.mkdirSync(path.join(homeDir, '.claude'), { recursive: true });
    fs.mkdirSync(path.join(repositoryPath, 'common', 'skills', 'review'), { recursive: true });
    fs.mkdirSync(path.join(repositoryPath, 'ide', 'claude-code', 'native'), { recursive: true });
    fs.writeFileSync(path.join(repositoryPath, 'mcv.yaml'), [
      'schemaVersion: 2',
      'repositoryId: deploy-operation-test',
      'initializedAt: 2026-07-22T00:00:00.000Z',
      'security: { scanSecrets: true, allowPlaintextSecrets: false }',
      'capture: { preserveUnknownNativeFields: true }',
      'deploy: { backupBeforeWrite: true, useSymlinks: false }',
      'targets:',
      '  claudeCode:',
      '    enabled: true',
      'variables: {}',
      '',
    ].join('\n'));
    fs.writeFileSync(path.join(repositoryPath, 'common', 'AGENTS.md'), '# Repository rules\n');
    fs.writeFileSync(path.join(repositoryPath, 'common', 'skills', 'review', 'SKILL.md'), '# Review\n');
    fs.writeFileSync(path.join(repositoryPath, 'common', 'mcp.yaml'), 'servers:\n  docs:\n    command: docs-server\n');
    fs.writeFileSync(
      path.join(repositoryPath, 'ide', 'claude-code', 'native', 'settings.json'),
      `${JSON.stringify({ theme: 'dark' }, null, 2)}\n`,
    );
    fs.writeFileSync(
      path.join(repositoryPath, 'ide', 'claude-code', 'native', '.claude.json'),
      `${JSON.stringify({ compactMode: true }, null, 2)}\n`,
    );
    fs.writeFileSync(path.join(homeDir, '.claude', 'CLAUDE.md'), '# Device rules\n');
    fs.writeFileSync(
      path.join(homeDir, '.claude', 'settings.json'),
      `${JSON.stringify({ theme: 'light', localOnly: 'must-be-preserved' }, null, 2)}\n`,
    );
    fs.writeFileSync(
      path.join(homeDir, '.claude.json'),
      `${JSON.stringify({ localState: 'must-be-preserved' }, null, 2)}\n`,
    );
    const stalePath = path.join(homeDir, '.claude', 'skills', 'stale', 'SKILL.md');
    fs.mkdirSync(path.dirname(stalePath), { recursive: true });
    fs.writeFileSync(stalePath, 'stale\n');
    const staleOverlayPath = path.join(homeDir, '.claude', 'stale-settings.json');
    fs.writeFileSync(staleOverlayPath, '{"localOnly":true}\n');
    context = {
      homeDir,
      platform: 'darwin',
      env: { APPDATA: path.join(testRoot, 'state') },
      pathEnv: '',
    };
    writeState(context, {
      schemaVersion: 2,
      defaultRepositoryId: 'deploy-operation-test',
      repositoryPath,
      managedInventory: {
        [stalePath]: {
          source: repositoryPath,
          hash: crypto.createHash('sha256').update('stale\n').digest('hex'),
        },
        [staleOverlayPath]: {
          source: repositoryPath,
          hash: crypto.createHash('sha256').update('{"localOnly":true}\n').digest('hex'),
        },
      },
    });
  });

  afterEach(() => {
    fs.rmSync(testRoot, { recursive: true, force: true });
  });

  it('returns a grouped read-only Plan with stable IDs, safe previews, and precondition hashes', async () => {
    const repositoryBefore = hashDirectory(repositoryPath);
    const stateBefore = readState(context);
    const first = await createDeployPlan(context);
    const second = await createDeployPlan(context);

    expect(first).toMatchObject({
      schemaVersion: 1,
      operation: 'deploy',
      status: 'planned',
      readyToApply: true,
      repositoryPath,
      operationId: expect.any(String),
      preconditions: expect.any(Object),
      issues: [],
      nextActions: [],
    });
    expect(first.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        ide: 'claude-code', capability: 'rules', change: 'modify',
        defaultSelected: true, group: 'standard', strategy: 'replace-entire-file',
      }),
      expect.objectContaining({
        ide: 'claude-code', capability: 'skills', change: 'add',
        defaultSelected: true, group: 'standard', strategy: 'replace-entire-file',
      }),
      expect.objectContaining({
        ide: 'claude-code', capability: 'mcp', change: 'modify',
        defaultSelected: true, group: 'standard', strategy: 'managed-merge',
      }),
      expect.objectContaining({
        ide: 'claude-code', capability: 'native', change: 'modify',
        defaultSelected: true, group: 'standard', strategy: 'managed-merge',
      }),
      expect.objectContaining({
        ide: 'claude-code', capability: 'skills', change: 'delete',
        defaultSelected: false, group: 'advanced', strategy: 'replace-entire-file',
      }),
    ]));
    expect(first.changes.every((change) => /^deploy-[a-f0-9]{16}$/.test(change.id))).toBe(true);
    const claudeStateChanges = first.changes.filter(
      (change) => change.targetPath === path.join(homeDir, '.claude.json'),
    );
    expect(claudeStateChanges.map((change) => change.capability)).toEqual(['mcp', 'native']);
    expect(claudeStateChanges.find((change) => change.capability === 'native')?.preview)
      .toMatchObject({ kind: 'text', diff: expect.stringContaining('compactMode') });
    expect(first.changes.some((change) => change.targetPath.endsWith('stale-settings.json'))).toBe(false);
    expect(second.changes.map((change) => change.id)).toEqual(first.changes.map((change) => change.id));
    for (const change of first.changes) {
      expect(first.preconditions[`source:${change.id}`]).toMatch(/^[a-f0-9]{64}$/);
      expect(first.preconditions[`target:${change.id}`]).toMatch(/^[a-f0-9]{64}$/);
    }
    expect(JSON.stringify(first)).not.toContain('must-be-preserved');
    expect(hashDirectory(repositoryPath)).toBe(repositoryBefore);
    expect(readState(context)).toEqual(stateBefore);
  });

  it('keeps source and target preconditions independent', async () => {
    const settingsTarget = path.join(homeDir, '.claude', 'settings.json');
    const first = await createDeployPlan(context);
    const native = first.changes.find((change) => change.targetPath === settingsTarget);
    if (!native) throw new Error('expected native settings change');

    fs.writeFileSync(
      path.join(repositoryPath, 'ide', 'claude-code', 'native', 'settings.json'),
      `${JSON.stringify({ theme: 'solarized' }, null, 2)}\n`,
    );
    const sourceChanged = await createDeployPlan(context);
    expect(sourceChanged.preconditions[`source:${native.id}`]).not.toBe(
      first.preconditions[`source:${native.id}`],
    );
    expect(sourceChanged.preconditions[`target:${native.id}`]).toBe(
      first.preconditions[`target:${native.id}`],
    );

    fs.writeFileSync(
      settingsTarget,
      `${JSON.stringify({ theme: 'light', localOnly: 'changed-locally' }, null, 2)}\n`,
    );
    const targetChanged = await createDeployPlan(context);
    expect(targetChanged.preconditions[`source:${native.id}`]).toBe(
      sourceChanged.preconditions[`source:${native.id}`],
    );
    expect(targetChanged.preconditions[`target:${native.id}`]).not.toBe(
      sourceChanged.preconditions[`target:${native.id}`],
    );
  });

  it('freezes failed Plans just like successful Plans', async () => {
    fs.writeFileSync(path.join(repositoryPath, 'mcv.yaml'), 'schemaVersion: [invalid\n');
    const plan = await createDeployPlan(context);

    expect(plan.status).toBe('failed');
    expect(Object.isFrozen(plan)).toBe(true);
    expect(Object.isFrozen(plan.changes)).toBe(true);
    expect(Object.isFrozen(plan.issues)).toBe(true);
    expect(Object.isFrozen(plan.preconditions)).toBe(true);
  });

  it('binds deletion source preconditions to the managed inventory entry', async () => {
    const first = await createDeployPlan(context);
    const deletion = first.changes.find((change) => change.change === 'delete');
    if (!deletion) throw new Error('expected deletion candidate');
    const state = readState(context);
    if (!state.managedInventory?.[deletion.targetPath]) throw new Error('expected managed inventory entry');
    state.managedInventory[deletion.targetPath].hash = 'changed-inventory-hash';
    writeState(context, state);

    const changed = await createDeployPlan(context);
    expect(changed.preconditions[`source:${deletion.id}`]).not.toBe(
      first.preconditions[`source:${deletion.id}`],
    );
    expect(changed.preconditions[`target:${deletion.id}`]).toBe(
      first.preconditions[`target:${deletion.id}`],
    );
  });

  it('emits only the capability whose fields changed in a mixed target', async () => {
    fs.writeFileSync(
      path.join(homeDir, '.claude.json'),
      `${JSON.stringify({
        localState: 'must-be-preserved',
        mcpServers: { docs: { command: 'docs-server' } },
      }, null, 2)}\n`,
    );

    const plan = await createDeployPlan(context);
    const mixedChanges = plan.changes.filter(
      (change) => change.targetPath === path.join(homeDir, '.claude.json'),
    );

    expect(mixedChanges).toHaveLength(1);
    expect(mixedChanges[0]).toMatchObject({ capability: 'native', change: 'modify' });
    expect(mixedChanges[0].preview).toMatchObject({
      kind: 'text',
      diff: expect.stringContaining('compactMode'),
    });
  });

  it('fails before the first write when a selected backup cannot be verified', async () => {
    const targetPath = path.join(homeDir, '.claude', 'CLAUDE.md');
    const before = fs.readFileSync(targetPath, 'utf8');
    const stateBefore = readState(context);
    const plan = await createDeployPlan(context);
    const selected = plan.changes.find((change) => change.targetPath === targetPath);
    if (!selected) throw new Error('expected Shared Rules change');

    const result = await applyDeployPlan(context, plan, { changeIds: [selected.id] }, {
      copyFile: () => { throw new Error('backup disk full'); },
    });

    expect(result).toMatchObject({
      status: 'failed',
      error: { code: 'deploy.backupFailed', technicalDetails: expect.stringContaining('backup disk full') },
    });
    expect(fs.readFileSync(targetPath, 'utf8')).toBe(before);
    expect(readState(context)).toEqual(stateBefore);
  });

  it('rejects a precondition race before creating a backup or writing a target', async () => {
    const targetPath = path.join(homeDir, '.claude', 'CLAUDE.md');
    const plan = await createDeployPlan(context);
    const selected = plan.changes.find((change) => change.targetPath === targetPath);
    if (!selected) throw new Error('expected Shared Rules change');
    fs.writeFileSync(targetPath, '# Changed after review\n');

    const result = await applyDeployPlan(context, plan, { changeIds: [selected.id] });

    expect(result).toMatchObject({ status: 'failed', error: { code: 'operation.stalePlan' } });
    expect(fs.readFileSync(targetPath, 'utf8')).toBe('# Changed after review\n');
    expect(fs.existsSync(path.join(homeDir, 'Library', 'Application Support', 'mcv', 'backups')))
      .toBe(false);
  });

  it('rolls back earlier selected writes and returns a structured failure Result', async () => {
    const rulesPath = path.join(homeDir, '.claude', 'CLAUDE.md');
    const skillPath = path.join(homeDir, '.claude', 'skills', 'review', 'SKILL.md');
    const plan = await createDeployPlan(context);
    const selected = plan.changes.filter((change) =>
      change.targetPath === rulesPath || change.targetPath === skillPath);
    expect(selected).toHaveLength(2);
    let writeCount = 0;

    const result = await applyDeployPlan(
      context,
      plan,
      { changeIds: selected.map((change) => change.id) },
      {
        writeFile: (targetPath, content) => {
          writeCount += 1;
          if (writeCount === 2) throw new Error('simulated write failure');
          atomicWriteFile(targetPath, content);
        },
      },
    );

    expect(result).toMatchObject({
      status: 'failed',
      error: { code: 'deploy.transactionFailed', technicalDetails: expect.stringContaining('simulated write failure') },
    });
    expect(fs.readFileSync(rulesPath, 'utf8')).toBe('# Device rules\n');
    expect(fs.existsSync(skillPath)).toBe(false);
  });

  it('restores a target when its writer modifies the file before throwing', async () => {
    const targetPath = path.join(homeDir, '.claude', 'CLAUDE.md');
    const plan = await createDeployPlan(context);
    const selected = plan.changes.find((change) => change.targetPath === targetPath);
    if (!selected) throw new Error('expected Shared Rules change');

    const result = await applyDeployPlan(context, plan, { changeIds: [selected.id] }, {
      writeFile: (pathToWrite, content) => {
        atomicWriteFile(pathToWrite, content);
        throw new Error('writer failed after rename');
      },
    });

    expect(result).toMatchObject({ status: 'failed', error: { code: 'deploy.transactionFailed' } });
    expect(fs.readFileSync(targetPath, 'utf8')).toBe('# Device rules\n');
  });

  it('does not restore a selected target whose write was never attempted', async () => {
    const rulesPath = path.join(homeDir, '.claude', 'CLAUDE.md');
    const skillPath = path.join(homeDir, '.claude', 'skills', 'review', 'SKILL.md');
    const laterPath = path.join(homeDir, '.claude', 'settings.json');
    const plan = await createDeployPlan(context);
    const selected = [rulesPath, skillPath, laterPath].map((targetPath) => {
      const change = plan.changes.find((candidate) => candidate.targetPath === targetPath);
      if (!change) throw new Error(`expected change for ${targetPath}`);
      return change;
    });
    let writeCount = 0;

    const result = await applyDeployPlan(
      context,
      plan,
      { changeIds: selected.map((change) => change.id) },
      {
        writeFile: (targetPath, content) => {
          writeCount += 1;
          if (writeCount === 1) {
            atomicWriteFile(targetPath, content);
            fs.writeFileSync(laterPath, '{"external":true}\n');
            return;
          }
          throw new Error('stop before later target');
        },
      },
    );

    expect(result).toMatchObject({ status: 'failed', error: { code: 'deploy.transactionFailed' } });
    expect(fs.readFileSync(rulesPath, 'utf8')).toBe('# Device rules\n');
    expect(fs.existsSync(skillPath)).toBe(false);
    expect(fs.readFileSync(laterPath, 'utf8')).toBe('{"external":true}\n');
  });

  it('preserves the verified backup path when automatic rollback is incomplete', async () => {
    const targetPath = path.join(homeDir, '.claude', 'CLAUDE.md');
    const plan = await createDeployPlan(context);
    const selected = plan.changes.find((change) => change.targetPath === targetPath);
    if (!selected) throw new Error('expected Shared Rules change');

    const result = await applyDeployPlan(context, plan, { changeIds: [selected.id] }, {
      writeFile: () => { throw new Error('write denied'); },
      restoreFile: () => { throw new Error('restore denied'); },
    });

    expect(result).toMatchObject({
      status: 'failed',
      error: {
        code: 'deploy.rollbackFailed',
        technicalDetails: expect.stringContaining('restore denied'),
        nextActions: [expect.stringContaining('backups')],
      },
    });
  });

  it('rejects foreign selection IDs and non-interactive deletions before writing', async () => {
    const plan = await createDeployPlan(context);
    const invalid = await applyDeployPlan(context, plan, { changeIds: ['deploy-not-in-plan'] });
    expect(invalid).toMatchObject({
      status: 'failed', error: { code: 'deploy.invalidSelection' },
    });

    const freshPlan = await createDeployPlan(context);
    const deletion = freshPlan.changes.find((change) => change.change === 'delete');
    if (!deletion) throw new Error('expected deletion candidate');
    const defaultSelection = freshPlan.changes
      .filter((change) => change.defaultSelected)
      .map((change) => change.id);
    const blocked = await applyDeployPlan(
      context,
      freshPlan,
      { changeIds: defaultSelection },
      { nonInteractive: true },
    );
    expect(blocked).toMatchObject({
      status: 'blocked', issues: [expect.objectContaining({ code: 'deploy.nonInteractiveBlocked' })],
    });
    expect(fs.existsSync(deletion.targetPath)).toBe(true);
  });

  it('requires every warning to be explicitly confirmed and blocks --yes', async () => {
    const rulesPath = path.join(homeDir, '.claude', 'CLAUDE.md');
    const linkTarget = path.join(testRoot, 'linked-rules.md');
    fs.writeFileSync(linkTarget, '# Linked rules\n');
    fs.rmSync(rulesPath);
    fs.symlinkSync(linkTarget, rulesPath);
    const plan = await createDeployPlan(context);
    const warningCodes = plan.issues
      .filter((issue) => issue.severity === 'warning')
      .map((issue) => issue.code);
    expect(warningCodes.length).toBeGreaterThan(0);
    const selectedIds = plan.changes.filter((change) => change.defaultSelected).map((change) => change.id);

    const blocked = await applyDeployPlan(context, plan, { changeIds: selectedIds });
    expect(blocked).toMatchObject({ status: 'blocked', issues: [expect.objectContaining({ severity: 'warning' })] });

    const nonInteractivePlan = await createDeployPlan(context);
    const nonInteractive = await applyDeployPlan(
      context,
      nonInteractivePlan,
      { changeIds: nonInteractivePlan.changes.filter((change) => change.defaultSelected).map((change) => change.id) },
      { nonInteractive: true },
    );
    expect(nonInteractive).toMatchObject({
      status: 'blocked', issues: [expect.objectContaining({ code: 'deploy.nonInteractiveBlocked' })],
    });

    const confirmedPlan = await createDeployPlan(context);
    const confirmed = await applyDeployPlan(context, confirmedPlan, {
      changeIds: confirmedPlan.changes.filter((change) => change.defaultSelected).map((change) => change.id),
      confirmedIssueCodes: warningCodes,
    });
    expect(confirmed.status).toBe('succeeded');
    expect(fs.readFileSync(linkTarget, 'utf8')).toBe('# Linked rules\n');
  });

  it('applies only selected capabilities and updates only their device state scope', async () => {
    const targetPath = path.join(homeDir, '.claude.json');
    const plan = await createDeployPlan(context);
    const native = plan.changes.find((change) =>
      change.targetPath === targetPath && change.capability === 'native');
    if (!native) throw new Error('expected Native change');

    const result = await applyDeployPlan(context, plan, { changeIds: [native.id] });

    expect(result).toMatchObject({
      status: 'succeeded',
      data: { appliedChangeIds: [native.id], writtenPaths: [targetPath], deletedPaths: [] },
    });
    expect(JSON.parse(fs.readFileSync(targetPath, 'utf8'))).toEqual({
      localState: 'must-be-preserved',
      compactMode: true,
    });
    const state = readState(context);
    expect(state.baselineSnapshot?.files).toEqual({ [targetPath]: expect.any(String) });
    expect(state.managedInventory).toEqual(expect.objectContaining({
      [targetPath]: { source: repositoryPath, hash: expect.any(String) },
    }));
    expect(state.managedInventory).not.toHaveProperty(path.join(homeDir, '.claude', 'CLAUDE.md'));
    expect(state.lastDeploySelection).toEqual({ 'claude-code': ['native'] });
  });
});

function hashDirectory(root: string): string {
  const hash = crypto.createHash('sha256');
  const visit = (directory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name))) {
      const current = path.join(directory, entry.name);
      hash.update(path.relative(root, current));
      if (entry.isDirectory()) visit(current);
      else hash.update(fs.readFileSync(current));
    }
  };
  visit(root);
  return hash.digest('hex');
}
