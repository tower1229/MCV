import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DeviceContext } from '../adapters/types.js';
import { hashDeviceTopologyNode } from '../core/canonical-skill-device-layout.js';
import { readState, writeState } from '../utils/state.js';
import { writeProfilesDocument } from '../profiles/store.js';
import { createProfileService } from '../profiles/service.js';
import { applyCapturePlan, createCapturePlan } from './capture.js';

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
      'schemaVersion: 4',
      'repositoryId: capture-operation-test',
      'initializedAt: 2026-07-22T00:00:00.000Z',
      'capture: { preserveUnknownNativeFields: true }',
      'deploy: { backupBeforeWrite: true, useSymlinks: false }',
      'targets:',
      '  claudeCode:',
      '    enabled: true',
      'variables: {}',
      '',
    ].join('\n'));
    writeProfilesDocument(repositoryPath, {
      schemaVersion: 1,
      profiles: { global: { assets: [] } },
    });
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

  it('returns a faithful grouped Plan without changing Repository or device state', async () => {
    fs.writeFileSync(
      path.join(homeDir, '.claude', 'settings.json'),
      JSON.stringify({ theme: 'dark', apiToken: 'must-not-leak' }),
    );
    const repositoryBefore = hashDirectory(repositoryPath);
    const stateBefore = readState(context);

    const first = await createCapturePlan(context);
    const second = await createCapturePlan(context);

    expect(first).toMatchObject({
      schemaVersion: 3,
      operation: 'capture',
      status: 'planned',
      readyToApply: true,
      repositoryPath,
      operationId: expect.any(String),
      preconditions: expect.any(Object),
      issues: [],
      nextActions: [],
      summary: {
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
    expect(JSON.stringify(first)).toContain('must-not-leak');
    expect(second.changes.map((change) => change.id)).toEqual(
      first.changes.map((change) => change.id),
    );
    const serialized = JSON.stringify(first);
    expect(serialized).not.toContain('${env:API_TOKEN}');
    expect(serialized).toContain('must-not-leak');
    expect(hashDirectory(repositoryPath)).toBe(repositoryBefore);
    expect(readState(context)).toEqual(stateBefore);
  });

  it('reports a safe diagnostic when Capture Plan generation fails', async () => {
    const sourceContent = 'schemaVersion: [invalid-log-secret-must-not-leak\n';
    fs.writeFileSync(path.join(repositoryPath, 'mcv.yaml'), sourceContent);

    const plan = await createCapturePlan(context);

    expect(plan).toMatchObject({
      status: 'failed',
      readyToApply: false,
      error: {
        code: 'capture.planFailed',
        message: 'The Capture Plan could not be generated safely. Reason: Invalid YAML configuration.',
        technicalDetails: 'Invalid YAML configuration.',
      },
      issues: [expect.objectContaining({
        severity: 'error',
        code: 'capture.planFailed',
        details: 'Invalid YAML configuration.',
      })],
    });
    expect(JSON.stringify(plan)).not.toContain('invalid-log-secret-must-not-leak');
    expect(fs.readFileSync(path.join(repositoryPath, 'mcv.yaml'), 'utf8')).toBe(sourceContent);
  });

  it('identifies the configuration path when a structured root is invalid', async () => {
    const repositoryFile = path.join(
      repositoryPath,
      'ide',
      'claude-code',
      'native',
      'settings.json',
    );
    fs.mkdirSync(path.dirname(repositoryFile), { recursive: true });
    fs.writeFileSync(repositoryFile, '["invalid-root-content-must-not-leak"]\n');
    fs.writeFileSync(path.join(homeDir, '.claude', 'settings.json'), '{"theme":"dark"}\n');

    const plan = await createCapturePlan(context);

    expect(plan).toMatchObject({
      status: 'failed',
      error: {
        code: 'capture.planFailed',
        technicalDetails: 'ide/claude-code/native/settings.json must contain a JSON object.',
      },
    });
    expect(JSON.stringify(plan)).not.toContain('invalid-root-content-must-not-leak');
  });

  it('captures Antigravity keybindings arrays by replacing the Repository file', async () => {
    fs.writeFileSync(path.join(repositoryPath, 'mcv.yaml'), [
      'schemaVersion: 4',
      'repositoryId: capture-operation-test',
      'initializedAt: 2026-07-22T00:00:00.000Z',
      'capture: { preserveUnknownNativeFields: true }',
      'deploy: { backupBeforeWrite: true, useSymlinks: false }',
      'targets:',
      '  gemini:',
      '    enabled: true',
      'variables: {}',
      '',
    ].join('\n'));
    const devicePath = path.join(context.env.APPDATA!, 'Antigravity', 'User', 'keybindings.json');
    const repositoryFile = path.join(
      repositoryPath,
      'ide',
      'gemini',
      'native',
      'antigravity',
      'keybindings.json',
    );
    fs.mkdirSync(path.dirname(devicePath), { recursive: true });
    fs.mkdirSync(path.dirname(repositoryFile), { recursive: true });
    fs.writeFileSync(devicePath, '[{"key":"ctrl+b","command":"new"}]\n');
    fs.writeFileSync(repositoryFile, '[{"key":"ctrl+a","command":"old"}]\n');

    const plan = await createCapturePlan(context);

    expect(plan.status).toBe('planned');
    expect(plan.changes).toEqual([expect.objectContaining({
      ide: 'gemini',
      name: 'keybindings.json',
      change: 'modify',
      repositoryPaths: ['ide/gemini/native/antigravity/keybindings.json'],
      previews: [expect.objectContaining({
        kind: 'text',
        diff: expect.stringContaining('"command": "new"'),
      })],
    })]);
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
        code: 'capture.sourceSkipped',
      }),
    ]);
    expect(JSON.stringify(plan)).not.toContain('malformed-secret-must-not-leak');
  });

  it('assigns distinct confirmation IDs to warnings in the same category', async () => {
    fs.writeFileSync(path.join(repositoryPath, 'mcv.yaml'), fs.readFileSync(
      path.join(repositoryPath, 'mcv.yaml'),
      'utf8',
    ).replace(
      'targets:\n  claudeCode:',
      'targets:\n  codex:\n    enabled: true\n  claudeCode:',
    ));
    fs.mkdirSync(path.join(homeDir, '.codex'), { recursive: true });
    fs.writeFileSync(path.join(homeDir, '.codex', 'config.toml'), '[broken');
    fs.writeFileSync(path.join(homeDir, '.claude', 'settings.json'), '{broken');

    const plan = await createCapturePlan(context);
    const warnings = plan.issues.filter((issue) => issue.severity === 'warning');

    expect(warnings).toHaveLength(2);
    expect(warnings.map((warning) => warning.code)).toEqual([
      'capture.sourceSkipped',
      'capture.sourceSkipped',
    ]);
    expect(new Set(warnings.map((warning) => warning.confirmationId)).size).toBe(2);
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
      'schemaVersion: 4',
      'repositoryId: capture-operation-test',
      'initializedAt: 2026-07-22T00:00:00.000Z',
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

  it('captures one Skill candidate from managed projection aliases of one physical package', async () => {
    if (process.platform === 'win32') return;
    fs.writeFileSync(path.join(repositoryPath, 'mcv.yaml'), [
      'schemaVersion: 4',
      'repositoryId: capture-operation-test',
      'initializedAt: 2026-07-22T00:00:00.000Z',
      'capture: { preserveUnknownNativeFields: true }',
      'deploy: { backupBeforeWrite: true, useSymlinks: true }',
      'targets:',
      '  codex:',
      '    enabled: true',
      '  claudeCode:',
      '    enabled: true',
      '  gemini:',
      '    enabled: true',
      'variables: {}',
      '',
    ].join('\n'));
    const storePackage = path.join(homeDir, '.agents', 'skills', 'shared-demo');
    const claudeProjection = path.join(homeDir, '.claude', 'skills', 'shared-demo');
    const geminiProjection = path.join(homeDir, '.gemini', 'skills', 'shared-demo');
    fs.mkdirSync(path.join(storePackage, 'assets'), { recursive: true });
    fs.mkdirSync(path.dirname(claudeProjection), { recursive: true });
    fs.mkdirSync(path.dirname(geminiProjection), { recursive: true });
    fs.writeFileSync(path.join(storePackage, 'SKILL.md'), '---\nname: shared-demo\n---\n# Shared\n');
    fs.writeFileSync(path.join(storePackage, 'assets', 'icon.bin'), Buffer.from([9, 8, 7]));
    fs.symlinkSync(storePackage, claudeProjection, 'dir');
    fs.symlinkSync(storePackage, geminiProjection, 'dir');
    writeState(context, {
      ...readState(context),
      managedSkillLayout: {
        packages: {},
        projections: {
          [claudeProjection]: {
            packageName: 'shared-demo',
            projectionPath: claudeProjection,
            ide: 'claude-code',
            surface: 'claude-code',
            expectedLinkTarget: storePackage,
            topologyHash: hashDeviceTopologyNode(claudeProjection),
            source: repositoryPath,
          },
          [geminiProjection]: {
            packageName: 'shared-demo',
            projectionPath: geminiProjection,
            ide: 'gemini',
            surface: 'gemini-cli',
            expectedLinkTarget: storePackage,
            topologyHash: hashDeviceTopologyNode(geminiProjection),
            source: repositoryPath,
          },
        },
      },
    });

    const plan = await createCapturePlan(context);
    const skillChanges = plan.changes.filter((change) => change.name === 'shared-demo');

    expect(skillChanges).toHaveLength(1);
    expect(skillChanges[0]).toMatchObject({
      ide: 'shared',
      itemType: 'skill',
      change: 'add',
      defaultSelected: true,
      repositoryPaths: [
        'common/skills/shared-demo/SKILL.md',
        'common/skills/shared-demo/assets/icon.bin',
      ],
      contributingProjections: [
        expect.objectContaining({ surface: 'claude-code', ownership: 'managed' }),
        expect.objectContaining({ surface: 'codex', ownership: 'physical' }),
        expect.objectContaining({ surface: 'gemini-cli', ownership: 'managed' }),
      ],
    });
    expect(skillChanges[0].previews).toHaveLength(2);
    expect(JSON.stringify(plan.changes.filter((change) => change.name === 'shared-demo')))
      .toContain('"contributingProjections"');
    expect(JSON.stringify(plan.changes.filter((change) => change.name === 'shared-demo'))
      .match(/"name":"shared-demo"/g)).toHaveLength(1);

    const result = await applyCapturePlan(context, plan, {
      changeIds: [skillChanges[0].id],
    });
    expect(result.status).toBe('succeeded');
    expect(fs.readFileSync(
      path.join(repositoryPath, 'common', 'skills', 'shared-demo', 'SKILL.md'),
      'utf8',
    )).toContain('# Shared');
    expect(fs.lstatSync(path.join(repositoryPath, 'common', 'skills', 'shared-demo')).isSymbolicLink())
      .toBe(false);
    expect(readState(context).managedSkillLayout?.projections).toEqual(expect.objectContaining({
      [claudeProjection]: expect.objectContaining({ surface: 'claude-code' }),
      [geminiProjection]: expect.objectContaining({ surface: 'gemini-cli' }),
    }));
  });

  it('keeps a hand-created alias into the Store externally owned during Capture', async () => {
    fs.writeFileSync(path.join(repositoryPath, 'mcv.yaml'), [
      'schemaVersion: 4',
      'repositoryId: capture-operation-test',
      'initializedAt: 2026-07-22T00:00:00.000Z',
      'capture: { preserveUnknownNativeFields: true }',
      'deploy: { backupBeforeWrite: true, useSymlinks: true }',
      'targets:',
      '  codex:',
      '    enabled: true',
      '  claudeCode:',
      '    enabled: true',
      'variables: {}',
      '',
    ].join('\n'));
    const storePackage = path.join(homeDir, '.agents', 'skills', 'manual');
    const claudeProjection = path.join(homeDir, '.claude', 'skills', 'manual');
    fs.mkdirSync(storePackage, { recursive: true });
    fs.mkdirSync(path.dirname(claudeProjection), { recursive: true });
    fs.writeFileSync(path.join(storePackage, 'SKILL.md'), '---\nname: manual\n---\n# Manual\n');
    fs.symlinkSync(storePackage, claudeProjection, process.platform === 'win32' ? 'junction' : 'dir');

    const plan = await createCapturePlan(context);
    expect(plan).toMatchObject({ status: 'planned', issues: [] });
    expect(plan.changes.map((change) => change.name)).toContain('manual');
    const skill = plan.changes.find((change) => change.name === 'manual');

    expect(skill?.contributingProjections).toEqual(expect.arrayContaining([
      expect.objectContaining({ surface: 'codex', ownership: 'physical' }),
      expect.objectContaining({ surface: 'claude-code', ownership: 'external' }),
    ]));
  });

  it('invalidates Capture Plan when Skill projection topology changes before Apply', async () => {
    if (process.platform === 'win32') return;
    fs.writeFileSync(path.join(repositoryPath, 'mcv.yaml'), [
      'schemaVersion: 4',
      'repositoryId: capture-operation-test',
      'initializedAt: 2026-07-22T00:00:00.000Z',
      'capture: { preserveUnknownNativeFields: true }',
      'deploy: { backupBeforeWrite: true, useSymlinks: true }',
      'targets:',
      '  codex:',
      '    enabled: true',
      '  claudeCode:',
      '    enabled: true',
      'variables: {}',
      '',
    ].join('\n'));
    const storePackage = path.join(homeDir, '.agents', 'skills', 'topo');
    const otherPackage = path.join(homeDir, 'elsewhere', 'topo');
    const claudeProjection = path.join(homeDir, '.claude', 'skills', 'topo');
    fs.mkdirSync(storePackage, { recursive: true });
    fs.mkdirSync(otherPackage, { recursive: true });
    fs.mkdirSync(path.dirname(claudeProjection), { recursive: true });
    const identical = '---\nname: topo\n---\n# Same bytes\n';
    fs.writeFileSync(path.join(storePackage, 'SKILL.md'), identical);
    fs.writeFileSync(path.join(otherPackage, 'SKILL.md'), identical);
    fs.symlinkSync(storePackage, claudeProjection, 'dir');
    writeState(context, {
      ...readState(context),
      managedSkillLayout: {
        packages: {},
        projections: {
          [claudeProjection]: {
            packageName: 'topo',
            projectionPath: claudeProjection,
            ide: 'claude-code',
            surface: 'claude-code',
            expectedLinkTarget: storePackage,
            topologyHash: hashDeviceTopologyNode(claudeProjection),
            source: repositoryPath,
          },
        },
      },
    });

    const plan = await createCapturePlan(context);
    const skill = plan.changes.find((change) => change.name === 'topo');
    if (!skill) throw new Error('expected topo skill change');
    expect(skill.contributingProjections).toEqual(expect.arrayContaining([
      expect.objectContaining({ surface: 'claude-code', ownership: 'managed' }),
    ]));

    fs.rmSync(claudeProjection, { force: true });
    fs.symlinkSync(otherPackage, claudeProjection, 'dir');

    const result = await applyCapturePlan(context, plan, { changeIds: [skill.id] });
    expect(result).toMatchObject({ status: 'failed', error: { code: 'operation.stalePlan' } });
    expect(fs.existsSync(path.join(repositoryPath, 'common', 'skills', 'topo'))).toBe(false);
  });

  it('keeps independent same-named Skill packages on the newest-complete selection path', async () => {
    const older = path.join(homeDir, '.codex', 'skills', 'review');
    const newer = path.join(homeDir, '.claude', 'skills', 'review');
    fs.writeFileSync(path.join(repositoryPath, 'mcv.yaml'), [
      'schemaVersion: 4',
      'repositoryId: capture-operation-test',
      'initializedAt: 2026-07-22T00:00:00.000Z',
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
    fs.mkdirSync(older, { recursive: true });
    fs.mkdirSync(newer, { recursive: true });
    const oldFile = path.join(older, 'SKILL.md');
    const newFile = path.join(newer, 'SKILL.md');
    fs.writeFileSync(oldFile, '---\nname: review\n---\n# Older independent\n');
    fs.writeFileSync(newFile, '---\nname: review\n---\n# Newer independent\n');
    fs.utimesSync(oldFile, new Date('2026-01-01T00:00:00Z'), new Date('2026-01-01T00:00:00Z'));
    fs.utimesSync(newFile, new Date('2026-07-01T00:00:00Z'), new Date('2026-07-01T00:00:00Z'));

    const plan = await createCapturePlan(context);
    const skill = plan.changes.find((change) => change.name === 'review');
    expect(skill?.contributingProjections).toEqual([
      expect.objectContaining({ surface: 'claude-code', ownership: 'physical' }),
    ]);
    const skillDiff = skill?.previews.find((item) => item.repositoryPath.endsWith('SKILL.md'));
    expect(skillDiff?.kind === 'text' ? skillDiff.diff : '').toContain('# Newer independent');
  });

  it('merges Repository-first Canonical Rules and chooses the newest complete Skill copy deterministically', async () => {
    fs.writeFileSync(path.join(repositoryPath, 'mcv.yaml'), [
      'schemaVersion: 4',
      'repositoryId: capture-operation-test',
      'initializedAt: 2026-07-22T00:00:00.000Z',
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

  it('shows plaintext configuration data in a deletion preview without a security Issue', async () => {
    const secret = 'sk-1234567890abcdefghijklmnop';
    fs.mkdirSync(path.join(repositoryPath, 'common'), { recursive: true });
    fs.writeFileSync(path.join(repositoryPath, 'common', 'AGENTS.md'), `Remove ${secret}\n`);

    const plan = await createCapturePlan(context);

    expect(plan.readyToApply).toBe(true);
    expect(plan.issues.map((issue) => issue.code)).not.toContain('capture.plaintextSecretBlocked');
    expect(JSON.stringify(plan)).toContain(secret);
    expect(plan.changes.find((change) => change.name === 'Shared Rules')).toMatchObject({
      change: 'delete',
      defaultSelected: false,
      previews: [expect.objectContaining({ diff: expect.stringContaining(secret) })],
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
      data: {
        appliedChangeIds: [freshRules.id],
        newUnassignedCount: 1,
        newUnassignedAssetIds: ['rule:canonical'],
      },
      nextActions: [
        'Classify 1 new Unassigned Asset(s) with an Agent or `mcv profile edit <id> --add ...`, or create a Profile.',
      ],
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

  it('rejects a stale source change without echoing or writing the unreviewed value', async () => {
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

  it('rejects a stale credential-shaped value even when the field path is unchanged', async () => {
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
      'schemaVersion: 4',
      'repositoryId: capture-operation-test',
      'initializedAt: 2026-07-22T00:00:00.000Z',
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
    expect(JSON.stringify(errorPlan)).toContain(secret);
    expect(errorPlan.issues.map((issue) => issue.code)).not.toContain('capture.plaintextSecretBlocked');
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

  it('blocks deleting a Profile-referenced Asset with decisionRequired naming every referencing Profile', async () => {
    writeProfilesDocument(repositoryPath, {
      schemaVersion: 1,
      profiles: {
        global: { assets: ['skill:kept'] },
        dev: { assets: ['skill:kept'] },
      },
    });
    const kept = path.join(repositoryPath, 'common', 'skills', 'kept');
    fs.mkdirSync(kept, { recursive: true });
    fs.writeFileSync(path.join(kept, 'SKILL.md'), '---\nname: kept\n---\n# Kept\n');

    const plan = await createCapturePlan(context);
    const deletion = plan.changes.find((change) =>
      change.itemType === 'skill' && change.name === 'kept' && change.change === 'delete');

    expect(deletion).toMatchObject({ change: 'delete', defaultSelected: false });
    expect(plan.readyToApply).toBe(false);
    expect(plan.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        severity: 'decisionRequired',
        code: 'capture.profileReferencedDelete',
        message: expect.stringMatching(/skill:kept.*\[dev, global\]|skill:kept.*\[global, dev\]/),
        details: expect.stringMatching(/dev.*global|global.*dev/),
      }),
    ]));
    expect(plan.nextActions).toEqual(expect.arrayContaining([
      expect.stringContaining('Resolve every decisionRequired'),
    ]));

    const blocked = await applyCapturePlan(context, plan, { changeIds: [] });
    expect(blocked).toMatchObject({
      status: 'blocked',
      issues: expect.arrayContaining([
        expect.objectContaining({ code: 'capture.profileReferencedDelete' }),
      ]),
    });
    expect(fs.existsSync(path.join(kept, 'SKILL.md'))).toBe(true);
  });

  it('leaves newly captured Assets Unassigned and reports the new Unassigned count without rewriting profiles.yaml', async () => {
    writeProfilesDocument(repositoryPath, {
      schemaVersion: 1,
      profiles: { global: { assets: [] } },
    });
    const profilesBefore = fs.readFileSync(path.join(repositoryPath, 'profiles.yaml'), 'utf8');
    const skillDir = path.join(homeDir, '.claude', 'skills', 'review');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '---\nname: review\n---\n# Review\n');

    const plan = await createCapturePlan(context);
    const skill = plan.changes.find((change) =>
      change.itemType === 'skill' && change.name === 'review' && change.change === 'add');
    if (!skill) throw new Error('expected skill add change');

    const result = await applyCapturePlan(context, plan, { changeIds: [skill.id] });

    expect(result).toMatchObject({
      status: 'succeeded',
      data: {
        appliedChangeIds: [skill.id],
        newUnassignedCount: 1,
        newUnassignedAssetIds: ['skill:review'],
      },
      nextActions: [
        'Classify 1 new Unassigned Asset(s) with an Agent or `mcv profile edit <id> --add ...`, or create a Profile.',
      ],
    });
    expect(fs.readFileSync(path.join(repositoryPath, 'profiles.yaml'), 'utf8')).toBe(profilesBefore);
    expect(fs.readFileSync(
      path.join(repositoryPath, 'common', 'skills', 'review', 'SKILL.md'),
      'utf8',
    )).toContain('# Review');

    const inventory = createProfileService(repositoryPath).inspect();
    expect(inventory.unassignedAssetIds).toContain('skill:review');
    expect(inventory.profiles.global.assets).not.toContain('skill:review');
  });

  it('keeps Profile references intact when updating an already-cataloged Asset', async () => {
    const skillRepo = path.join(repositoryPath, 'common', 'skills', 'review');
    fs.mkdirSync(skillRepo, { recursive: true });
    fs.writeFileSync(path.join(skillRepo, 'SKILL.md'), '---\nname: review\n---\n# Old\n');
    writeProfilesDocument(repositoryPath, {
      schemaVersion: 1,
      profiles: {
        global: { assets: ['skill:review'] },
        team: { assets: ['skill:review'] },
      },
    });
    const profilesBefore = fs.readFileSync(path.join(repositoryPath, 'profiles.yaml'), 'utf8');
    const skillDir = path.join(homeDir, '.claude', 'skills', 'review');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '---\nname: review\n---\n# New\n');

    const plan = await createCapturePlan(context);
    const skill = plan.changes.find((change) =>
      change.itemType === 'skill' && change.name === 'review' && change.change === 'modify');
    if (!skill) throw new Error('expected skill modify change');

    const result = await applyCapturePlan(context, plan, { changeIds: [skill.id] });

    expect(result).toMatchObject({
      status: 'succeeded',
      data: {
        newUnassignedCount: 0,
        newUnassignedAssetIds: [],
      },
      nextActions: [],
    });
    expect(fs.readFileSync(path.join(repositoryPath, 'profiles.yaml'), 'utf8')).toBe(profilesBefore);
    expect(fs.readFileSync(path.join(skillRepo, 'SKILL.md'), 'utf8')).toContain('# New');
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
