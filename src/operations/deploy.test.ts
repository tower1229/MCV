import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DeviceContext } from '../adapters/types.js';
import { atomicWriteFile } from '../utils/files.js';
import { readState, writeState } from '../utils/state.js';
import { applyDeployPlan, createDeployPlan } from './deploy.js';
import { inspectStatus } from './status.js';

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
      'schemaVersion: 4',
      'repositoryId: deploy-operation-test',
      'initializedAt: 2026-07-22T00:00:00.000Z',
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

  it('returns a grouped read-only Plan with stable IDs, full previews, and precondition hashes', async () => {
    const repositoryBefore = hashDirectory(repositoryPath);
    const stateBefore = readState(context);
    const first = await createDeployPlan(context);
    const second = await createDeployPlan(context);

    expect(first).toMatchObject({
      schemaVersion: 2,
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

  it('shows existing local plaintext configuration in the preview without blocking replacement', async () => {
    const settingsSource = path.join(
      repositoryPath,
      'ide',
      'claude-code',
      'native',
      'settings.json',
    );
    const settingsTarget = path.join(homeDir, '.claude', 'settings.json');
    fs.writeFileSync(
      settingsSource,
      `${JSON.stringify({ env: { ANTHROPIC_AUTH_TOKEN: '${env:ANTHROPIC_AUTH_TOKEN}' } }, null, 2)}\n`,
    );
    fs.writeFileSync(
      settingsTarget,
      `${JSON.stringify({ env: { ANTHROPIC_AUTH_TOKEN: `sk-${'a'.repeat(24)}` } }, null, 2)}\n`,
    );

    const plan = await createDeployPlan(context);

    expect(plan.readyToApply).toBe(true);
    expect(plan.issues.map((issue) => issue.code)).not.toContainEqual(
      expect.stringMatching(/^deploy\.unsafeDiffWithheld\./),
    );
    expect(plan.changes.find((change) => change.targetPath === settingsTarget)?.preview)
      .toMatchObject({ kind: 'text', diff: expect.stringContaining(`sk-${'a'.repeat(24)}`) });
    expect(JSON.stringify(plan)).toContain(`sk-${'a'.repeat(24)}`);
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
    const plan = await createDeployPlan(context);
    const selected = plan.changes.filter((change, index, changes) =>
      change.defaultSelected
      && changes.findIndex((candidate) => candidate.targetPath === change.targetPath) === index)
      .slice(0, 3);
    if (selected.length !== 3) throw new Error('expected at least three selected writes');
    const firstPath = selected[0].targetPath;
    const unattemptedPath = selected[2].targetPath;
    const firstBefore = fs.existsSync(firstPath) ? fs.readFileSync(firstPath) : undefined;
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
            fs.mkdirSync(path.dirname(unattemptedPath), { recursive: true });
            fs.writeFileSync(unattemptedPath, '{"external":true}\n');
            return;
          }
          throw new Error('stop before later target');
        },
      },
    );

    expect(result).toMatchObject({ status: 'failed', error: { code: 'deploy.transactionFailed' } });
    if (firstBefore) expect(fs.readFileSync(firstPath)).toEqual(firstBefore);
    else expect(fs.existsSync(firstPath)).toBe(false);
    expect(fs.readFileSync(unattemptedPath, 'utf8')).toBe('{"external":true}\n');
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
      .map((issue) => issue.confirmationId!);
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
      confirmedIssueIds: warningCodes,
    });
    expect(confirmed.status).toBe('succeeded');
    expect(fs.readFileSync(linkTarget, 'utf8')).toBe('# Linked rules\n');
  });

  it('treats a matching externally linked Skill root as one satisfied package outcome', async () => {
    const skillsRoot = path.join(homeDir, '.claude', 'skills');
    const externalRoot = path.join(testRoot, 'external-skills');
    const externalSkill = path.join(externalRoot, 'review', 'SKILL.md');
    fs.rmSync(skillsRoot, { recursive: true });
    fs.mkdirSync(path.dirname(externalSkill), { recursive: true });
    fs.writeFileSync(externalSkill, '# Review\n');
    createDirectoryLink(externalRoot, skillsRoot);

    const plan = await createDeployPlan(context);

    expect(plan.linkOutcomes).toEqual([expect.objectContaining({
      status: 'satisfied-via-link',
      ownership: 'external',
      scope: 'shared-link-root',
      owner: 'ide',
      ide: 'claude-code',
      surface: 'claude-code',
      linkPath: skillsRoot,
      linkPaths: [skillsRoot],
      resolvedPath: externalRoot,
      resolvedPaths: [externalRoot],
      packageNames: ['review'],
      affectedFileCount: 1,
    })]);
    expect(plan.issues).toContainEqual(expect.objectContaining({
      severity: 'notice',
      code: 'deploy.skillsLinked.satisfied',
      message: expect.stringContaining('Satisfied via link'),
    }));
    expect(plan.changes.some((change) =>
      change.capability === 'skills' && change.targetPath.startsWith(skillsRoot))).toBe(false);

    const selectedIds = plan.changes
      .filter((change) => change.defaultSelected)
      .map((change) => change.id);
    const result = await applyDeployPlan(
      context,
      plan,
      { changeIds: selectedIds },
      { nonInteractive: true },
    );

    expect(result).toMatchObject({ status: 'succeeded' });
    expect(fs.readFileSync(externalSkill, 'utf8')).toBe('# Review\n');
    expect(readState(context).managedInventory).not.toHaveProperty(externalSkill);
  });

  it('keeps rule-named files inside a linked Skill package in the Skill capability', async () => {
    const skillsRoot = path.join(homeDir, '.claude', 'skills');
    const sourceReference = path.join(
      repositoryPath,
      'common',
      'skills',
      'review',
      'references',
      'CLAUDE.md',
    );
    const externalRoot = path.join(testRoot, 'external-skills');
    const externalSkill = path.join(externalRoot, 'review', 'SKILL.md');
    const externalReference = path.join(externalRoot, 'review', 'references', 'CLAUDE.md');
    fs.rmSync(skillsRoot, { recursive: true });
    fs.mkdirSync(path.dirname(sourceReference), { recursive: true });
    fs.mkdirSync(path.dirname(externalReference), { recursive: true });
    fs.writeFileSync(sourceReference, '# Skill-specific Claude reference\n');
    fs.writeFileSync(externalSkill, '# Review\n');
    fs.writeFileSync(externalReference, '# Skill-specific Claude reference\n');
    createDirectoryLink(externalRoot, skillsRoot);

    const plan = await createDeployPlan(context);

    expect(plan.linkOutcomes).toEqual([expect.objectContaining({
      status: 'satisfied-via-link',
      packageNames: ['review'],
      affectedFileCount: 2,
    })]);
    expect(plan.issues.some((issue) =>
      issue.code.startsWith('deploy.symbolicLinkSkipped.'))).toBe(false);
    expect(plan.changes.some((change) =>
      change.targetPath === path.join(skillsRoot, 'review', 'references', 'CLAUDE.md'))).toBe(false);
  });

  it('aggregates multiple nested links inside one Skill package into one outcome', async () => {
    const sourceReference = path.join(
      repositoryPath,
      'common',
      'skills',
      'review',
      'references',
      'guide.md',
    );
    const packageRoot = path.join(homeDir, '.claude', 'skills', 'review');
    const skillLink = path.join(packageRoot, 'SKILL.md');
    const referencesLink = path.join(packageRoot, 'references');
    const externalSkill = path.join(testRoot, 'external-review.md');
    const externalReferences = path.join(testRoot, 'external-references');
    fs.rmSync(path.join(homeDir, '.claude', 'skills'), { recursive: true });
    fs.mkdirSync(path.dirname(sourceReference), { recursive: true });
    fs.mkdirSync(packageRoot, { recursive: true });
    fs.mkdirSync(externalReferences, { recursive: true });
    fs.writeFileSync(sourceReference, '# Guide\n');
    fs.writeFileSync(externalSkill, '# Review\n');
    fs.writeFileSync(path.join(externalReferences, 'guide.md'), '# Guide\n');
    fs.symlinkSync(externalSkill, skillLink);
    createDirectoryLink(externalReferences, referencesLink);

    const plan = await createDeployPlan(context);

    expect(plan.linkOutcomes).toEqual([expect.objectContaining({
      status: 'satisfied-via-link',
      ownership: 'external',
      scope: 'skill-package',
      linkPath: [referencesLink, skillLink].sort()[0],
      linkPaths: [referencesLink, skillLink].sort(),
      resolvedPaths: [externalReferences, externalSkill].sort(),
      packageNames: ['review'],
      affectedFileCount: 2,
    })]);
    expect(plan.issues.filter((issue) =>
      issue.code === 'deploy.skillsLinked.satisfied')).toHaveLength(1);
    expect(plan.changes.some((change) =>
      change.capability === 'skills' && change.targetPath.startsWith(packageRoot))).toBe(false);
  });

  it('preserves a divergent external Skill link without blocking unrelated Deploy changes', async () => {
    const manifestPath = path.join(repositoryPath, 'mcv.yaml');
    fs.writeFileSync(manifestPath, fs.readFileSync(manifestPath, 'utf8').replace(
      'targets:\n  claudeCode:',
      'targets:\n  codex:\n    enabled: true\n  claudeCode:',
    ));
    const skillsRoot = path.join(homeDir, '.claude', 'skills');
    const codexSkillsRoot = path.join(homeDir, '.agents', 'skills');
    const externalRoot = path.join(testRoot, 'external-skills');
    const externalSkill = path.join(externalRoot, 'review', 'SKILL.md');
    const sourceReference = path.join(
      repositoryPath,
      'common',
      'skills',
      'review',
      'references',
      'guide.md',
    );
    fs.rmSync(skillsRoot, { recursive: true });
    fs.mkdirSync(path.dirname(externalSkill), { recursive: true });
    fs.mkdirSync(path.dirname(sourceReference), { recursive: true });
    fs.writeFileSync(externalSkill, '# Externally changed\n');
    fs.writeFileSync(sourceReference, '# Guide\n');
    createDirectoryLink(externalRoot, skillsRoot);
    fs.mkdirSync(path.dirname(codexSkillsRoot), { recursive: true });
    createDirectoryLink(externalRoot, codexSkillsRoot);

    const plan = await createDeployPlan(context);

    expect(plan.readyToApply).toBe(true);
    expect(plan.linkOutcomes).toHaveLength(2);
    expect(plan.linkOutcomes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        status: 'blocked',
        ownership: 'external',
        scope: 'shared-link-root',
        linkPath: skillsRoot,
        resolvedPath: externalRoot,
        packageNames: ['review'],
        affectedFileCount: 2,
        reason: 'divergent',
      }),
      expect.objectContaining({
        status: 'blocked',
        ownership: 'external',
        scope: 'shared-link-root',
        linkPath: codexSkillsRoot,
        resolvedPath: externalRoot,
        packageNames: ['review'],
        affectedFileCount: 2,
        reason: 'divergent',
      }),
    ]));
    expect(plan.issues.filter((issue) =>
      issue.code === 'deploy.skillsLinked.divergent')).toEqual([
      expect.objectContaining({
        severity: 'warning',
        message: expect.stringContaining('2 affected file(s)'),
      }),
    ]);
    expect(plan.changes.some((change) =>
      change.targetPath.startsWith(skillsRoot)
      || change.targetPath.startsWith(codexSkillsRoot))).toBe(false);
    const unrelatedChange = plan.changes.find((change) =>
      change.defaultSelected
      && !change.targetPath.startsWith(skillsRoot)
      && !change.targetPath.startsWith(codexSkillsRoot));
    expect(unrelatedChange).toBeDefined();

    const result = await applyDeployPlan(context, plan, {
      changeIds: [unrelatedChange!.id],
      confirmedIssueIds: plan.issues
        .filter((issue) => issue.severity === 'warning')
        .map((issue) => issue.confirmationId!),
    });
    expect(result.status).toBe('succeeded');
    expect(fs.existsSync(unrelatedChange!.targetPath)).toBe(true);
    expect(fs.readFileSync(externalSkill, 'utf8')).toBe('# Externally changed\n');
  });

  it('requires a per-package external link decision and preserves it without touching its target', async () => {
    const packagePath = path.join(homeDir, '.claude', 'skills', 'review');
    const externalPackage = path.join(testRoot, 'external-review');
    const externalSkill = path.join(externalPackage, 'SKILL.md');
    fs.rmSync(packagePath, { recursive: true, force: true });
    fs.mkdirSync(externalPackage, { recursive: true });
    fs.writeFileSync(externalSkill, '# External review\n');
    createDirectoryLink(externalPackage, packagePath);

    const plan = await createDeployPlan(context);
    expect(plan.decisions).toEqual([expect.objectContaining({
      kind: 'external-skill-divergence',
      packageNames: ['review'],
      choices: ['preserve-external', 'replace-with-repository'],
    })]);
    expect(plan.issues).toContainEqual(expect.objectContaining({
      severity: 'decisionRequired',
      decisionId: plan.decisions[0].id,
    }));

    const blocked = await applyDeployPlan(context, plan, {
      changeIds: plan.changes.filter((change) => change.defaultSelected).map((change) => change.id),
    });
    expect(blocked.status).toBe('blocked');

    const preservePlan = await createDeployPlan(context);
    const decision = preservePlan.decisions[0];
    const result = await applyDeployPlan(context, preservePlan, {
      changeIds: preservePlan.changes.filter((change) => change.defaultSelected).map((change) => change.id),
      decisions: { [decision.id]: 'preserve-external' },
    });
    expect(result.status).toBe('succeeded');
    expect(fs.lstatSync(packagePath).isSymbolicLink()).toBe(true);
    expect(fs.readFileSync(externalSkill, 'utf8')).toBe('# External review\n');
  });

  it('replaces only a divergent per-package link node and rolls it back exactly on failure', async () => {
    const packagePath = path.join(homeDir, '.claude', 'skills', 'review');
    const externalPackage = path.join(testRoot, 'external-review');
    const externalSkill = path.join(externalPackage, 'SKILL.md');
    fs.rmSync(packagePath, { recursive: true, force: true });
    fs.mkdirSync(externalPackage, { recursive: true });
    fs.writeFileSync(externalSkill, '# External review\n');
    createDirectoryLink(externalPackage, packagePath);

    const failingPlan = await createDeployPlan(context);
    const failingDecision = failingPlan.decisions[0];
    const failingSelection = [
      ...failingPlan.changes.filter((change) => change.defaultSelected).map((change) => change.id),
      ...failingDecision.replacementChangeIds,
    ];
    const failed = await applyDeployPlan(context, failingPlan, {
      changeIds: failingSelection,
      decisions: { [failingDecision.id]: 'replace-with-repository' },
    }, {
      writeFile: () => { throw new Error('injected package write failure'); },
    });
    expect(failed).toMatchObject({ status: 'failed', error: { code: 'deploy.transactionFailed' } });
    expect(fs.lstatSync(packagePath).isSymbolicLink()).toBe(true);
    expect(fs.realpathSync(packagePath)).toBe(fs.realpathSync(externalPackage));
    expect(fs.readFileSync(externalSkill, 'utf8')).toBe('# External review\n');

    const plan = await createDeployPlan(context);
    const decision = plan.decisions[0];
    const result = await applyDeployPlan(context, plan, {
      changeIds: [
        ...plan.changes.filter((change) => change.defaultSelected).map((change) => change.id),
        ...decision.replacementChangeIds,
      ],
      decisions: { [decision.id]: 'replace-with-repository' },
    });
    expect(result.status).toBe('succeeded');
    expect(fs.lstatSync(packagePath).isDirectory()).toBe(true);
    expect(fs.lstatSync(packagePath).isSymbolicLink()).toBe(false);
    expect(fs.readFileSync(path.join(packagePath, 'SKILL.md'), 'utf8')).toBe('# Review\n');
    expect(fs.readFileSync(externalSkill, 'utf8')).toBe('# External review\n');

    const nextPlan = await createDeployPlan(context);
    expect(nextPlan.status).toBe('planned');
    expect(nextPlan.changes.some((change) =>
      change.change === 'delete' && change.targetPath === packagePath)).toBe(false);
  });

  it('classifies a non-directory link target as one physical-target conflict', async () => {
    const skillsRoot = path.join(homeDir, '.claude', 'skills');
    const externalFile = path.join(testRoot, 'external-file');
    fs.rmSync(skillsRoot, { recursive: true });
    fs.writeFileSync(externalFile, 'not a Skill directory\n');
    fs.symlinkSync(externalFile, skillsRoot);

    const plan = await createDeployPlan(context);

    expect(plan.linkOutcomes).toEqual([expect.objectContaining({
      status: 'blocked',
      reason: 'physical-target-conflict',
      linkPath: skillsRoot,
      resolvedPath: externalFile,
      affectedFileCount: 1,
    })]);
    expect(plan.issues.filter((issue) =>
      issue.code === 'deploy.skillsLinked.physical-target-conflict')).toHaveLength(1);
  });

  it('never proposes managed cleanup beneath an unclassified external link', async () => {
    const skillsRoot = path.join(homeDir, '.claude', 'skills');
    const externalRoot = path.join(testRoot, 'external-skills');
    const externalStale = path.join(externalRoot, 'stale', 'SKILL.md');
    fs.rmSync(skillsRoot, { recursive: true });
    fs.mkdirSync(path.dirname(externalStale), { recursive: true });
    fs.writeFileSync(externalStale, 'externally owned\n');
    createDirectoryLink(externalRoot, skillsRoot);

    const plan = await createDeployPlan(context);

    expect(plan.changes.some((change) =>
      change.change === 'delete' && change.targetPath.startsWith(skillsRoot))).toBe(false);
    expect(fs.readFileSync(externalStale, 'utf8')).toBe('externally owned\n');
  });

  it.each([
    ['dangling', 'missing-skills'],
    ['cycle', 'self'],
  ] as const)('blocks one %s Skill-link outcome without traversing it', async (reason, target) => {
    const skillsRoot = path.join(homeDir, '.claude', 'skills');
    fs.rmSync(skillsRoot, { recursive: true });
    createDirectoryLink(
      target === 'self' ? skillsRoot : path.join(testRoot, target),
      skillsRoot,
    );

    const plan = await createDeployPlan(context);

    expect(plan.linkOutcomes).toEqual([expect.objectContaining({
      status: 'blocked',
      reason,
      linkPath: skillsRoot,
      affectedFileCount: 1,
    })]);
    expect(plan.issues.filter((issue) =>
      issue.code === `deploy.skillsLinked.${reason}`)).toHaveLength(1);
    expect(plan.changes.some((change) => change.targetPath.startsWith(skillsRoot))).toBe(false);
  });

  it('does not classify or traverse a link above the Skill root', async () => {
    const claudeRoot = path.join(homeDir, '.claude');
    const externalRoot = path.join(testRoot, 'external-claude');
    const externalSkill = path.join(externalRoot, 'skills', 'review', 'SKILL.md');
    fs.rmSync(claudeRoot, { recursive: true });
    fs.mkdirSync(path.dirname(externalSkill), { recursive: true });
    fs.writeFileSync(externalSkill, '# Review\n');
    createDirectoryLink(externalRoot, claudeRoot);

    const plan = await createDeployPlan(context);

    expect(plan.linkOutcomes).toEqual([expect.objectContaining({
      status: 'blocked',
      reason: 'unclassified',
      linkPath: claudeRoot,
      affectedFileCount: 1,
    })]);
    expect(plan.changes.some((change) =>
      change.targetPath.startsWith(`${claudeRoot}${path.sep}`))).toBe(false);
    expect(fs.readFileSync(externalSkill, 'utf8')).toBe('# Review\n');
  });

  it('lets a shared Skill link follow an equivalent physical Deploy target', async () => {
    const manifestPath = path.join(repositoryPath, 'mcv.yaml');
    fs.writeFileSync(manifestPath, fs.readFileSync(manifestPath, 'utf8').replace(
      'targets:\n  claudeCode:',
      'targets:\n  codex:\n    enabled: true\n  claudeCode:',
    ));
    const linkedSkillsRoot = path.join(homeDir, '.claude', 'skills');
    const physicalSkillsRoot = path.join(homeDir, '.agents', 'skills');
    const physicalSkill = path.join(physicalSkillsRoot, 'review', 'SKILL.md');
    fs.rmSync(linkedSkillsRoot, { recursive: true });
    fs.mkdirSync(path.dirname(physicalSkill), { recursive: true });
    fs.writeFileSync(physicalSkill, '# Old review\n');
    createDirectoryLink(physicalSkillsRoot, linkedSkillsRoot);

    const plan = await createDeployPlan(context);

    expect(plan.readyToApply).toBe(true);
    expect(plan.linkOutcomes).toEqual([expect.objectContaining({
      status: 'satisfied-via-link',
      ownership: 'external',
      linkPath: linkedSkillsRoot,
      resolvedPath: physicalSkillsRoot,
      affectedFileCount: 1,
    })]);
    expect(plan.changes.filter((change) =>
      change.capability === 'skills'
      && change.targetPath.endsWith(path.join('review', 'SKILL.md')))).toEqual([
      expect.objectContaining({
        ide: 'codex',
        targetPath: physicalSkill,
        change: 'modify',
      }),
    ]);
  });

  it('offers a matching physical Skill copy as an unselected topology-migration candidate', async () => {
    const manifestPath = path.join(repositoryPath, 'mcv.yaml');
    fs.writeFileSync(
      manifestPath,
      fs.readFileSync(manifestPath, 'utf8').replace('useSymlinks: false', 'useSymlinks: true'),
    );
    const storeFile = path.join(homeDir, '.agents', 'skills', 'review', 'SKILL.md');
    const projectionPath = path.join(homeDir, '.claude', 'skills', 'review');
    const storePackage = path.dirname(storeFile);
    fs.mkdirSync(projectionPath, { recursive: true });
    fs.writeFileSync(path.join(projectionPath, 'SKILL.md'), '# Review\n');

    const plan = await createDeployPlan(context);

    expect(plan.readyToApply).toBe(true);
    expect(plan.changes.filter((change) => change.capability === 'skills')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          owner: 'canonical-store',
          targetPath: storeFile,
          deploymentKind: 'physical-materialization',
          defaultSelected: true,
        }),
        expect.objectContaining({
          ide: 'claude-code',
          targetPath: projectionPath,
          deploymentKind: 'topology-migration',
          defaultSelected: false,
          change: 'modify',
          preview: expect.objectContaining({
            kind: 'link',
            linkTarget: storePackage,
          }),
        }),
      ]),
    );
    expect(plan.changes.some((change) =>
      change.deploymentKind === 'managed-link-projection'
      && change.targetPath === projectionPath)).toBe(false);
    expect(plan.issues).toContainEqual(expect.objectContaining({
      severity: 'warning',
      code: 'deploy.skillsTopology.migrationCandidate',
      message: expect.stringMatching(/topology migration|managed link/i),
    }));
    expect(plan.changes.filter((change) => change.defaultSelected).some((change) =>
      change.deploymentKind === 'topology-migration')).toBe(false);
  });

  it('preserves a divergent physical Skill copy and directs the user to Capture', async () => {
    const manifestPath = path.join(repositoryPath, 'mcv.yaml');
    fs.writeFileSync(
      manifestPath,
      fs.readFileSync(manifestPath, 'utf8').replace('useSymlinks: false', 'useSymlinks: true'),
    );
    const projectionPath = path.join(homeDir, '.claude', 'skills', 'review');
    fs.mkdirSync(projectionPath, { recursive: true });
    fs.writeFileSync(path.join(projectionPath, 'SKILL.md'), '# Local review edits\n');

    const plan = await createDeployPlan(context);

    expect(plan.changes.some((change) =>
      change.targetPath === projectionPath
      && (change.deploymentKind === 'topology-migration'
        || change.deploymentKind === 'managed-link-projection'))).toBe(false);
    expect(plan.issues).toContainEqual(expect.objectContaining({
      severity: 'warning',
      code: 'deploy.skillsTopology.divergentPhysicalCopy',
      message: expect.stringMatching(/divergent physical Skill copy/i),
      details: expect.stringMatching(/Capture/i),
    }));
    expect(fs.readFileSync(path.join(projectionPath, 'SKILL.md'), 'utf8')).toBe('# Local review edits\n');
  });

  it('never adopts an existing external Skill link as a topology migration', async () => {
    const manifestPath = path.join(repositoryPath, 'mcv.yaml');
    fs.writeFileSync(
      manifestPath,
      fs.readFileSync(manifestPath, 'utf8').replace('useSymlinks: false', 'useSymlinks: true'),
    );
    const projectionPath = path.join(homeDir, '.claude', 'skills', 'review');
    const externalPackage = path.join(homeDir, 'external-skills', 'review');
    fs.mkdirSync(externalPackage, { recursive: true });
    fs.writeFileSync(path.join(externalPackage, 'SKILL.md'), '# Review\n');
    fs.symlinkSync(externalPackage, projectionPath, 'dir');

    const plan = await createDeployPlan(context);

    expect(plan.changes.some((change) =>
      change.targetPath === projectionPath
      && change.deploymentKind === 'topology-migration')).toBe(false);
    expect(plan.linkOutcomes).toContainEqual(expect.objectContaining({
      status: 'satisfied-via-link',
      ownership: 'external',
      linkPath: projectionPath,
      resolvedPath: externalPackage,
    }));
    expect(fs.lstatSync(projectionPath).isSymbolicLink()).toBe(true);
    expect(fs.readlinkSync(projectionPath)).toBe(externalPackage);
  });

  it('refuses topology migration in non-interactive Deploy even after dry-run planning', async () => {
    const manifestPath = path.join(repositoryPath, 'mcv.yaml');
    fs.writeFileSync(
      manifestPath,
      fs.readFileSync(manifestPath, 'utf8').replace('useSymlinks: false', 'useSymlinks: true'),
    );
    const projectionPath = path.join(homeDir, '.claude', 'skills', 'review');
    fs.mkdirSync(projectionPath, { recursive: true });
    fs.writeFileSync(path.join(projectionPath, 'SKILL.md'), '# Review\n');

    const dryRun = await createDeployPlan(context);
    expect(dryRun.changes.some((change) =>
      change.deploymentKind === 'topology-migration')).toBe(true);

    const result = await applyDeployPlan(
      context,
      dryRun,
      {
        changeIds: dryRun.changes
          .filter((change) => change.defaultSelected || change.deploymentKind === 'topology-migration')
          .map((change) => change.id),
        confirmedIssueIds: dryRun.issues
          .filter((issue) => issue.severity === 'warning')
          .map((issue) => issue.confirmationId!),
      },
      { nonInteractive: true },
    );

    expect(result).toMatchObject({
      status: 'blocked',
      issues: [expect.objectContaining({ code: 'deploy.nonInteractiveBlocked' })],
    });
    expect(fs.lstatSync(projectionPath).isDirectory()).toBe(true);
    expect(fs.lstatSync(projectionPath).isSymbolicLink()).toBe(false);
    expect(fs.readFileSync(path.join(projectionPath, 'SKILL.md'), 'utf8')).toBe('# Review\n');
  });

  it('migrates a matching physical Skill copy to a managed link with recoverable backup', async () => {
    const manifestPath = path.join(repositoryPath, 'mcv.yaml');
    fs.writeFileSync(
      manifestPath,
      fs.readFileSync(manifestPath, 'utf8').replace('useSymlinks: false', 'useSymlinks: true'),
    );
    const storeFile = path.join(homeDir, '.agents', 'skills', 'review', 'SKILL.md');
    const projectionPath = path.join(homeDir, '.claude', 'skills', 'review');
    const storePackage = path.dirname(storeFile);
    fs.mkdirSync(projectionPath, { recursive: true });
    fs.writeFileSync(path.join(projectionPath, 'SKILL.md'), '# Review\n');
    const plan = await createDeployPlan(context);
    const migration = plan.changes.find((change) =>
      change.deploymentKind === 'topology-migration');
    if (!migration) throw new Error('expected topology migration');
    const selected = plan.changes.filter((change) =>
      change.defaultSelected || change.deploymentKind === 'topology-migration');

    const result = await applyDeployPlan(
      context,
      plan,
      {
        changeIds: selected.map((change) => change.id),
        confirmedIssueIds: plan.issues
          .filter((issue) => issue.severity === 'warning')
          .map((issue) => issue.confirmationId!),
      },
    );

    expect(result).toMatchObject({ status: 'succeeded' });
    expect(fs.readFileSync(storeFile, 'utf8')).toBe('# Review\n');
    expect(fs.lstatSync(projectionPath).isSymbolicLink()).toBe(true);
    expect(fs.realpathSync(projectionPath)).toBe(fs.realpathSync(storePackage));
    expect(result.status === 'succeeded' && result.data?.backupPath).toEqual(expect.any(String));
    expect(result.status === 'succeeded' && result.data?.projectionPaths).toEqual([projectionPath]);
    if (result.status !== 'succeeded' || !result.data?.backupPath) {
      throw new Error('expected successful migration backup');
    }
    const manifest = JSON.parse(
      fs.readFileSync(path.join(result.data.backupPath, 'manifest.json'), 'utf8'),
    ) as {
      status: string;
      files: Array<{
        changeId: string;
        originalPath: string;
        backupPath?: string;
        nodeKind?: string;
      }>;
    };
    expect(manifest.status).toBe('complete');
    const migrationBackup = manifest.files.find((entry) => entry.changeId === migration.id);
    expect(migrationBackup).toMatchObject({
      originalPath: projectionPath,
      nodeKind: 'directory',
      backupPath: expect.any(String),
    });
    expect(fs.readFileSync(
      path.join(result.data.backupPath, migrationBackup?.backupPath as string, 'SKILL.md'),
      'utf8',
    )).toBe('# Review\n');

    const nextPlan = await createDeployPlan(context);
    expect(nextPlan.linkOutcomes).toContainEqual(expect.objectContaining({
      status: 'satisfied-via-link',
      ownership: 'managed',
      linkPath: projectionPath,
    }));
    expect(nextPlan.changes.some((change) =>
      change.targetPath === projectionPath)).toBe(false);
  });

  it('rejects a topology migration when the physical copy changes after Plan review', async () => {
    const manifestPath = path.join(repositoryPath, 'mcv.yaml');
    fs.writeFileSync(
      manifestPath,
      fs.readFileSync(manifestPath, 'utf8').replace('useSymlinks: false', 'useSymlinks: true'),
    );
    const projectionPath = path.join(homeDir, '.claude', 'skills', 'review');
    fs.mkdirSync(projectionPath, { recursive: true });
    fs.writeFileSync(path.join(projectionPath, 'SKILL.md'), '# Review\n');
    const plan = await createDeployPlan(context);
    fs.writeFileSync(path.join(projectionPath, 'SKILL.md'), '# Changed after review\n');

    const result = await applyDeployPlan(
      context,
      plan,
      {
        changeIds: plan.changes
          .filter((change) => change.defaultSelected || change.deploymentKind === 'topology-migration')
          .map((change) => change.id),
        confirmedIssueIds: plan.issues
          .filter((issue) => issue.severity === 'warning')
          .map((issue) => issue.confirmationId!),
      },
    );

    expect(result).toMatchObject({
      status: 'failed',
      error: { code: 'operation.stalePlan' },
    });
    expect(fs.lstatSync(projectionPath).isSymbolicLink()).toBe(false);
    expect(fs.readFileSync(path.join(projectionPath, 'SKILL.md'), 'utf8')).toBe('# Changed after review\n');
  });

  it('rolls back an exact physical directory after managed-link creation fails during migration', async () => {
    const manifestPath = path.join(repositoryPath, 'mcv.yaml');
    fs.writeFileSync(
      manifestPath,
      fs.readFileSync(manifestPath, 'utf8').replace('useSymlinks: false', 'useSymlinks: true'),
    );
    const projectionPath = path.join(homeDir, '.claude', 'skills', 'review');
    fs.mkdirSync(projectionPath, { recursive: true });
    fs.writeFileSync(path.join(projectionPath, 'SKILL.md'), '# Review\n');
    const plan = await createDeployPlan(context);

    const result = await applyDeployPlan(
      context,
      plan,
      {
        changeIds: plan.changes
          .filter((change) => change.defaultSelected || change.deploymentKind === 'topology-migration')
          .map((change) => change.id),
        confirmedIssueIds: plan.issues
          .filter((issue) => issue.severity === 'warning')
          .map((issue) => issue.confirmationId!),
      },
      {
        createSymbolicLink: () => {
          throw new Error('simulated migration link failure');
        },
      },
    );

    expect(result).toMatchObject({
      status: 'failed',
      error: { code: 'deploy.transactionFailed' },
    });
    expect(fs.lstatSync(projectionPath).isSymbolicLink()).toBe(false);
    expect(fs.lstatSync(projectionPath).isDirectory()).toBe(true);
    expect(fs.readFileSync(path.join(projectionPath, 'SKILL.md'), 'utf8')).toBe('# Review\n');
  });

  it('retains a verified recovery backup when topology migration rollback is incomplete', async () => {
    const manifestPath = path.join(repositoryPath, 'mcv.yaml');
    fs.writeFileSync(
      manifestPath,
      fs.readFileSync(manifestPath, 'utf8').replace('useSymlinks: false', 'useSymlinks: true'),
    );
    const projectionPath = path.join(homeDir, '.claude', 'skills', 'review');
    fs.mkdirSync(projectionPath, { recursive: true });
    fs.writeFileSync(path.join(projectionPath, 'SKILL.md'), '# Review\n');
    const plan = await createDeployPlan(context);
    let removals = 0;

    const result = await applyDeployPlan(
      context,
      plan,
      {
        changeIds: plan.changes
          .filter((change) => change.defaultSelected || change.deploymentKind === 'topology-migration')
          .map((change) => change.id),
        confirmedIssueIds: plan.issues
          .filter((issue) => issue.severity === 'warning')
          .map((issue) => issue.confirmationId!),
      },
      {
        createSymbolicLink: () => {
          throw new Error('simulated migration link failure');
        },
        removeFile: (targetPath) => {
          removals += 1;
          if (removals === 1) {
            fs.rmSync(targetPath, { recursive: true, force: true });
            return;
          }
          throw new Error('simulated topology restore failure');
        },
      },
    );

    expect(result).toMatchObject({
      status: 'failed',
      error: {
        code: 'deploy.rollbackFailed',
        nextActions: [expect.stringMatching(/backups/)],
      },
    });
    expect(result.error?.nextActions?.[0]).toMatch(/Restore the affected files from /);
  });

  it('requires explicit confirmation before applying a selected topology migration', async () => {
    const manifestPath = path.join(repositoryPath, 'mcv.yaml');
    fs.writeFileSync(
      manifestPath,
      fs.readFileSync(manifestPath, 'utf8').replace('useSymlinks: false', 'useSymlinks: true'),
    );
    const projectionPath = path.join(homeDir, '.claude', 'skills', 'review');
    fs.mkdirSync(projectionPath, { recursive: true });
    fs.writeFileSync(path.join(projectionPath, 'SKILL.md'), '# Review\n');
    const plan = await createDeployPlan(context);

    const result = await applyDeployPlan(
      context,
      plan,
      {
        changeIds: plan.changes
          .filter((change) => change.defaultSelected || change.deploymentKind === 'topology-migration')
          .map((change) => change.id),
      },
    );

    expect(result).toMatchObject({
      status: 'blocked',
      issues: [expect.objectContaining({
        severity: 'warning',
        code: 'deploy.skillsTopology.migrationCandidate',
      })],
    });
    expect(fs.lstatSync(projectionPath).isSymbolicLink()).toBe(false);
  });

  it('rolls back after a managed link is created when migration verification fails', async () => {
    const manifestPath = path.join(repositoryPath, 'mcv.yaml');
    fs.writeFileSync(
      manifestPath,
      fs.readFileSync(manifestPath, 'utf8').replace('useSymlinks: false', 'useSymlinks: true'),
    );
    const projectionPath = path.join(homeDir, '.claude', 'skills', 'review');
    const storePackage = path.join(homeDir, '.agents', 'skills', 'review');
    fs.mkdirSync(projectionPath, { recursive: true });
    fs.writeFileSync(path.join(projectionPath, 'SKILL.md'), '# Review\n');
    const plan = await createDeployPlan(context);

    const result = await applyDeployPlan(
      context,
      plan,
      {
        changeIds: plan.changes
          .filter((change) => change.defaultSelected || change.deploymentKind === 'topology-migration')
          .map((change) => change.id),
        confirmedIssueIds: plan.issues
          .filter((issue) => issue.severity === 'warning')
          .map((issue) => issue.confirmationId!),
      },
      {
        createSymbolicLink: (_target, linkPath) => {
          fs.symlinkSync(path.dirname(storePackage), linkPath, 'dir');
        },
      },
    );

    expect(result).toMatchObject({
      status: 'failed',
      error: {
        code: 'deploy.transactionFailed',
        technicalDetails: expect.stringContaining('Deploy link verification failed'),
      },
    });
    expect(fs.lstatSync(projectionPath).isSymbolicLink()).toBe(false);
    expect(fs.readFileSync(path.join(projectionPath, 'SKILL.md'), 'utf8')).toBe('# Review\n');
  });

  it('materializes one Canonical Skill package before creating a Claude managed projection', async () => {
    const manifestPath = path.join(repositoryPath, 'mcv.yaml');
    fs.writeFileSync(
      manifestPath,
      fs.readFileSync(manifestPath, 'utf8').replace('useSymlinks: false', 'useSymlinks: true'),
    );
    const storeFile = path.join(homeDir, '.agents', 'skills', 'review', 'SKILL.md');
    const projectionPath = path.join(homeDir, '.claude', 'skills', 'review');
    const storePackage = path.dirname(storeFile);
    const plan = await createDeployPlan(context);

    expect(plan.readyToApply).toBe(true);
    expect(plan.changes.filter((change) => change.capability === 'skills')).toEqual(expect.arrayContaining([
      expect.objectContaining({
        owner: 'canonical-store',
        targetPath: storeFile,
        deploymentKind: 'physical-materialization',
      }),
      expect.objectContaining({
        ide: 'claude-code',
        targetPath: projectionPath,
        deploymentKind: 'managed-link-projection',
        preview: expect.objectContaining({
          kind: 'link',
          linkTarget: storePackage,
        }),
      }),
      expect.objectContaining({
        ide: 'claude-code',
        change: 'delete',
        deploymentKind: 'copy-projection',
      }),
    ]));
    const materialization = plan.changes.find((change) =>
      change.deploymentKind === 'physical-materialization');
    expect(materialization).not.toHaveProperty('ide');

    let linkCreatedAfterMaterialization = false;
    const selected = plan.changes.filter((change) => change.defaultSelected);
    const result = await applyDeployPlan(
      context,
      plan,
      { changeIds: selected.map((change) => change.id) },
      {
        createSymbolicLink: (target, linkPath) => {
          linkCreatedAfterMaterialization = fs.readFileSync(storeFile, 'utf8') === '# Review\n';
          fs.symlinkSync(target, linkPath, 'dir');
        },
      },
    );

    expect(result).toMatchObject({ status: 'succeeded' });
    expect(linkCreatedAfterMaterialization).toBe(true);
    expect(fs.readFileSync(storeFile, 'utf8')).toBe('# Review\n');
    expect(fs.lstatSync(projectionPath).isSymbolicLink()).toBe(true);
    expect(fs.realpathSync(projectionPath)).toBe(fs.realpathSync(storePackage));
    expect(result.status === 'succeeded' && result.data?.projectionPaths).toEqual([projectionPath]);
    expect(readState(context).lastDeploySelection).not.toHaveProperty('codex');

    const nextPlan = await createDeployPlan(context);
    expect(nextPlan.linkOutcomes).toEqual([expect.objectContaining({
      status: 'satisfied-via-link',
      ownership: 'managed',
      scope: 'skill-package',
      linkPath: projectionPath,
      resolvedPath: storePackage,
    })]);
    expect(nextPlan.changes.some((change) => change.targetPath === projectionPath)).toBe(false);
    const satisfiedResult = await applyDeployPlan(context, nextPlan, { changeIds: [] });
    expect(satisfiedResult).toMatchObject({
      status: 'succeeded',
      linkOutcomes: [expect.objectContaining({
        status: 'satisfied-via-link',
        ownership: 'managed',
        linkPath: projectionPath,
      })],
    });
    const status = await inspectStatus(context);
    expect(status.postDeployLocalState).toMatchObject({
      drift: 0,
      contentDrift: 0,
      topologyDrift: 0,
      missing: 0,
    });
    expect(readState(context).managedSkillLayout).toEqual(expect.objectContaining({
      packages: expect.objectContaining({
        [storePackage]: expect.objectContaining({
          packageName: 'review',
          storePath: storePackage,
          contentHash: expect.any(String),
        }),
      }),
      projections: expect.objectContaining({
        [projectionPath]: expect.objectContaining({
          packageName: 'review',
          ide: 'claude-code',
          surface: 'claude-code',
          expectedLinkTarget: storePackage,
        }),
      }),
    }));
  });

  it('blocks an unowned divergent Store package without overwriting or projecting it', async () => {
    const manifestPath = path.join(repositoryPath, 'mcv.yaml');
    fs.writeFileSync(
      manifestPath,
      fs.readFileSync(manifestPath, 'utf8').replace('useSymlinks: false', 'useSymlinks: true'),
    );
    const storePackage = path.join(homeDir, '.agents', 'skills', 'review');
    const storeFile = path.join(storePackage, 'SKILL.md');
    const extraFile = path.join(storePackage, 'local-notes.md');
    const projectionPath = path.join(homeDir, '.claude', 'skills', 'review');
    fs.mkdirSync(storePackage, { recursive: true });
    fs.writeFileSync(storeFile, '# Local review changes\n');
    fs.writeFileSync(extraFile, '# Keep me\n');

    const plan = await createDeployPlan(context);

    expect(plan.readyToApply).toBe(false);
    expect(plan.issues).toContainEqual(expect.objectContaining({
      severity: 'error',
      code: 'deploy.skillsLayout.unownedStorePackage',
    }));
    expect(plan.changes.some((change) =>
      change.targetPath === storeFile || change.targetPath === projectionPath)).toBe(false);
    expect(fs.readFileSync(storeFile, 'utf8')).toBe('# Local review changes\n');
    expect(fs.readFileSync(extraFile, 'utf8')).toBe('# Keep me\n');
    expect(readState(context).managedSkillLayout).toBeUndefined();
  });

  it('reuses an exact unowned Store package without claiming it or offering package cleanup', async () => {
    const manifestPath = path.join(repositoryPath, 'mcv.yaml');
    fs.writeFileSync(
      manifestPath,
      fs.readFileSync(manifestPath, 'utf8').replace('useSymlinks: false', 'useSymlinks: true'),
    );
    const storePackage = path.join(homeDir, '.agents', 'skills', 'review');
    const storeFile = path.join(storePackage, 'SKILL.md');
    const projectionPath = path.join(homeDir, '.claude', 'skills', 'review');
    fs.mkdirSync(storePackage, { recursive: true });
    fs.writeFileSync(storeFile, '# Review\n');

    const plan = await createDeployPlan(context);

    expect(plan.readyToApply).toBe(true);
    expect(plan.changes.some((change) =>
      change.deploymentKind === 'physical-materialization'
      && change.targetPath.startsWith(storePackage))).toBe(false);
    expect(plan.changes).toContainEqual(expect.objectContaining({
      targetPath: projectionPath,
      deploymentKind: 'managed-link-projection',
    }));

    const result = await applyDeployPlan(
      context,
      plan,
      { changeIds: plan.changes.filter((change) => change.defaultSelected).map((change) => change.id) },
      { createSymbolicLink: createDirectoryLink },
    );
    expect(result.status).toBe('succeeded');
    expect(readState(context).managedSkillLayout?.packages).toEqual({});
    expect(readState(context).managedSkillLayout?.projections).toHaveProperty(projectionPath);

    fs.rmSync(path.join(repositoryPath, 'common', 'skills', 'review'), { recursive: true, force: true });
    const cleanupPlan = await createDeployPlan(context);
    expect(cleanupPlan.changes.some((change) =>
      change.deploymentKind === 'physical-materialization'
      && change.change === 'delete'
      && change.targetPath === storePackage)).toBe(false);
    expect(fs.readFileSync(storeFile, 'utf8')).toBe('# Review\n');
  });

  it('preserves an exact external Store link without taking package ownership', async () => {
    const manifestPath = path.join(repositoryPath, 'mcv.yaml');
    fs.writeFileSync(
      manifestPath,
      fs.readFileSync(manifestPath, 'utf8').replace('useSymlinks: false', 'useSymlinks: true'),
    );
    const externalPackage = path.join(homeDir, 'external-skills', 'review');
    const storePackage = path.join(homeDir, '.agents', 'skills', 'review');
    const projectionPath = path.join(homeDir, '.claude', 'skills', 'review');
    fs.mkdirSync(externalPackage, { recursive: true });
    fs.mkdirSync(path.dirname(storePackage), { recursive: true });
    fs.writeFileSync(path.join(externalPackage, 'SKILL.md'), '# Review\n');
    createDirectoryLink(externalPackage, storePackage);

    const plan = await createDeployPlan(context);

    expect(plan.readyToApply).toBe(true);
    expect(plan.changes.some((change) =>
      change.deploymentKind === 'physical-materialization')).toBe(false);
    expect(plan.changes).toContainEqual(expect.objectContaining({
      targetPath: projectionPath,
      deploymentKind: 'managed-link-projection',
    }));
    const result = await applyDeployPlan(
      context,
      plan,
      { changeIds: plan.changes.filter((change) => change.defaultSelected).map((change) => change.id) },
      { createSymbolicLink: createDirectoryLink },
    );
    expect(result.status).toBe('succeeded');
    expect(readState(context).managedSkillLayout?.packages).toEqual({});
    expect(fs.realpathSync(storePackage)).toBe(fs.realpathSync(externalPackage));
  });

  it('invalidates Deploy when an exact external Store package changes after Plan review', async () => {
    const manifestPath = path.join(repositoryPath, 'mcv.yaml');
    fs.writeFileSync(
      manifestPath,
      fs.readFileSync(manifestPath, 'utf8').replace('useSymlinks: false', 'useSymlinks: true'),
    );
    const storePackage = path.join(homeDir, '.agents', 'skills', 'review');
    const storeFile = path.join(storePackage, 'SKILL.md');
    const projectionPath = path.join(homeDir, '.claude', 'skills', 'review');
    fs.mkdirSync(storePackage, { recursive: true });
    fs.writeFileSync(storeFile, '# Review\n');
    const plan = await createDeployPlan(context);
    fs.writeFileSync(storeFile, '# Changed after review\n');

    const result = await applyDeployPlan(
      context,
      plan,
      { changeIds: plan.changes.filter((change) => change.defaultSelected).map((change) => change.id) },
      { createSymbolicLink: createDirectoryLink },
    );

    expect(result).toMatchObject({ status: 'failed', error: { code: 'operation.stalePlan' } });
    expect(fs.existsSync(projectionPath)).toBe(false);
    expect(fs.readFileSync(storeFile, 'utf8')).toBe('# Changed after review\n');
    expect(readState(context).managedSkillLayout).toBeUndefined();
  });

  it('invalidates Deploy when an exact external Store directory becomes a same-content link', async () => {
    const manifestPath = path.join(repositoryPath, 'mcv.yaml');
    fs.writeFileSync(
      manifestPath,
      fs.readFileSync(manifestPath, 'utf8').replace('useSymlinks: false', 'useSymlinks: true'),
    );
    const storePackage = path.join(homeDir, '.agents', 'skills', 'review');
    const storeFile = path.join(storePackage, 'SKILL.md');
    const externalPackage = path.join(homeDir, 'external-skills', 'review');
    const projectionPath = path.join(homeDir, '.claude', 'skills', 'review');
    fs.mkdirSync(storePackage, { recursive: true });
    fs.writeFileSync(storeFile, '# Review\n');
    const plan = await createDeployPlan(context);

    fs.mkdirSync(externalPackage, { recursive: true });
    fs.writeFileSync(path.join(externalPackage, 'SKILL.md'), '# Review\n');
    fs.rmSync(storePackage, { recursive: true });
    createDirectoryLink(externalPackage, storePackage);

    const result = await applyDeployPlan(
      context,
      plan,
      { changeIds: plan.changes.filter((change) => change.defaultSelected).map((change) => change.id) },
      { createSymbolicLink: createDirectoryLink },
    );

    expect(result).toMatchObject({ status: 'failed', error: { code: 'operation.stalePlan' } });
    expect(fs.existsSync(projectionPath)).toBe(false);
    expect(fs.realpathSync(storePackage)).toBe(fs.realpathSync(externalPackage));
    expect(readState(context).managedSkillLayout).toBeUndefined();
  });

  it('blocks a dangling unowned Store package link without creating projections', async () => {
    const manifestPath = path.join(repositoryPath, 'mcv.yaml');
    fs.writeFileSync(
      manifestPath,
      fs.readFileSync(manifestPath, 'utf8').replace('useSymlinks: false', 'useSymlinks: true'),
    );
    const externalPackage = path.join(homeDir, 'external-skills', 'review');
    const storePackage = path.join(homeDir, '.agents', 'skills', 'review');
    const projectionPath = path.join(homeDir, '.claude', 'skills', 'review');
    fs.mkdirSync(externalPackage, { recursive: true });
    fs.mkdirSync(path.dirname(storePackage), { recursive: true });
    fs.writeFileSync(path.join(externalPackage, 'SKILL.md'), '# Review\n');
    createDirectoryLink(externalPackage, storePackage);
    fs.rmSync(externalPackage, { recursive: true, force: true });

    const plan = await createDeployPlan(context);

    expect(plan.readyToApply).toBe(false);
    expect(plan.issues).toContainEqual(expect.objectContaining({
      code: 'deploy.skillsLayout.unownedStorePackage',
      severity: 'error',
    }));
    expect(plan.changes.some((change) => change.targetPath === projectionPath)).toBe(false);
    expect(fs.lstatSync(storePackage).isSymbolicLink()).toBe(true);
  });

  it('disabling one IDE cleans up only its projection while retaining the Store package', async () => {
    const manifestPath = path.join(repositoryPath, 'mcv.yaml');
    fs.writeFileSync(
      manifestPath,
      [
        'schemaVersion: 4',
        'repositoryId: deploy-operation-test',
        'initializedAt: 2026-07-22T00:00:00.000Z',
        'capture: { preserveUnknownNativeFields: true }',
        'deploy: { backupBeforeWrite: true, useSymlinks: true }',
        'targets:',
        '  claudeCode:',
        '    enabled: true',
        '  gemini:',
        '    enabled: true',
        'variables: {}',
        '',
      ].join('\n'),
    );
    const storePackage = path.join(homeDir, '.agents', 'skills', 'review');
    const claudeProjection = path.join(homeDir, '.claude', 'skills', 'review');
    const geminiProjection = path.join(homeDir, '.gemini', 'skills', 'review');
    const firstPlan = await createDeployPlan(context);
    await applyDeployPlan(context, firstPlan, {
      changeIds: firstPlan.changes.filter((change) => change.defaultSelected).map((change) => change.id),
    });
    expect(fs.lstatSync(claudeProjection).isSymbolicLink()).toBe(true);
    expect(fs.lstatSync(geminiProjection).isSymbolicLink()).toBe(true);

    fs.writeFileSync(
      manifestPath,
      fs.readFileSync(manifestPath, 'utf8').replace(
        '  claudeCode:\n    enabled: true',
        '  claudeCode:\n    enabled: false',
      ),
    );
    const disabledPlan = await createDeployPlan(context);
    const claudeDeletes = disabledPlan.changes.filter((change) =>
      change.change === 'delete' && change.targetPath.startsWith(path.join(homeDir, '.claude', 'skills', 'review')));
    const storeDeletes = disabledPlan.changes.filter((change) =>
      change.change === 'delete' && change.targetPath.startsWith(storePackage));
    expect(claudeDeletes.length).toBeGreaterThanOrEqual(1);
    expect(storeDeletes).toEqual([]);
    expect(disabledPlan.changes.some((change) =>
      change.targetPath === geminiProjection && change.change === 'delete')).toBe(false);
    expect(fs.existsSync(path.join(storePackage, 'SKILL.md'))).toBe(true);
  });

  it('offers the final physical package as a separate Advanced Cleanup candidate when all projections are gone', async () => {
    const manifestPath = path.join(repositoryPath, 'mcv.yaml');
    fs.writeFileSync(
      manifestPath,
      [
        'schemaVersion: 4',
        'repositoryId: deploy-operation-test',
        'initializedAt: 2026-07-22T00:00:00.000Z',
        'capture: { preserveUnknownNativeFields: true }',
        'deploy: { backupBeforeWrite: true, useSymlinks: true }',
        'targets:',
        '  claudeCode:',
        '    enabled: true',
        '  gemini:',
        '    enabled: true',
        'variables: {}',
        '',
      ].join('\n'),
    );
    const storePackage = path.join(homeDir, '.agents', 'skills', 'review');
    const claudeProjection = path.join(homeDir, '.claude', 'skills', 'review');
    const geminiProjection = path.join(homeDir, '.gemini', 'skills', 'review');
    const firstPlan = await createDeployPlan(context);
    await applyDeployPlan(context, firstPlan, {
      changeIds: firstPlan.changes.filter((change) => change.defaultSelected).map((change) => change.id),
    });
    expect(fs.lstatSync(claudeProjection).isSymbolicLink()).toBe(true);
    expect(fs.lstatSync(geminiProjection).isSymbolicLink()).toBe(true);

    fs.rmSync(path.join(repositoryPath, 'common', 'skills', 'review'), { recursive: true, force: true });
    const cleanupPlan = await createDeployPlan(context);
    const projectionDeletes = cleanupPlan.changes.filter((change) =>
      change.change === 'delete'
      && change.deploymentKind === 'managed-link-projection'
      && (change.targetPath === claudeProjection || change.targetPath === geminiProjection));
    const packageDeletes = cleanupPlan.changes.filter((change) =>
      change.change === 'delete'
      && change.deploymentKind === 'physical-materialization'
      && change.targetPath === storePackage);
    const storeFileDeletes = cleanupPlan.changes.filter((change) =>
      change.change === 'delete'
      && change.targetPath.startsWith(`${storePackage}${path.sep}`));

    expect(projectionDeletes).toHaveLength(2);
    expect(packageDeletes).toEqual([expect.objectContaining({
      owner: 'canonical-store',
      group: 'advanced',
      defaultSelected: false,
      deploymentKind: 'physical-materialization',
      name: 'review',
    })]);
    expect(storeFileDeletes).toEqual([]);
    expect(cleanupPlan.changes.some((change) =>
      change.change === 'delete'
      && change.defaultSelected)).toBe(false);
  });

  it('disabling Codex does not invalidate the Canonical Device Skill Store', async () => {
    const manifestPath = path.join(repositoryPath, 'mcv.yaml');
    fs.writeFileSync(
      manifestPath,
      [
        'schemaVersion: 4',
        'repositoryId: deploy-operation-test',
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
      ].join('\n'),
    );
    const storeFile = path.join(homeDir, '.agents', 'skills', 'review', 'SKILL.md');
    const projectionPath = path.join(homeDir, '.claude', 'skills', 'review');
    const plan = await createDeployPlan(context);
    await applyDeployPlan(context, plan, {
      changeIds: plan.changes.filter((change) => change.defaultSelected).map((change) => change.id),
    });

    fs.writeFileSync(
      manifestPath,
      fs.readFileSync(manifestPath, 'utf8').replace(
        '  codex:\n    enabled: true',
        '  codex:\n    enabled: false',
      ),
    );
    const after = await createDeployPlan(context);
    expect(after.changes.some((change) =>
      change.change === 'delete' && change.targetPath.startsWith(path.dirname(storeFile)))).toBe(false);
    expect(after.linkOutcomes).toEqual([expect.objectContaining({
      status: 'satisfied-via-link',
      ownership: 'managed',
      linkPath: projectionPath,
    })]);
    expect(fs.readFileSync(storeFile, 'utf8')).toBe('# Review\n');
  });

  it('rolls back writes when state update fails and does not claim uncommitted topology', async () => {
    const manifestPath = path.join(repositoryPath, 'mcv.yaml');
    fs.writeFileSync(
      manifestPath,
      fs.readFileSync(manifestPath, 'utf8').replace('useSymlinks: false', 'useSymlinks: true'),
    );
    const storeFile = path.join(homeDir, '.agents', 'skills', 'review', 'SKILL.md');
    const projectionPath = path.join(homeDir, '.claude', 'skills', 'review');
    const plan = await createDeployPlan(context);
    const selected = plan.changes.filter((change) => change.defaultSelected);

    const result = await applyDeployPlan(
      context,
      plan,
      { changeIds: selected.map((change) => change.id) },
      {
        createSymbolicLink: (target, linkPath) => {
          createDirectoryLink(target, linkPath);
        },
        updateState: () => { throw new Error('simulated state update failure'); },
      },
    );

    expect(result).toMatchObject({
      status: 'failed',
      error: {
        code: 'deploy.transactionFailed',
        technicalDetails: expect.stringContaining('simulated state update failure'),
      },
    });
    expect(fs.existsSync(storeFile)).toBe(false);
    expect(fs.existsSync(projectionPath)).toBe(false);
    expect(readState(context).managedSkillLayout).toBeUndefined();
    expect(readState(context).managedInventory?.[projectionPath]).toBeUndefined();
  });

  it('aggregates Pending Deployment Change totals for package materialization and projections', async () => {
    const manifestPath = path.join(repositoryPath, 'mcv.yaml');
    fs.writeFileSync(
      manifestPath,
      fs.readFileSync(manifestPath, 'utf8').replace('useSymlinks: false', 'useSymlinks: true'),
    );
    fs.mkdirSync(path.join(repositoryPath, 'common', 'skills', 'review', 'assets'), { recursive: true });
    fs.writeFileSync(path.join(repositoryPath, 'common', 'skills', 'review', 'assets', 'note.txt'), 'note\n');
    const plan = await createDeployPlan(context);
    const materializations = plan.changes.filter((change) =>
      change.deploymentKind === 'physical-materialization');
    const projections = plan.changes.filter((change) =>
      change.deploymentKind === 'managed-link-projection');
    expect(materializations.length).toBeGreaterThan(1);
    expect(projections.length).toBe(1);

    const status = await inspectStatus(context);
    expect(status.pendingDeployment).toMatchObject({
      total: 5,
      recommended: 5,
      optional: 0,
      advancedCleanupExcluded: 1,
    });
  });

  it('counts a multi-file copy projection as one pending Skill package action', async () => {
    const packageRoot = path.join(repositoryPath, 'common', 'skills', 'review');
    fs.mkdirSync(path.join(packageRoot, 'references'), { recursive: true });
    fs.writeFileSync(path.join(packageRoot, 'references', 'guide.md'), '# Guide\n');
    const plan = await createDeployPlan(context);
    const selectedChanges = plan.changes.filter((change) => change.defaultSelected);
    const reviewFiles = selectedChanges.filter((change) =>
      change.capability === 'skills' && change.name === 'review');
    expect(reviewFiles).toHaveLength(2);

    const status = await inspectStatus(context);

    expect(status.pendingDeployment.total).toBe(selectedChanges.length - 1);
  });


  it('rolls back materialized content when managed projection creation fails', async () => {
    const manifestPath = path.join(repositoryPath, 'mcv.yaml');
    fs.writeFileSync(
      manifestPath,
      fs.readFileSync(manifestPath, 'utf8').replace('useSymlinks: false', 'useSymlinks: true'),
    );
    const storeFile = path.join(homeDir, '.agents', 'skills', 'review', 'SKILL.md');
    const projectionPath = path.join(homeDir, '.claude', 'skills', 'review');
    fs.mkdirSync(path.dirname(storeFile), { recursive: true });
    fs.writeFileSync(storeFile, '# Previous review\n');
    writeState(context, {
      ...readState(context),
      managedSkillLayout: {
        packages: {
          [path.dirname(storeFile)]: {
            packageName: 'review',
            storePath: path.dirname(storeFile),
            contentHash: 'managed-before-test',
            source: repositoryPath,
          },
        },
        projections: {},
      },
    });
    const plan = await createDeployPlan(context);
    const selected = plan.changes.filter((change) => change.defaultSelected);

    const result = await applyDeployPlan(
      context,
      plan,
      { changeIds: selected.map((change) => change.id) },
      {
        createSymbolicLink: () => {
          throw new Error('simulated projection failure');
        },
      },
    );

    expect(result).toMatchObject({
      status: 'failed',
      error: { code: 'deploy.transactionFailed' },
    });
    expect(fs.readFileSync(storeFile, 'utf8')).toBe('# Previous review\n');
    expect(fs.existsSync(projectionPath)).toBe(false);
  });

  it.each([
    ['non-link node', (_target: string, linkPath: string) => fs.mkdirSync(linkPath)],
    ['wrong raw target', (target: string, linkPath: string) =>
      fs.symlinkSync(path.dirname(target), linkPath, 'dir')],
  ] as const)('rejects and rolls back a managed projection created as a %s', async (
    _scenario,
    createSymbolicLink,
  ) => {
    const manifestPath = path.join(repositoryPath, 'mcv.yaml');
    fs.writeFileSync(
      manifestPath,
      fs.readFileSync(manifestPath, 'utf8').replace('useSymlinks: false', 'useSymlinks: true'),
    );
    const storeRoot = path.join(homeDir, '.agents');
    const projectionPath = path.join(homeDir, '.claude', 'skills', 'review');
    const plan = await createDeployPlan(context);
    const selected = plan.changes.filter((change) => change.defaultSelected);

    const result = await applyDeployPlan(
      context,
      plan,
      { changeIds: selected.map((change) => change.id) },
      { createSymbolicLink },
    );

    expect(result).toMatchObject({
      status: 'failed',
      error: {
        code: 'deploy.transactionFailed',
        technicalDetails: expect.stringContaining('Deploy link verification failed'),
      },
    });
    expect(fs.existsSync(projectionPath)).toBe(false);
    expect(fs.existsSync(storeRoot)).toBe(false);
  });

  it('preserves an unowned projection node that wins the post-Plan creation race', async () => {
    const manifestPath = path.join(repositoryPath, 'mcv.yaml');
    fs.writeFileSync(
      manifestPath,
      fs.readFileSync(manifestPath, 'utf8').replace('useSymlinks: false', 'useSymlinks: true'),
    );
    const storeRoot = path.join(homeDir, '.agents');
    const projectionPath = path.join(homeDir, '.claude', 'skills', 'review');
    const markerPath = path.join(projectionPath, 'external.txt');
    const plan = await createDeployPlan(context);
    const selected = plan.changes.filter((change) => change.defaultSelected);

    const result = await applyDeployPlan(
      context,
      plan,
      { changeIds: selected.map((change) => change.id) },
      {
        createSymbolicLink: (_target, linkPath) => {
          fs.mkdirSync(linkPath);
          fs.writeFileSync(markerPath, 'externally owned\n');
          const error = new Error('simulated EEXIST') as NodeJS.ErrnoException;
          error.code = 'EEXIST';
          throw error;
        },
      },
    );

    expect(result).toMatchObject({
      status: 'failed',
      error: { code: 'deploy.transactionFailed' },
    });
    expect(fs.readFileSync(markerPath, 'utf8')).toBe('externally owned\n');
    expect(fs.existsSync(storeRoot)).toBe(false);
  });

  it('rejects selecting a managed projection without its pending Store materialization', async () => {
    const manifestPath = path.join(repositoryPath, 'mcv.yaml');
    fs.writeFileSync(
      manifestPath,
      fs.readFileSync(manifestPath, 'utf8').replace('useSymlinks: false', 'useSymlinks: true'),
    );
    const projectionPath = path.join(homeDir, '.claude', 'skills', 'review');
    const plan = await createDeployPlan(context);
    const projection = plan.changes.find((change) =>
      change.deploymentKind === 'managed-link-projection');
    if (!projection) throw new Error('expected managed projection');

    const result = await applyDeployPlan(context, plan, { changeIds: [projection.id] });

    expect(result).toMatchObject({
      status: 'failed',
      error: { code: 'deploy.invalidSelection' },
    });
    expect(fs.existsSync(projectionPath)).toBe(false);
    expect(fs.existsSync(path.join(homeDir, '.agents'))).toBe(false);
  });

  it('removes newly created Store topology when projection activation fails', async () => {
    const manifestPath = path.join(repositoryPath, 'mcv.yaml');
    fs.writeFileSync(
      manifestPath,
      fs.readFileSync(manifestPath, 'utf8').replace('useSymlinks: false', 'useSymlinks: true'),
    );
    const storeRoot = path.join(homeDir, '.agents');
    const plan = await createDeployPlan(context);
    const selected = plan.changes.filter((change) => change.defaultSelected);

    const result = await applyDeployPlan(
      context,
      plan,
      { changeIds: selected.map((change) => change.id) },
      { createSymbolicLink: () => { throw new Error('projection activation failed'); } },
    );

    expect(result).toMatchObject({ status: 'failed' });
    expect(fs.existsSync(storeRoot)).toBe(false);
  });

  it('rejects a reviewed Plan when the Claude Skills ancestor topology changes', async () => {
    const manifestPath = path.join(repositoryPath, 'mcv.yaml');
    fs.writeFileSync(
      manifestPath,
      fs.readFileSync(manifestPath, 'utf8').replace('useSymlinks: false', 'useSymlinks: true'),
    );
    const skillsRoot = path.join(homeDir, '.claude', 'skills');
    const movedRoot = path.join(homeDir, '.claude', 'skills-before-retarget');
    const plan = await createDeployPlan(context);
    fs.renameSync(skillsRoot, movedRoot);
    fs.mkdirSync(skillsRoot);

    const result = await applyDeployPlan(context, plan, {
      changeIds: plan.changes.filter((change) => change.defaultSelected).map((change) => change.id),
    });

    expect(result).toMatchObject({
      status: 'failed',
      error: { code: 'operation.stalePlan' },
    });
    expect(fs.existsSync(path.join(homeDir, '.agents'))).toBe(false);
  });

  it('rejects identical Store bytes under a replaced physical ancestor', async () => {
    const manifestPath = path.join(repositoryPath, 'mcv.yaml');
    fs.writeFileSync(
      manifestPath,
      fs.readFileSync(manifestPath, 'utf8').replace('useSymlinks: false', 'useSymlinks: true'),
    );
    const storeRoot = path.join(homeDir, '.agents');
    const storeFile = path.join(storeRoot, 'skills', 'review', 'SKILL.md');
    fs.mkdirSync(path.dirname(storeFile), { recursive: true });
    fs.writeFileSync(storeFile, '# Previous review\n');
    writeState(context, {
      ...readState(context),
      managedSkillLayout: {
        packages: {
          [path.dirname(storeFile)]: {
            packageName: 'review',
            storePath: path.dirname(storeFile),
            contentHash: 'managed-before-test',
            source: repositoryPath,
          },
        },
        projections: {},
      },
    });
    const plan = await createDeployPlan(context);
    fs.renameSync(storeRoot, path.join(homeDir, '.agents-before-retarget'));
    fs.mkdirSync(path.dirname(storeFile), { recursive: true });
    fs.writeFileSync(storeFile, '# Previous review\n');

    const result = await applyDeployPlan(context, plan, {
      changeIds: plan.changes.filter((change) => change.defaultSelected).map((change) => change.id),
    });

    expect(result).toMatchObject({
      status: 'failed',
      error: { code: 'operation.stalePlan' },
    });
    expect(fs.readFileSync(storeFile, 'utf8')).toBe('# Previous review\n');
  });

  it('falls back to copy projection when managed directory links are unsupported', async () => {
    const manifestPath = path.join(repositoryPath, 'mcv.yaml');
    fs.writeFileSync(
      manifestPath,
      fs.readFileSync(manifestPath, 'utf8').replace('useSymlinks: false', 'useSymlinks: true'),
    );
    context.platform = 'win32';
    writeState(context, {
      schemaVersion: 2,
      defaultRepositoryId: 'deploy-operation-test',
      repositoryPath,
    });

    const plan = await createDeployPlan(context);

    expect(plan.readyToApply).toBe(true);
    expect(plan.changes).toContainEqual(expect.objectContaining({
      targetPath: path.join(homeDir, '.claude', 'skills', 'review', 'SKILL.md'),
      deploymentKind: 'copy-projection',
    }));
    expect(plan.changes.some((change) =>
      change.deploymentKind === 'managed-link-projection'
      || change.deploymentKind === 'physical-materialization')).toBe(false);

  });

  it('uses the Store as Codex conventional Skills location without creating a Claude projection', async () => {
    const manifestPath = path.join(repositoryPath, 'mcv.yaml');
    fs.writeFileSync(
      manifestPath,
      fs.readFileSync(manifestPath, 'utf8')
        .replace('useSymlinks: false', 'useSymlinks: true')
        .replace('  claudeCode:', '  codex:\n    enabled: true\n  claudeCode:')
        .replace('  claudeCode:\n    enabled: true', '  claudeCode:\n    enabled: false'),
    );

    const plan = await createDeployPlan(context);

    expect(plan.changes).toContainEqual(expect.objectContaining({
      targetPath: path.join(homeDir, '.agents', 'skills', 'review', 'SKILL.md'),
      deploymentKind: 'physical-materialization',
    }));
    expect(plan.changes.some((change) =>
      change.deploymentKind === 'managed-link-projection')).toBe(false);
  });

  it('links Claude and Gemini CLI while Antigravity falls back to copy independently', async () => {
    const manifestPath = path.join(repositoryPath, 'mcv.yaml');
    fs.writeFileSync(
      manifestPath,
      [
        'schemaVersion: 4',
        'repositoryId: deploy-operation-test',
        'initializedAt: 2026-07-22T00:00:00.000Z',
        'capture: { preserveUnknownNativeFields: true }',
        'deploy: { backupBeforeWrite: true, useSymlinks: true }',
        'targets:',
        '  claudeCode:',
        '    enabled: true',
        '  gemini:',
        '    enabled: true',
        'variables: {}',
        '',
      ].join('\n'),
    );
    const storeFile = path.join(homeDir, '.agents', 'skills', 'review', 'SKILL.md');
    const claudeProjection = path.join(homeDir, '.claude', 'skills', 'review');
    const geminiCliProjection = path.join(homeDir, '.gemini', 'skills', 'review');
    const antigravityCopy = path.join(homeDir, '.gemini', 'config', 'skills', 'review', 'SKILL.md');
    const plan = await createDeployPlan(context);

    expect(plan.readyToApply).toBe(true);
    expect(plan.changes.filter((change) => change.capability === 'skills')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          owner: 'canonical-store',
          targetPath: storeFile,
          deploymentKind: 'physical-materialization',
        }),
        expect.objectContaining({
          ide: 'claude-code',
          surface: 'claude-code',
          targetPath: claudeProjection,
          deploymentKind: 'managed-link-projection',
        }),
        expect.objectContaining({
          ide: 'gemini',
          surface: 'gemini-cli',
          targetPath: geminiCliProjection,
          deploymentKind: 'managed-link-projection',
        }),
        expect.objectContaining({
          ide: 'gemini',
          surface: 'antigravity',
          targetPath: antigravityCopy,
          deploymentKind: 'copy-projection',
        }),
      ]),
    );

    const selected = plan.changes.filter((change) => change.defaultSelected);
    const result = await applyDeployPlan(context, plan, {
      changeIds: selected.map((change) => change.id),
    });

    expect(result).toMatchObject({ status: 'succeeded' });
    expect(fs.readFileSync(storeFile, 'utf8')).toBe('# Review\n');
    expect(fs.lstatSync(claudeProjection).isSymbolicLink()).toBe(true);
    expect(fs.lstatSync(geminiCliProjection).isSymbolicLink()).toBe(true);
    expect(fs.realpathSync(claudeProjection)).toBe(fs.realpathSync(path.dirname(storeFile)));
    expect(fs.realpathSync(geminiCliProjection)).toBe(fs.realpathSync(path.dirname(storeFile)));
    expect(fs.lstatSync(path.dirname(antigravityCopy)).isSymbolicLink()).toBe(false);
    expect(fs.readFileSync(antigravityCopy, 'utf8')).toBe('# Review\n');
  });

  it('keeps Windows Gemini Surfaces on copy when useSymlinks is enabled', async () => {
    const manifestPath = path.join(repositoryPath, 'mcv.yaml');
    fs.writeFileSync(
      manifestPath,
      [
        'schemaVersion: 4',
        'repositoryId: deploy-operation-test',
        'initializedAt: 2026-07-22T00:00:00.000Z',
        'capture: { preserveUnknownNativeFields: true }',
        'deploy: { backupBeforeWrite: true, useSymlinks: true }',
        'targets:',
        '  claudeCode:',
        '    enabled: true',
        '  gemini:',
        '    enabled: true',
        'variables: {}',
        '',
      ].join('\n'),
    );
    context.platform = 'win32';
    writeState(context, {
      schemaVersion: 2,
      defaultRepositoryId: 'deploy-operation-test',
      repositoryPath,
    });

    const plan = await createDeployPlan(context);

    expect(plan.readyToApply).toBe(true);
    expect(plan.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        ide: 'claude-code',
        surface: 'claude-code',
        targetPath: path.join(homeDir, '.claude', 'skills', 'review', 'SKILL.md'),
        deploymentKind: 'copy-projection',
      }),
      expect.objectContaining({
        ide: 'gemini',
        surface: 'gemini-cli',
        targetPath: path.join(homeDir, '.gemini', 'skills', 'review', 'SKILL.md'),
        deploymentKind: 'copy-projection',
      }),
      expect.objectContaining({
        ide: 'gemini',
        surface: 'antigravity',
        targetPath: path.join(homeDir, '.gemini', 'config', 'skills', 'review', 'SKILL.md'),
        deploymentKind: 'copy-projection',
      }),
    ]));
    expect(plan.changes.some((change) =>
      change.deploymentKind === 'managed-link-projection'
      || change.deploymentKind === 'physical-materialization')).toBe(false);

    const result = await applyDeployPlan(context, plan, {
      changeIds: plan.changes.filter((change) => change.defaultSelected).map((change) => change.id),
    });
    expect(result.status).toBe('succeeded');
    const json = JSON.parse(JSON.stringify(result)) as typeof result;
    expect(json.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        ide: 'gemini',
        surface: 'gemini-cli',
        targetPath: path.join(homeDir, '.gemini', 'skills', 'review', 'SKILL.md'),
      }),
      expect.objectContaining({
        ide: 'gemini',
        surface: 'antigravity',
        targetPath: path.join(homeDir, '.gemini', 'config', 'skills', 'review', 'SKILL.md'),
      }),
    ]));
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
      [targetPath]: { source: repositoryPath, hash: expect.any(String), scope: 'global' },
    }));
    expect(state.managedInventory).not.toHaveProperty(path.join(homeDir, '.claude', 'CLAUDE.md'));
    expect(state.lastDeploySelection).toEqual({ 'claude-code': ['native'] });
  });
});

function createDirectoryLink(target: string, linkPath: string): void {
  fs.symlinkSync(target, linkPath, process.platform === 'win32' ? 'junction' : 'dir');
}

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
