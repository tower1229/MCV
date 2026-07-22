import * as crypto from 'crypto';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DeviceContext } from '../adapters/types';
import { writeState } from '../utils/state';
import { inspectStatus } from './status';

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
      postDeployLocalState: { unchanged: 1, drift: 1, missing: 1, total: 3 },
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
});

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
