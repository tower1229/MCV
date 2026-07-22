import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as yaml from 'yaml';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProgram } from '../index';
import { readState, writeState } from '../utils/state';

describe('mcv Repository routes', () => {
  const originalCwd = process.cwd();
  let testRoot: string;
  let homeDir: string;
  let repositoryPath: string;
  const context = () => ({
    homeDir,
    platform: 'win32' as const,
    env: { APPDATA: homeDir },
    pathEnv: '',
  });

  beforeEach(() => {
    testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mcv-repository-command-'));
    homeDir = path.join(testRoot, 'home');
    fs.mkdirSync(homeDir);
    repositoryPath = createRepository(testRoot, 'repository', 'repository-command-id');
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    process.chdir(originalCwd);
    vi.restoreAllMocks();
    fs.rmSync(testRoot, { recursive: true, force: true });
  });

  it('renders the same Repository Report through JSON and plain routes', async () => {
    writeState(context(), {
      schemaVersion: 2,
      defaultRepositoryId: 'repository-command-id',
      repositoryPath,
    });

    await createProgram(context()).parseAsync(['node', 'mcv', 'repo', '--json']);
    expect(console.log).toHaveBeenCalledOnce();
    const report = JSON.parse(String(vi.mocked(console.log).mock.calls[0]?.[0]));
    expect(report).toMatchObject({
      schemaVersion: 1,
      operation: 'repository',
      status: 'reported',
      ready: true,
      repositoryPath,
      repositoryId: 'repository-command-id',
      repositorySchemaVersion: 2,
      valid: true,
      issues: [],
      nextActions: [],
    });

    vi.mocked(console.log).mockClear();
    await createProgram(context()).parseAsync(['node', 'mcv', 'repo', '--plain']);
    expect(vi.mocked(console.log).mock.calls.map(([line]) => line)).toEqual([
      `Repository: ${report.repositoryPath}`,
      `Repository ID: ${report.repositoryId}`,
      `Schema version: ${report.repositorySchemaVersion}`,
      'Validity: valid',
    ]);
  });

  it('binds the current directory and unbinds through structured JSON Results', async () => {
    process.chdir(repositoryPath);

    await createProgram(context()).parseAsync(['node', 'mcv', 'bind', '--json']);
    const bindResult = JSON.parse(String(vi.mocked(console.log).mock.calls[0]?.[0]));
    expect(bindResult).toMatchObject({
      schemaVersion: 1,
      operation: 'bind',
      status: 'succeeded',
      repositoryPath: process.cwd(),
      data: { repositoryId: 'repository-command-id' },
    });
    expect(readState(context())).toMatchObject({
      defaultRepositoryId: 'repository-command-id',
      repositoryPath: process.cwd(),
    });

    vi.mocked(console.log).mockClear();
    await createProgram(context()).parseAsync(['node', 'mcv', 'unbind', '--json']);
    const unbindResult = JSON.parse(String(vi.mocked(console.log).mock.calls[0]?.[0]));
    expect(unbindResult).toMatchObject({
      schemaVersion: 1,
      operation: 'unbind',
      status: 'succeeded',
      data: { repositoryId: 'repository-command-id' },
    });
    expect(readState(context())).not.toHaveProperty('repositoryPath');
    expect(readState(context())).not.toHaveProperty('defaultRepositoryId');
  });
});

function createRepository(root: string, name: string, repositoryId: string): string {
  const repositoryPath = path.join(root, name);
  fs.mkdirSync(repositoryPath);
  fs.writeFileSync(path.join(repositoryPath, 'mcv.yaml'), yaml.stringify({
    schemaVersion: 2,
    repositoryId,
    initializedAt: '2026-07-22T00:00:00.000Z',
    targets: {
      codex: { enabled: true },
      claudeCode: { enabled: true },
      gemini: {
        enabled: true,
        surfaces: { geminiCli: 'auto', antigravity: 'auto' },
      },
    },
    variables: {},
    security: { scanSecrets: true, allowPlaintextSecrets: false },
    capture: { preserveUnknownNativeFields: true },
    deploy: { backupBeforeWrite: true, useSymlinks: false },
  }));
  return repositoryPath;
}
