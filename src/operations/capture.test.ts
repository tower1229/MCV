import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DeviceContext } from '../adapters/types';
import { readState, writeState } from '../utils/state';
import { applyCapturePlan, createCapturePlan } from './capture';

describe('Capture operations', () => {
  let testRoot: string;
  let homeDir: string;
  let repositoryPath: string;
  let context: DeviceContext;

  beforeEach(() => {
    testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mcv-capture-operation-'));
    homeDir = path.join(testRoot, 'home');
    repositoryPath = path.join(testRoot, 'repository');
    fs.mkdirSync(path.join(homeDir, '.claude'), { recursive: true });
    fs.mkdirSync(repositoryPath);
    fs.writeFileSync(path.join(repositoryPath, 'mcv.yaml'), [
      'schemaVersion: 2',
      'repositoryId: capture-operation-test',
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
    context = {
      homeDir,
      platform: 'win32',
      env: { APPDATA: path.join(testRoot, 'state') },
      pathEnv: '',
    };
    writeState(context, {
      schemaVersion: 2,
      defaultRepositoryId: 'capture-operation-test',
      repositoryPath,
    });
  });

  afterEach(() => {
    fs.rmSync(testRoot, { recursive: true, force: true });
  });

  it('returns a sanitized grouped Plan without changing Repository or device state', async () => {
    fs.writeFileSync(
      path.join(homeDir, '.claude', 'settings.json'),
      JSON.stringify({ theme: 'dark', apiToken: 'must-not-leak' }),
    );
    const repositoryBefore = hashDirectory(repositoryPath);
    const stateBefore = readState(context);

    const first = await createCapturePlan(context);
    const second = await createCapturePlan(context);

    expect(first).toMatchObject({
      schemaVersion: 1,
      operation: 'capture',
      status: 'planned',
      readyToApply: true,
      repositoryPath,
      operationId: expect.any(String),
      preconditions: expect.any(Object),
      issues: [],
      nextActions: [],
      summary: {
        sensitiveFieldCount: 1,
        parameterizedPathCount: 0,
        excludedFileCount: 0,
      },
    });
    expect(first.changes).toEqual([
      expect.objectContaining({
        id: expect.stringMatching(/^capture-[a-f0-9]{16}$/),
        ide: 'claude-code',
        itemType: 'file',
        capability: 'native',
        change: 'add',
        defaultSelected: true,
        repositoryPaths: ['ide/claude-code/native/settings.json'],
        previews: [expect.objectContaining({ kind: 'text', diff: expect.any(String) })],
      }),
    ]);
    expect(second.changes.map((change) => change.id)).toEqual(
      first.changes.map((change) => change.id),
    );
    const serialized = JSON.stringify(first);
    expect(serialized).toContain('${env:API_TOKEN}');
    expect(serialized).not.toContain('must-not-leak');
    expect(hashDirectory(repositoryPath)).toBe(repositoryBefore);
    expect(readState(context)).toEqual(stateBefore);
  });

  it('does not echo malformed source content through Issues or errors', async () => {
    fs.writeFileSync(
      path.join(homeDir, '.claude', 'settings.json'),
      '{"apiToken":"malformed-secret-must-not-leak", trailing}',
    );

    const plan = await createCapturePlan(context);

    expect(plan.issues).toEqual([
      expect.objectContaining({
        severity: 'warning',
        code: 'capture.sourceSkipped.1.1',
      }),
    ]);
    expect(JSON.stringify(plan)).not.toContain('malformed-secret-must-not-leak');
  });

  it('changes source and target precondition hashes when either side changes', async () => {
    const sourcePath = path.join(homeDir, '.claude', 'settings.json');
    fs.writeFileSync(sourcePath, JSON.stringify({ theme: 'dark' }));
    const first = await createCapturePlan(context);
    const changeId = first.changes[0].id;

    expect(first.preconditions[`source:${changeId}`]).toMatch(/^[a-f0-9]{64}$/);
    expect(first.preconditions[`target:${changeId}`]).toMatch(/^[a-f0-9]{64}$/);

    fs.writeFileSync(sourcePath, JSON.stringify({ theme: 'light' }));
    const sourceChanged = await createCapturePlan(context);
    expect(sourceChanged.preconditions[`source:${changeId}`]).not.toBe(
      first.preconditions[`source:${changeId}`],
    );
    expect(sourceChanged.preconditions[`target:${changeId}`]).toBe(
      first.preconditions[`target:${changeId}`],
    );

    const repositoryFile = path.join(repositoryPath, 'ide', 'claude-code', 'native', 'settings.json');
    fs.mkdirSync(path.dirname(repositoryFile), { recursive: true });
    fs.writeFileSync(repositoryFile, JSON.stringify({ repositoryOnly: true }));
    const targetChanged = await createCapturePlan(context);
    expect(targetChanged.preconditions[`target:${changeId}`]).not.toBe(
      sourceChanged.preconditions[`target:${changeId}`],
    );
  });

  it('reports ambiguous MCP core conflicts as decisionRequired', async () => {
    fs.writeFileSync(path.join(repositoryPath, 'mcv.yaml'), [
      'schemaVersion: 2',
      'repositoryId: capture-operation-test',
      'initializedAt: 2026-07-22T00:00:00.000Z',
      'security: { scanSecrets: true, allowPlaintextSecrets: false }',
      'capture: { preserveUnknownNativeFields: true }',
      'deploy: { backupBeforeWrite: true, useSymlinks: false }',
      'targets:',
      '  codex:',
      '    enabled: true',
      '  claudeCode:',
      '    enabled: true',
      'variables: {}',
      '',
    ].join('\n'));
    fs.mkdirSync(path.join(homeDir, '.codex'), { recursive: true });
    fs.writeFileSync(
      path.join(homeDir, '.codex', 'config.toml'),
      '[mcp_servers.shared]\ncommand = "codex-server"\n',
    );
    fs.writeFileSync(
      path.join(homeDir, '.claude.json'),
      JSON.stringify({ mcpServers: { shared: { command: 'claude-server' } } }),
    );

    const plan = await createCapturePlan(context);

    expect(plan.readyToApply).toBe(false);
    expect(plan.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        severity: 'decisionRequired',
        code: 'capture.mcpCoreConflict',
      }),
    ]));
    expect(plan.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        ide: 'shared',
        itemType: 'mcp',
        name: 'shared',
        change: 'conflict',
        defaultSelected: false,
        decisionGroupId: expect.stringMatching(/^capture-decision-[a-f0-9]{16}$/),
      }),
    ]));
    const choices = plan.changes.filter((change) => change.name === 'shared');
    expect(choices).toHaveLength(2);
    expect(new Set(choices.map((choice) => choice.id))).toHaveLength(2);
    expect(new Set(choices.map((choice) => choice.decisionGroupId))).toHaveLength(1);
    expect(new Set(choices.map((choice) => choice.sourceLabel))).toEqual(
      new Set(['codex / config.toml', 'claude-code / .claude.json']),
    );
  });

  it('merges Repository-first Canonical Rules and chooses the newest complete Skill copy deterministically', async () => {
    fs.writeFileSync(path.join(repositoryPath, 'mcv.yaml'), [
      'schemaVersion: 2',
      'repositoryId: capture-operation-test',
      'initializedAt: 2026-07-22T00:00:00.000Z',
      'security: { scanSecrets: true, allowPlaintextSecrets: false }',
      'capture: { preserveUnknownNativeFields: true }',
      'deploy: { backupBeforeWrite: true, useSymlinks: false }',
      'targets:',
      '  codex:',
      '    enabled: true',
      '  claudeCode:',
      '    enabled: true',
      'variables: {}',
      '',
    ].join('\n'));
    fs.mkdirSync(path.join(repositoryPath, 'common'), { recursive: true });
    fs.writeFileSync(
      path.join(repositoryPath, 'common', 'AGENTS.md'),
      '# Rules\n\nRepository first.\n',
    );
    fs.mkdirSync(path.join(homeDir, '.codex'), { recursive: true });
    fs.writeFileSync(
      path.join(homeDir, '.codex', 'AGENTS.md'),
      '# Rules\n\nDevice second.\n',
    );
    const older = path.join(homeDir, '.codex', 'skills', 'review');
    const newer = path.join(homeDir, '.claude', 'skills', 'review');
    fs.mkdirSync(older, { recursive: true });
    fs.mkdirSync(newer, { recursive: true });
    const oldFile = path.join(older, 'SKILL.md');
    const newFile = path.join(newer, 'SKILL.md');
    fs.writeFileSync(oldFile, '---\nname: review\n---\n# Older\n');
    fs.writeFileSync(newFile, '---\nname: review\n---\n# Newer\n');
    fs.utimesSync(oldFile, new Date('2026-01-01T00:00:00Z'), new Date('2026-01-01T00:00:00Z'));
    fs.utimesSync(newFile, new Date('2026-07-01T00:00:00Z'), new Date('2026-07-01T00:00:00Z'));

    const plan = await createCapturePlan(context);
    const rules = plan.changes.find((change) => change.name === 'Shared Rules');
    const skill = plan.changes.find((change) => change.name === 'review');

    const rulesDiff = rules?.previews[0]?.kind === 'text' ? rules.previews[0].diff : '';
    expect(rulesDiff.indexOf('+ Repository first.')).toBeLessThan(
      rulesDiff.indexOf('+ Device second.'),
    );
    const skillDiff = skill?.previews.find((item) => item.repositoryPath.endsWith('SKILL.md'));
    expect(skillDiff?.kind === 'text' ? skillDiff.diff : '').toContain('# Newer');
    expect(skillDiff?.kind === 'text' ? skillDiff.diff : '').not.toContain('# Older');
  });

  it('keeps Repository deletions unselected and represents binary Skill content as metadata', async () => {
    const localSkill = path.join(homeDir, '.claude', 'skills', 'portable');
    fs.mkdirSync(localSkill, { recursive: true });
    fs.writeFileSync(path.join(localSkill, 'SKILL.md'), '---\nname: portable\n---\n');
    const binary = Buffer.from('%PDF-1.7\nprintable binary without a NUL byte');
    fs.writeFileSync(path.join(localSkill, 'icon.bin'), binary);
    const staleSkill = path.join(repositoryPath, 'common', 'skills', 'stale');
    fs.mkdirSync(staleSkill, { recursive: true });
    fs.writeFileSync(path.join(staleSkill, 'SKILL.md'), '---\nname: stale\n---\n');

    const plan = await createCapturePlan(context);
    const portable = plan.changes.find((change) => change.name === 'portable');
    const stale = plan.changes.find((change) => change.name === 'stale');

    expect(portable).toMatchObject({
      ide: 'shared',
      itemType: 'skill',
      change: 'add',
      defaultSelected: true,
      previews: expect.arrayContaining([
        expect.objectContaining({
          repositoryPath: 'common/skills/portable/icon.bin',
          kind: 'binary',
          bytes: binary.length,
          sha256: crypto.createHash('sha256').update(binary).digest('hex'),
        }),
      ]),
    });
    expect(portable?.previews.find((preview) => preview.kind === 'binary')).not.toHaveProperty('diff');
    expect(stale).toMatchObject({
      ide: 'shared',
      itemType: 'skill',
      change: 'delete',
      defaultSelected: false,
      repositoryPaths: ['common/skills/stale/SKILL.md'],
    });
  });

  it('blocks readiness without exposing a secret found in a deletion preview', async () => {
    const secret = 'sk-1234567890abcdefghijklmnop';
    fs.mkdirSync(path.join(repositoryPath, 'common'), { recursive: true });
    fs.writeFileSync(path.join(repositoryPath, 'common', 'AGENTS.md'), `Remove ${secret}\n`);

    const plan = await createCapturePlan(context);

    expect(plan.readyToApply).toBe(false);
    expect(plan.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        severity: 'error',
        code: 'capture.plaintextSecretBlocked',
      }),
    ]));
    expect(JSON.stringify(plan)).not.toContain(secret);
    expect(plan.changes.find((change) => change.name === 'Shared Rules')).toMatchObject({
      change: 'delete',
      defaultSelected: false,
      previews: [expect.objectContaining({ diff: '[unsafe text withheld]' })],
    });
  });

  it('applies only selected changes and rejects IDs outside the active Plan', async () => {
    fs.writeFileSync(path.join(homeDir, '.claude', 'CLAUDE.md'), '# Device rules\n');
    fs.writeFileSync(
      path.join(homeDir, '.claude', 'settings.json'),
      JSON.stringify({ theme: 'dark' }),
    );
    const plan = await createCapturePlan(context);
    const rules = plan.changes.find((change) => change.capability === 'rules');
    const native = plan.changes.find((change) => change.capability === 'native');
    if (!rules || !native) throw new Error('expected rules and native changes');

    const invalid = await applyCapturePlan(context, plan, {
      changeIds: [rules.id, 'capture-not-in-plan'],
    });

    expect(invalid).toMatchObject({
      status: 'failed',
      error: { code: 'capture.invalidSelection' },
    });
    expect(fs.existsSync(path.join(repositoryPath, 'common', 'AGENTS.md'))).toBe(false);

    const freshPlan = await createCapturePlan(context);
    const freshRules = freshPlan.changes.find((change) => change.capability === 'rules');
    if (!freshRules) throw new Error('expected rules change');
    const result = await applyCapturePlan(context, freshPlan, { changeIds: [freshRules.id] });

    expect(result).toMatchObject({
      operation: 'capture',
      status: 'succeeded',
      data: { appliedChangeIds: [freshRules.id] },
      nextActions: [],
    });
    expect(fs.readFileSync(path.join(repositoryPath, 'common', 'AGENTS.md'), 'utf8'))
      .toBe('# Device rules\n');
    expect(fs.existsSync(path.join(repositoryPath, 'ide', 'claude-code', 'native', 'settings.json')))
      .toBe(false);
  });

  it('rejects forged, source-stale, and target-stale Plans before writing', async () => {
    const sourcePath = path.join(homeDir, '.claude', 'settings.json');
    const targetPath = path.join(repositoryPath, 'ide', 'claude-code', 'native', 'settings.json');
    fs.writeFileSync(sourcePath, JSON.stringify({ theme: 'dark' }));
    const forgedPlan = await createCapturePlan(context);
    const forgedId = forgedPlan.changes[0].id;

    const forged = await applyCapturePlan(
      context,
      { ...forgedPlan, operationId: 'forged-operation-id' },
      { changeIds: [forgedId] },
    );
    expect(forged).toMatchObject({ status: 'failed', error: { code: 'operation.invalidPlan' } });

    const sourcePlan = await createCapturePlan(context);
    fs.writeFileSync(sourcePath, JSON.stringify({ theme: 'light' }));
    const sourceStale = await applyCapturePlan(context, sourcePlan, {
      changeIds: [sourcePlan.changes[0].id],
    });
    expect(sourceStale).toMatchObject({ status: 'failed', error: { code: 'operation.stalePlan' } });
    expect(fs.existsSync(targetPath)).toBe(false);

    fs.writeFileSync(sourcePath, JSON.stringify({ theme: 'dark' }));
    const targetPlan = await createCapturePlan(context);
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.writeFileSync(targetPath, JSON.stringify({ repositoryOnly: true }));
    const targetStale = await applyCapturePlan(context, targetPlan, {
      changeIds: [targetPlan.changes[0].id],
    });
    expect(targetStale).toMatchObject({ status: 'failed', error: { code: 'operation.stalePlan' } });
    expect(fs.readFileSync(targetPath, 'utf8')).toBe(JSON.stringify({ repositoryOnly: true }));
  });

  it('blocks unsafe issue states and non-interactive deletion before writing', async () => {
    const staleRules = path.join(repositoryPath, 'common', 'AGENTS.md');
    fs.mkdirSync(path.dirname(staleRules), { recursive: true });
    fs.writeFileSync(staleRules, '# Keep until reviewed\n');
    const deletionPlan = await createCapturePlan(context);
    const deletion = deletionPlan.changes.find((change) => change.change === 'delete');
    if (!deletion) throw new Error('expected deletion change');

    const nonInteractive = await applyCapturePlan(
      context,
      deletionPlan,
      { changeIds: [] },
      { nonInteractive: true },
    );

    expect(nonInteractive).toMatchObject({
      status: 'blocked',
      issues: expect.arrayContaining([
        expect.objectContaining({ code: 'capture.nonInteractiveBlocked' }),
      ]),
      nextActions: expect.arrayContaining([expect.stringContaining('interactively')]),
    });
    expect(fs.readFileSync(staleRules, 'utf8')).toBe('# Keep until reviewed\n');

    fs.writeFileSync(path.join(homeDir, '.claude', 'settings.json'), '{ malformed }');
    const warningPlan = await createCapturePlan(context);
    const warningResult = await applyCapturePlan(context, warningPlan, { changeIds: [] });
    expect(warningResult).toMatchObject({ status: 'blocked' });
    expect(warningResult.nextActions).toEqual(expect.arrayContaining([
      expect.stringContaining('Confirm every warning'),
    ]));
  });

  it('rejects a secret regression without exposing or writing it', async () => {
    const sourcePath = path.join(homeDir, '.claude', 'settings.json');
    const targetPath = path.join(repositoryPath, 'ide', 'claude-code', 'native', 'settings.json');
    fs.writeFileSync(sourcePath, JSON.stringify({ theme: 'dark' }));
    const plan = await createCapturePlan(context);
    const secret = 'sk-1234567890abcdefghijklmnop';
    fs.writeFileSync(sourcePath, JSON.stringify({ instructions: secret }));

    const result = await applyCapturePlan(context, plan, { changeIds: [plan.changes[0].id] });

    expect(result).toMatchObject({ status: 'failed', error: { code: 'operation.stalePlan' } });
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(fs.existsSync(targetPath)).toBe(false);
  });

  it('rejects raw secret changes even when sanitization produces the same preview', async () => {
    const sourcePath = path.join(homeDir, '.claude', 'settings.json');
    const targetPath = path.join(repositoryPath, 'ide', 'claude-code', 'native', 'settings.json');
    const firstSecret = 'first-secret-value';
    const secondSecret = 'second-secret-value';
    fs.writeFileSync(sourcePath, JSON.stringify({ apiToken: firstSecret }));
    const plan = await createCapturePlan(context);
    fs.writeFileSync(sourcePath, JSON.stringify({ apiToken: secondSecret }));

    const result = await applyCapturePlan(context, plan, { changeIds: [plan.changes[0].id] });

    expect(result).toMatchObject({ status: 'failed', error: { code: 'operation.stalePlan' } });
    expect(JSON.stringify(result)).not.toContain(firstSecret);
    expect(JSON.stringify(result)).not.toContain(secondSecret);
    expect(fs.existsSync(targetPath)).toBe(false);
  });

  it('applies one selected MCP decision and blocks an unresolved error', async () => {
    fs.writeFileSync(path.join(repositoryPath, 'mcv.yaml'), [
      'schemaVersion: 2',
      'repositoryId: capture-operation-test',
      'initializedAt: 2026-07-22T00:00:00.000Z',
      'security: { scanSecrets: true, allowPlaintextSecrets: false }',
      'capture: { preserveUnknownNativeFields: true }',
      'deploy: { backupBeforeWrite: true, useSymlinks: false }',
      'targets:',
      '  codex:',
      '    enabled: true',
      '  claudeCode:',
      '    enabled: true',
      'variables: {}',
      '',
    ].join('\n'));
    fs.mkdirSync(path.join(homeDir, '.codex'), { recursive: true });
    fs.writeFileSync(
      path.join(homeDir, '.codex', 'config.toml'),
      '[mcp_servers.shared]\ncommand = "codex-server"\n',
    );
    fs.writeFileSync(
      path.join(homeDir, '.claude.json'),
      JSON.stringify({ mcpServers: { shared: { command: 'claude-server' } } }),
    );
    const decisionPlan = await createCapturePlan(context);
    const choice = decisionPlan.changes.find((change) =>
      change.change === 'conflict'
      && change.previews.some((item) => item.kind === 'text' && item.diff.includes('claude-server')));
    if (!choice) throw new Error('expected Claude MCP decision');

    const decided = await applyCapturePlan(context, decisionPlan, { changeIds: [choice.id] });

    expect(decided).toMatchObject({ status: 'succeeded' });
    expect(fs.readFileSync(path.join(repositoryPath, 'common', 'mcp.yaml'), 'utf8'))
      .toContain('claude-server');

    const secret = 'sk-1234567890abcdefghijklmnop';
    fs.writeFileSync(path.join(homeDir, '.claude', 'CLAUDE.md'), `Never expose ${secret}\n`);
    const errorPlan = await createCapturePlan(context);
    const blocked = await applyCapturePlan(context, errorPlan, { changeIds: [] });
    expect(blocked).toMatchObject({
      status: 'blocked',
      issues: expect.arrayContaining([
        expect.objectContaining({ severity: 'error', code: 'capture.plaintextSecretBlocked' }),
      ]),
    });
    expect(JSON.stringify(blocked)).not.toContain(secret);
  });

  it('rolls back every Repository change when a later transaction write fails', async () => {
    fs.writeFileSync(path.join(homeDir, '.claude', 'CLAUDE.md'), '# Device rules\n');
    fs.writeFileSync(
      path.join(homeDir, '.claude', 'settings.json'),
      JSON.stringify({ theme: 'dark' }),
    );
    const plan = await createCapturePlan(context);
    const selectedIds = plan.changes.map((change) => change.id);
    let moveCount = 0;
    const moveFile: typeof fs.renameSync = (source, target) => {
      moveCount += 1;
      if (moveCount === 2) throw new Error('simulated transaction failure');
      fs.renameSync(source, target);
    };

    const result = await applyCapturePlan(
      context,
      plan,
      { changeIds: selectedIds },
      { moveFile },
    );

    expect(result).toMatchObject({
      status: 'failed',
      error: { code: 'capture.transactionFailed' },
    });
    expect(fs.existsSync(path.join(repositoryPath, 'common', 'AGENTS.md'))).toBe(false);
    expect(fs.existsSync(path.join(repositoryPath, 'ide', 'claude-code', 'native', 'settings.json')))
      .toBe(false);
  });

  it('preserves a recovery backup and returns a distinct Result when rollback fails', async () => {
    const nativePath = path.join(repositoryPath, 'ide', 'claude-code', 'native', 'settings.json');
    fs.mkdirSync(path.dirname(nativePath), { recursive: true });
    fs.writeFileSync(nativePath, '{"theme":"light"}\n');
    fs.writeFileSync(
      path.join(homeDir, '.claude', 'settings.json'),
      JSON.stringify({ theme: 'dark' }),
    );
    fs.mkdirSync(path.join(repositoryPath, 'common'), { recursive: true });
    fs.writeFileSync(path.join(repositoryPath, 'common', 'AGENTS.md'), '# Repository rules\n');
    fs.writeFileSync(path.join(homeDir, '.claude', 'CLAUDE.md'), '# Device rules\n');
    fs.writeFileSync(
      path.join(homeDir, '.claude.json'),
      JSON.stringify({ mcpServers: { local: { command: 'server' } } }),
    );
    const plan = await createCapturePlan(context);
    let moveCount = 0;
    const moveFile: typeof fs.renameSync = (source, target) => {
      moveCount += 1;
      if (moveCount === 3) throw new Error('simulated commit failure');
      fs.renameSync(source, target);
    };

    const result = await applyCapturePlan(
      context,
      plan,
      { changeIds: plan.changes.filter((change) => change.defaultSelected).map((change) => change.id) },
      {
        moveFile,
        restoreFile: () => { throw new Error('simulated rollback failure'); },
      },
    );

    expect(result).toMatchObject({
      status: 'failed',
      error: {
        code: 'capture.rollbackFailed',
        nextActions: [expect.stringContaining('Restore the affected files from')],
      },
    });
    const recovery = fs.readdirSync(testRoot).find((entry) =>
      entry.startsWith('.repository.mcv-capture-'));
    expect(recovery).toBeDefined();
    expect(fs.existsSync(path.join(testRoot, recovery!, 'manifest.json'))).toBe(true);
  });
});

function hashDirectory(directory: string): string {
  const hash = crypto.createHash('sha256');
  for (const entry of walk(directory)) {
    hash.update(path.relative(directory, entry));
    hash.update(fs.readFileSync(entry));
  }
  return hash.digest('hex');
}

function walk(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(target) : entry.isFile() ? [target] : [];
  }).sort();
}
