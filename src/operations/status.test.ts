import * as crypto from 'crypto';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DeviceContext } from '../adapters/types.js';
import { hashDeviceTopologyNode } from '../core/canonical-skill-device-layout.js';
import { hashSkillPackageContent } from '../core/managed-skill-layout.js';
import { writeState } from '../utils/state.js';
import { inspectStatus } from './status.js';

describe('inspectStatus', () => {
  let testRoot: string;
  let homeDir: string;
  let repositoryPath: string;
  let context: DeviceContext;

  beforeEach(() => {
    testRoot = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'mcv-status-operation-'));
    homeDir = path.join(testRoot, 'home');
    repositoryPath = path.join(testRoot, 'repository');
    fs.mkdirSync(homeDir);
    fs.mkdirSync(repositoryPath);
    context = {
      homeDir,
      platform: 'win32',
      env: { APPDATA: homeDir },
      pathEnv: '',
    };
  });

  afterEach(() => {
    fs.rmSync(testRoot, { recursive: true, force: true });
  });

  it('returns one read-only Overview Report with distinct deployment and local-state summaries', async () => {
    createRepository(repositoryPath);
    const rulesPath = path.join(homeDir, '.codex', 'AGENTS.md');
    const newSkillPath = path.join(repositoryPath, 'common', 'skills', 'new-skill', 'SKILL.md');
    const staleSkillPath = path.join(homeDir, '.agents', 'skills', 'old-skill', 'SKILL.md');
    fs.mkdirSync(path.dirname(rulesPath), { recursive: true });
    fs.mkdirSync(path.dirname(newSkillPath), { recursive: true });
    fs.mkdirSync(path.dirname(staleSkillPath), { recursive: true });
    fs.writeFileSync(rulesPath, '# Local rules\n');
    fs.writeFileSync(newSkillPath, '---\nname: new-skill\n---\n${env:MISSING_TOKEN}\n');
    fs.writeFileSync(staleSkillPath, '# Stale skill\n');

    const unchangedPath = path.join(homeDir, 'unchanged.txt');
    const driftPath = path.join(homeDir, 'drift.txt');
    const missingPath = path.join(homeDir, 'missing.txt');
    fs.writeFileSync(unchangedPath, 'unchanged');
    fs.writeFileSync(driftPath, 'changed locally');
    writeState(context, {
      schemaVersion: 2,
      defaultRepositoryId: 'repository-id',
      repositoryPath,
      managedInventory: {
        [staleSkillPath]: { source: repositoryPath, hash: sha256('# Stale skill\n') },
      },
      baselineSnapshot: {
        recordedAt: '2026-07-21T00:00:00.000Z',
        files: {
          [unchangedPath]: sha256('unchanged'),
          [driftPath]: sha256('deployed version'),
          [missingPath]: sha256('missing'),
        },
      },
      lastOperation: {
        kind: 'deploy',
        time: '2026-07-21T01:02:03.000Z',
        success: false,
      },
    });
    const before = snapshotFiles(testRoot);

    const report = await inspectStatus(context);

    expect(report).toMatchObject({
      schemaVersion: 1,
      operation: 'status',
      status: 'reported',
      ready: true,
      repositoryPath,
      repository: {
        id: 'repository-id',
        schemaVersion: 2,
      },
      pendingDeployment: { add: 1, modify: 1, delete: 1, total: 3 },
      postDeployLocalState: {
        unchanged: 1,
        drift: 1,
        contentDrift: 0,
        topologyDrift: 0,
        missing: 1,
        total: 3,
      },
      environment: {
        missingVariables: ['MISSING_TOKEN'],
        ideSupport: [
          expect.objectContaining({ id: 'codex', enabled: true, detected: true }),
          expect.objectContaining({ id: 'claude-code', enabled: false }),
          expect.objectContaining({
            id: 'gemini',
            enabled: false,
            surfaces: expect.arrayContaining([
              expect.objectContaining({ id: 'gemini-cli', detected: false }),
              expect.objectContaining({ id: 'antigravity', detected: false }),
            ]),
          }),
        ],
      },
      lastOperation: {
        kind: 'deploy',
        time: '2026-07-21T01:02:03.000Z',
        success: false,
      },
      linkOutcomes: [],
      issues: [],
      nextActions: [],
    });
    expect(report.repository).not.toHaveProperty('git');
    expect(report.changes).toHaveLength(3);
    expect(snapshotFiles(testRoot)).toEqual(before);
  });

  it('includes Git status when the MCV Repository is inside a Git worktree', async () => {
    createRepository(repositoryPath, false);
    writeState(context, {
      schemaVersion: 2,
      defaultRepositoryId: 'repository-id',
      repositoryPath,
    });
    execFileSync('git', ['init'], { cwd: testRoot, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.name', 'MCV Test'], { cwd: testRoot });
    execFileSync('git', ['config', 'user.email', 'mcv@example.invalid'], { cwd: testRoot });
    execFileSync('git', ['add', '.'], { cwd: testRoot });
    execFileSync('git', ['commit', '-m', 'fixture'], { cwd: testRoot, stdio: 'ignore' });

    const clean = await inspectStatus(context);
    expect(clean.repository.git).toMatchObject({ clean: true, uncommittedChanges: 0 });

    fs.writeFileSync(path.join(testRoot, 'untracked.txt'), 'dirty');
    const dirty = await inspectStatus(context);
    expect(dirty.repository.git).toMatchObject({ clean: false, uncommittedChanges: 1 });
  });

  it('keeps satisfied linked Skill packages out of Pending Deployment Changes', async () => {
    createRepository(repositoryPath);
    const sourceSkill = path.join(repositoryPath, 'common', 'skills', 'review', 'SKILL.md');
    const linkedRoot = path.join(homeDir, '.agents', 'skills');
    const externalRoot = path.join(testRoot, 'external-skills');
    const externalSkill = path.join(externalRoot, 'review', 'SKILL.md');
    fs.mkdirSync(path.dirname(sourceSkill), { recursive: true });
    fs.mkdirSync(path.dirname(externalSkill), { recursive: true });
    fs.mkdirSync(path.dirname(linkedRoot), { recursive: true });
    fs.writeFileSync(sourceSkill, '# Review\n');
    fs.writeFileSync(externalSkill, '# Review\n');
    fs.symlinkSync(externalRoot, linkedRoot, process.platform === 'win32' ? 'junction' : 'dir');
    writeState(context, {
      schemaVersion: 2,
      defaultRepositoryId: 'repository-id',
      repositoryPath,
    });

    const report = await inspectStatus(context);

    expect(report.linkOutcomes).toEqual([expect.objectContaining({
      status: 'satisfied-via-link',
      ownership: 'external',
      ide: 'codex',
      surface: 'codex',
      linkPath: linkedRoot,
      resolvedPath: externalRoot,
      packageNames: ['review'],
      affectedFileCount: 1,
    })]);
    expect(report.changes.some((change) => change.capability === 'skills')).toBe(false);
    expect(report.pendingDeployment.total).toBe(report.changes.length);
    expect(report.issues).toContainEqual(expect.objectContaining({
      severity: 'notice',
      message: expect.stringContaining('Satisfied via link'),
    }));
  });

  it('reports one Canonical package content Drift when managed alias content changes', async () => {
    if (process.platform === 'win32') return;
    context.platform = 'darwin';
    seedManagedSkillRepository(repositoryPath, homeDir, context);
    const { applyDeployPlan, createDeployPlan } = await import('./deploy.js');
    const plan = await createDeployPlan(context);
    const selected = plan.changes.filter((change) => change.defaultSelected);
    const result = await applyDeployPlan(context, plan, {
      changeIds: selected.map((change) => change.id),
    });
    expect(result.status).toBe('succeeded');

    const projectionPath = path.join(homeDir, '.claude', 'skills', 'review');
    fs.writeFileSync(path.join(projectionPath, 'SKILL.md'), '# Edited through alias\n');

    const report = await inspectStatus(context);

    expect(report.postDeployLocalState.contentDrift).toBe(1);
    expect(report.postDeployLocalState.topologyDrift).toBe(0);
    expect(report.postDeployLocalState.contentDrifts).toEqual([expect.objectContaining({
      kind: 'canonical-skill-package',
      packageName: 'review',
      state: 'drift',
    })]);
    expect(report.postDeployLocalState.topologyDrifts).toEqual([]);
    expect(report.postDeployLocalState.drift).toBe(1);
    expect(report.linkOutcomes).toEqual([expect.objectContaining({
      status: 'satisfied-via-link',
      ownership: 'managed',
      ide: 'claude-code',
      surface: 'claude-code',
      linkPath: projectionPath,
    })]);
    expect(report.pendingDeployment.total).toBeGreaterThanOrEqual(1);
    expect(report.changes.filter((change) =>
      change.deploymentKind === 'physical-materialization')).toHaveLength(1);
  });

  it('reports topology Drift with IDE and Surface when a managed projection is replaced or retargeted', async () => {
    if (process.platform === 'win32') return;
    context.platform = 'darwin';
    seedManagedSkillRepository(repositoryPath, homeDir, context);
    const { applyDeployPlan, createDeployPlan } = await import('./deploy.js');
    const plan = await createDeployPlan(context);
    await applyDeployPlan(context, plan, {
      changeIds: plan.changes.filter((change) => change.defaultSelected).map((change) => change.id),
    });

    const projectionPath = path.join(homeDir, '.claude', 'skills', 'review');
    const storePackage = path.join(homeDir, '.agents', 'skills', 'review');
    fs.rmSync(projectionPath, { recursive: true, force: true });
    fs.mkdirSync(projectionPath, { recursive: true });
    fs.writeFileSync(path.join(projectionPath, 'SKILL.md'), '# Review\n');

    const replaced = await inspectStatus(context);
    expect(replaced.postDeployLocalState.topologyDrift).toBe(1);
    expect(replaced.postDeployLocalState.contentDrift).toBe(0);
    expect(replaced.postDeployLocalState.topologyDrifts).toEqual([expect.objectContaining({
      kind: 'skill-projection',
      packageName: 'review',
      projectionPath,
      ide: 'claude-code',
      surface: 'claude-code',
      reason: 'replaced',
    })]);

    fs.rmSync(projectionPath, { recursive: true, force: true });
    const externalPackage = path.join(testRoot, 'external-review');
    fs.mkdirSync(externalPackage, { recursive: true });
    fs.writeFileSync(path.join(externalPackage, 'SKILL.md'), '# Review\n');
    fs.symlinkSync(externalPackage, projectionPath, 'dir');

    const retargeted = await inspectStatus(context);
    expect(retargeted.postDeployLocalState.topologyDrifts).toEqual([expect.objectContaining({
      reason: 'external',
      ide: 'claude-code',
      surface: 'claude-code',
      packageName: 'review',
    })]);
    expect(fs.realpathSync(storePackage)).not.toBe(fs.realpathSync(projectionPath));
  });

  it('reads older state without topology metadata without inventing deletion candidates for unowned files', async () => {
    createRepository(repositoryPath);
    const owned = path.join(homeDir, '.codex', 'AGENTS.md');
    const unowned = path.join(homeDir, '.codex', 'unowned.txt');
    fs.mkdirSync(path.dirname(owned), { recursive: true });
    fs.writeFileSync(owned, '# Local rules\n');
    fs.writeFileSync(unowned, 'leave me alone\n');
    writeState(context, {
      schemaVersion: 2,
      defaultRepositoryId: 'repository-id',
      repositoryPath,
      managedInventory: {
        [owned]: { source: repositoryPath, hash: sha256('# Repository rules\n') },
      },
      baselineSnapshot: {
        recordedAt: '2026-07-21T00:00:00.000Z',
        files: {
          [owned]: sha256('# Repository rules\n'),
        },
      },
    });

    const report = await inspectStatus(context);

    expect(report.postDeployLocalState).toMatchObject({
      contentDrift: 0,
      topologyDrift: 0,
      drift: 1,
      missing: 0,
    });
    expect(report.changes.some((change) => change.targetPath === unowned)).toBe(false);
    expect(fs.readFileSync(unowned, 'utf8')).toBe('leave me alone\n');
  });
  it('reports topology Drift when a managed projection is missing', async () => {
    if (process.platform === 'win32') return;
    context.platform = 'darwin';
    seedManagedSkillRepository(repositoryPath, homeDir, context);
    const { applyDeployPlan, createDeployPlan } = await import('./deploy.js');
    const plan = await createDeployPlan(context);
    await applyDeployPlan(context, plan, {
      changeIds: plan.changes.filter((change) => change.defaultSelected).map((change) => change.id),
    });

    const projectionPath = path.join(homeDir, '.claude', 'skills', 'review');
    fs.rmSync(projectionPath, { recursive: true, force: true });

    const report = await inspectStatus(context);
    expect(report.postDeployLocalState.topologyDrifts).toEqual([expect.objectContaining({
      reason: 'missing',
      ide: 'claude-code',
      surface: 'claude-code',
      packageName: 'review',
    })]);
    expect(report.postDeployLocalState.contentDrift).toBe(0);
  });

  it('reports a missing managed Store package as content Drift instead of unchanged', async () => {
    createRepository(repositoryPath);
    const storePackage = path.join(homeDir, '.agents', 'skills', 'review');
    writeState(context, {
      schemaVersion: 2,
      defaultRepositoryId: 'repository-id',
      repositoryPath,
      managedSkillLayout: {
        packages: {
          [storePackage]: {
            packageName: 'review',
            storePath: storePackage,
            contentHash: 'deployed-package-hash',
            source: repositoryPath,
          },
        },
        projections: {},
      },
    });

    const report = await inspectStatus(context);

    expect(report.postDeployLocalState).toMatchObject({
      unchanged: 0,
      drift: 1,
      contentDrift: 1,
      topologyDrift: 0,
      missing: 0,
      contentDrifts: [expect.objectContaining({
        kind: 'canonical-skill-package',
        packageName: 'review',
        storePath: storePackage,
        state: 'drift',
      })],
    });
  });

  it('reports a managed Store package replaced by a same-content link as topology Drift', async () => {
    createRepository(repositoryPath);
    const storePackage = path.join(homeDir, '.agents', 'skills', 'review');
    const externalPackage = path.join(homeDir, 'external-skills', 'review');
    fs.mkdirSync(storePackage, { recursive: true });
    fs.writeFileSync(path.join(storePackage, 'SKILL.md'), '# Review\n');
    const contentHash = hashSkillPackageContent(storePackage);
    const topologyHash = hashDeviceTopologyNode(storePackage);
    writeState(context, {
      schemaVersion: 2,
      defaultRepositoryId: 'repository-id',
      repositoryPath,
      managedSkillLayout: {
        packages: {
          [storePackage]: {
            packageName: 'review',
            storePath: storePackage,
            contentHash,
            topologyHash,
            source: repositoryPath,
          },
        },
        projections: {},
      },
    });
    fs.mkdirSync(externalPackage, { recursive: true });
    fs.writeFileSync(path.join(externalPackage, 'SKILL.md'), '# Review\n');
    fs.rmSync(storePackage, { recursive: true });
    fs.symlinkSync(externalPackage, storePackage, process.platform === 'win32' ? 'junction' : 'dir');

    const report = await inspectStatus(context);

    expect(report.postDeployLocalState).toMatchObject({
      unchanged: 0,
      drift: 1,
      contentDrift: 0,
      topologyDrift: 1,
      missing: 0,
      topologyDrifts: [expect.objectContaining({
        kind: 'canonical-skill-package',
        packageName: 'review',
        storePath: storePackage,
        reason: 'replaced',
      })],
    });
  });

  it('reports Gemini Skill changes under one IDE and distinct Surfaces', async () => {
    createRepository(repositoryPath, false);
    const manifestPath = path.join(repositoryPath, 'mcv.yaml');
    fs.writeFileSync(
      manifestPath,
      fs.readFileSync(manifestPath, 'utf8').replace('  gemini:\n    enabled: false', '  gemini:\n    enabled: true'),
    );
    const skillPath = path.join(repositoryPath, 'common', 'skills', 'review', 'SKILL.md');
    fs.mkdirSync(path.dirname(skillPath), { recursive: true });
    fs.writeFileSync(skillPath, '# Review\n');
    writeState(context, {
      schemaVersion: 2,
      defaultRepositoryId: 'repository-id',
      repositoryPath,
    });

    const report = await inspectStatus(context);
    const skillChanges = report.changes.filter((change) => change.capability === 'skills');

    expect(skillChanges).toEqual(expect.arrayContaining([
      expect.objectContaining({ ide: 'gemini', surface: 'gemini-cli' }),
      expect.objectContaining({ ide: 'gemini', surface: 'antigravity' }),
    ]));
    expect(JSON.stringify(skillChanges)).not.toContain('"ide":"gemini-cli"');
    expect(JSON.stringify(skillChanges)).not.toContain('"ide":"antigravity"');
  });
});

