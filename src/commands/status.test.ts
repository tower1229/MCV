import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProgram } from '../index';

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
      'schemaVersion: 2',
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
      `Repository: ${repositoryPath}`,
      'Repository ID: repository-id',
      'Repository schema: 2',
      'Pending deployment: 0 changes (0 add, 0 modify, 0 delete)',
      'Post-deploy local state: 1 unchanged, 1 Drift, 1 missing',
      'Environment: 0 missing variables',
      'IDE support:',
      '  Codex: disabled, not detected',
      '  Claude Code: disabled, not detected',
      '  Gemini: disabled, not detected',
      '    gemini-cli: absent',
      '    antigravity: absent',
      'Last operation: deploy · failure · 2026-07-19T01:00:00.000Z',
    ]);
  });

  it('prints the same Overview as one machine-readable Status Report', async () => {
    writeDeviceState({});

    await program().parseAsync(['node', 'mcv', 'status', '--json']);

    expect(console.log).toHaveBeenCalledOnce();
    const report = JSON.parse(String(vi.mocked(console.log).mock.calls[0]?.[0]));
    expect(report).toMatchObject({
      schemaVersion: 1,
      operation: 'status',
      status: 'reported',
      ready: true,
      repositoryPath,
      repository: { path: repositoryPath, id: 'repository-id', schemaVersion: 2 },
      changes: [],
      pendingDeployment: { add: 0, modify: 0, delete: 0, total: 0 },
      postDeployLocalState: { unchanged: 0, drift: 0, missing: 0, total: 0 },
      environment: { missingVariables: [], ideSupport: expect.any(Array) },
      lastOperation: null,
      issues: [{ code: 'deploy.noEnabledTargets' }],
    });
    expect(String(vi.mocked(console.log).mock.calls[0]?.[0])).not.toMatch(/\u001b\[/);
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
      schemaVersion: 2,
      defaultRepositoryId: 'repository-id',
      repositoryPath,
      ...extra,
    }));
  }
});

function sha256(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}
