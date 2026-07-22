import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DeviceContext } from '../adapters/types';
import { readState, writeState } from '../utils/state';
import { createCapturePlan } from './capture';

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
    const rules = plan.changes.find((change) => change.name === 'Canonical Rules');
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
    expect(plan.changes.find((change) => change.name === 'Canonical Rules')).toMatchObject({
      change: 'delete',
      defaultSelected: false,
      previews: [expect.objectContaining({ diff: '[unsafe text withheld]' })],
    });
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