function seedManagedSkillRepository(
  repositoryPath: string,
  homeDir: string,
  context: DeviceContext,
): void {
  fs.writeFileSync(path.join(repositoryPath, 'mcv.yaml'), [
    'schemaVersion: 2',
    'repositoryId: repository-id',
    'initializedAt: 2026-07-21T00:00:00.000Z',
    'targets:',
    '  codex:',
    '    enabled: false',
    '  claudeCode:',
    '    enabled: true',
    '  gemini:',
    '    enabled: false',
    '    surfaces:',
    '      geminiCli: auto',
    '      antigravity: auto',
    'variables: {}',
    'security:',
    '  scanSecrets: true',
    '  allowPlaintextSecrets: false',
    'capture:',
    '  preserveUnknownNativeFields: true',
    'deploy:',
    '  backupBeforeWrite: true',
    '  useSymlinks: true',
    '',
  ].join('\n'));
  fs.mkdirSync(path.join(repositoryPath, 'common', 'skills', 'review'), { recursive: true });
  fs.mkdirSync(path.join(homeDir, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(repositoryPath, 'common', 'AGENTS.md'), '# Repository rules\n');
  fs.writeFileSync(path.join(repositoryPath, 'common', 'skills', 'review', 'SKILL.md'), '# Review\n');
  writeState(context, {
    schemaVersion: 2,
    defaultRepositoryId: 'repository-id',
    repositoryPath,
  });
}

function createRepository(repositoryPath: string, codexEnabled = true): void {
  fs.writeFileSync(path.join(repositoryPath, 'mcv.yaml'), [
    'schemaVersion: 2',
    'repositoryId: repository-id',
    'initializedAt: 2026-07-21T00:00:00.000Z',
    'targets:',
    '  codex:',
    `    enabled: ${codexEnabled}`,
    '  claudeCode:',
    '    enabled: false',
    '  gemini:',
    '    enabled: false',
    '    surfaces:',
    '      geminiCli: auto',
    '      antigravity: auto',
    'variables: {}',
    'security:',
    '  scanSecrets: true',
    '  allowPlaintextSecrets: false',
    'capture:',
    '  preserveUnknownNativeFields: true',
    'deploy:',
    '  backupBeforeWrite: true',
    '  useSymlinks: false',
    '',
  ].join('\n'));
  fs.mkdirSync(path.join(repositoryPath, 'common'), { recursive: true });
  fs.writeFileSync(path.join(repositoryPath, 'common', 'AGENTS.md'), '# Repository rules\n');
}

function sha256(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function snapshotFiles(root: string): Record<string, string> {
  const result: Record<string, string> = {};
  const visit = (directory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(entryPath);
      else if (entry.isFile()) result[path.relative(root, entryPath)] = fs.readFileSync(entryPath, 'base64');
    }
  };
  visit(root);
  return result;
}
