import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProgram } from '../index.js';
import { seedGlobalProfileWithCatalog } from '../operations/deploy-request-helpers.js';

describe('mcv status', () => {
  let testRoot: string;
  let repositoryPath: string;
  let stateRoot: string;

  beforeEach(() => {
    testRoot = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'mcv-status-test-'));
    repositoryPath = path.join(testRoot, 'repository');
    stateRoot = path.join(testRoot, 'device');
    fs.mkdirSync(repositoryPath);
    fs.writeFileSync(path.join(repositoryPath, 'mcv.yaml'), [
      'schemaVersion: 4',
      'repositoryId: repository-id',
      'initializedAt: 2026-07-19T00:00:00.000Z',
      'targets:',
      '  codex:',
      '    enabled: false',
      '  claudeCode:',
      '    enabled: false',
      '  gemini:',
      '    enabled: false',
      '    surfaces:',
      '      geminiCli: auto',
      '      antigravity: auto',
      'variables: {}',
      'capture:',
      '  preserveUnknownNativeFields: true',
      'deploy:',
      '  backupBeforeWrite: true',
      '  useSymlinks: false',
      '',
    ].join('\n'));
    seedGlobalProfileWithCatalog(repositoryPath);
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(testRoot, { recursive: true, force: true });
  });

  it('renders a one-shot plain Overview from the structured Status Report', async () => {
    const matchingPath = path.join(testRoot, 'matching.txt');
    const missingPath = path.join(testRoot, 'missing.txt');
    const driftedPath = path.join(testRoot, 'drifted.txt');
    fs.writeFileSync(matchingPath, 'abc');
    fs.writeFileSync(driftedPath, 'changed');
    writeDeviceState({
      baselineSnapshot: {
        recordedAt: '2026-07-19T00:00:00.000Z',
        files: {
          [matchingPath]: sha256('abc'),
          [missingPath]: 'expected-hash',
          [driftedPath]: 'expected-hash',
        },
      },
      lastOperation: {
        kind: 'deploy',
        time: '2026-07-19T01:00:00.000Z',
        success: false,
      },
    });

    await program().parseAsync(['node', 'mcv', 'status', '--plain']);

    expect(vi.mocked(console.log).mock.calls.map(([line]) => line)).toEqual([
      'MCV configuration overview',
      '',
      `Repository  ${repositoryPath}`,
      'Identity    repository-id · schema 4',
      '',
      '✓ No pending deployment changes',
      '',
      'Skills      No linked packages',
      '',
      'Device      × 1 drifted · 1 missing · 1 unchanged',
      '  1 missing-file drift',
      '',
      'Environment ✓ No missing variables',
      'IDEs        0 enabled · 0 detected',
      '  · Codex · disabled, not detected',
      '  · Claude Code · disabled, not detected',
      '  · Gemini · disabled, not detected',
      '    gemini-cli · antigravity absent',
      '',
      'Last        × deploy failed · 2026-07-19T01:00:00.000Z',
      '',
    ]);
  });

  it('collapses healthy linked Skills consistently and reveals exact topology with --verbose', async () => {
    const manifestPath = path.join(repositoryPath, 'mcv.yaml');
    fs.writeFileSync(
      manifestPath,
      fs.readFileSync(manifestPath, 'utf8').replace('  codex:\n    enabled: false', '  codex:\n    enabled: true'),
    );
    const sourceSkill = path.join(repositoryPath, 'common', 'skills', 'review', 'SKILL.md');
    const externalSkill = path.join(testRoot, 'external-skills', 'review', 'SKILL.md');
    const linkedRoot = path.join(stateRoot, '.agents', 'skills');
    fs.mkdirSync(path.dirname(sourceSkill), { recursive: true });
    fs.mkdirSync(path.dirname(externalSkill), { recursive: true });
    fs.mkdirSync(path.dirname(linkedRoot), { recursive: true });
    fs.writeFileSync(sourceSkill, '# Review\n');
    fs.writeFileSync(externalSkill, '# Review\n');
    fs.symlinkSync(path.dirname(path.dirname(externalSkill)), linkedRoot, process.platform === 'win32' ? 'junction' : 'dir');
    seedGlobalProfileWithCatalog(repositoryPath);
    writeDeviceState({});

    await program().parseAsync(['node', 'mcv', 'status', '--plain']);
    const plain = vi.mocked(console.log).mock.calls.flat().join('\n');
    expect(plain).toContain(
      'Skills      ✓ 1 linked package healthy',
    );
    expect(plain).toContain('Coverage  Codex 1');
    expect(plain).not.toContain('✓ review · Codex · Already matches');
    expect(plain).not.toContain(externalSkill);

    vi.mocked(console.log).mockClear();
    await program().parseAsync(['node', 'mcv', 'status', '--verbose']);
    const verbose = vi.mocked(console.log).mock.calls.flat().join('\n');
    expect(verbose).toContain('✓ review · Codex · Already matches');
    expect(verbose).toContain(linkedRoot);
    expect(verbose).toContain(path.dirname(path.dirname(externalSkill)));
    expect(verbose).toContain('1 expected file placement verified');
  });

  it('prints the same Overview as one machine-readable Status Report', async () => {
    writeDeviceState({});

    await program().parseAsync(['node', 'mcv', 'status', '--json']);

    expect(console.log).toHaveBeenCalledOnce();
    const report = JSON.parse(String(vi.mocked(console.log).mock.calls[0]?.[0]));
    expect(report).toMatchObject({
      schemaVersion: 3,
      operation: 'status',
      status: 'reported',
      ready: true,
      repositoryPath,
      repository: { path: repositoryPath, id: 'repository-id', schemaVersion: 4 },
      pendingDeployment: {
        add: 0,
        modify: 0,
        delete: 0,
        total: 0,
        recommended: 0,
        optional: 0,
        advancedCleanupExcluded: 0,
      },
      postDeployLocalState: {
        unchanged: 0,
        drift: 0,
        contentDrift: 0,
        topologyDrift: 0,
        missing: 0,
        total: 0,
        contentDrifts: [],
        topologyDrifts: [],
      },
      environment: { missingVariables: [], ideSupport: expect.any(Array) },
      lastOperation: null,
      issues: expect.arrayContaining([
        expect.objectContaining({ code: 'deploy.noEnabledTargets' }),
      ]),
    });
    expect(String(vi.mocked(console.log).mock.calls[0]?.[0])).not.toMatch(/\u001b\[/);
  });

  it('keeps status JSON summary-sized when the Deploy Plan contains file previews', async () => {
    const manifestPath = path.join(repositoryPath, 'mcv.yaml');
    fs.writeFileSync(
      manifestPath,
      fs.readFileSync(manifestPath, 'utf8').replace('  codex:\n    enabled: false', '  codex:\n    enabled: true'),
    );
    fs.mkdirSync(path.join(repositoryPath, 'common'), { recursive: true });
    fs.writeFileSync(path.join(repositoryPath, 'common', 'AGENTS.md'), `# Rules\n${'detail\n'.repeat(2_000)}`);
    seedGlobalProfileWithCatalog(repositoryPath);
    writeDeviceState({});

    await program().parseAsync(['node', 'mcv', 'status', '--json']);

    const output = String(vi.mocked(console.log).mock.calls.at(-1)?.[0]);
    const report = JSON.parse(output);
    expect(report).not.toHaveProperty('changes');
    expect(report.pendingDeployment.total).toBeGreaterThan(0);
    expect(output).not.toContain('detail');
    expect(output.length).toBeLessThan(20_000);
  });

  it('rejects conflicting plain and JSON output modes', async () => {
    writeDeviceState({});
    const cli = program();
    const statusCommand = cli.commands.find((command) => command.name() === 'status');
    statusCommand?.configureOutput({ writeErr: () => {} }).exitOverride();

    await expect(
      cli.parseAsync(['node', 'mcv', 'status', '--plain', '--json']),
    ).rejects.toMatchObject({ exitCode: 2 });
  });

  function program() {
    return createProgram({
      homeDir: stateRoot,
      platform: 'win32',
      env: { APPDATA: stateRoot },
      pathEnv: '',
    });
  }

  function writeDeviceState(extra: Record<string, unknown>): void {
    fs.mkdirSync(path.join(stateRoot, 'mcv'), { recursive: true });
    fs.writeFileSync(path.join(stateRoot, 'mcv', 'config.json'), JSON.stringify({
      schemaVersion: 3,
      defaultRepositoryId: 'repository-id',
      repositoryPath,
      ...extra,
    }));
  }
});

function sha256(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}
