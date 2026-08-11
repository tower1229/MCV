import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as yaml from 'yaml';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProgram } from '../index.js';
import { readState, writeState } from '../utils/state.js';

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
      schemaVersion: 3,
      operation: 'repository',
      status: 'reported',
      ready: true,
      repositoryPath,
      repositoryId: 'repository-command-id',
      repositorySchemaVersion: 4,
      valid: true,
      issues: [],
      nextActions: [],
    });

    vi.mocked(console.log).mockClear();
    await createProgram(context()).parseAsync(['node', 'mcv', 'repo', '--plain']);
    const plain = vi.mocked(console.log).mock.calls.flat().join('\n');
    expect(plain).toContain(`Repository  ${report.repositoryPath}`);
    expect(plain).toContain(`Identity  ${report.repositoryId}`);
    expect(plain).toContain(`Schema  ${report.repositorySchemaVersion}`);
    expect(plain).toContain('✓ Repository is valid.');
  });

  it('previews and applies Bind and Unbind through structured Plans and Results', async () => {
    process.chdir(repositoryPath);

    await createProgram(context()).parseAsync(['node', 'mcv', 'bind', '--dry-run', '--json']);
    const bindPlan = JSON.parse(String(vi.mocked(console.log).mock.calls[0]?.[0]));
    expect(bindPlan).toMatchObject({
      schemaVersion: 3,
      operation: 'bind',
      status: 'planned',
      readyToApply: true,
      repositoryPath: process.cwd(),
      operationId: expect.any(String),
    });
    expect(readState(context())).not.toHaveProperty('repositoryPath');

    vi.mocked(console.log).mockClear();
    await createProgram(context()).parseAsync(['node', 'mcv', 'bind', '--yes', '--json']);
    const bindResult = JSON.parse(String(vi.mocked(console.log).mock.calls[0]?.[0]));
    expect(bindResult).toMatchObject({
      schemaVersion: 3,
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
    await createProgram(context()).parseAsync(['node', 'mcv', 'unbind', '--dry-run', '--json']);
    const unbindPlan = JSON.parse(String(vi.mocked(console.log).mock.calls[0]?.[0]));
    expect(unbindPlan).toMatchObject({
      schemaVersion: 3,
      operation: 'unbind',
      status: 'planned',
      readyToApply: true,
      repositoryPath: process.cwd(),
      operationId: expect.any(String),
    });
    expect(readState(context())).toMatchObject({
      defaultRepositoryId: 'repository-command-id',
      repositoryPath: process.cwd(),
    });

    vi.mocked(console.log).mockClear();
    await createProgram(context()).parseAsync(['node', 'mcv', 'unbind', '--yes', '--json']);
    const unbindResult = JSON.parse(String(vi.mocked(console.log).mock.calls[0]?.[0]));
    expect(unbindResult).toMatchObject({
      schemaVersion: 3,
      operation: 'unbind',
      status: 'succeeded',
      data: { repositoryId: 'repository-command-id' },
    });
    expect(readState(context())).not.toHaveProperty('repositoryPath');
    expect(readState(context())).not.toHaveProperty('defaultRepositoryId');
  });

  it('renders a Migration Plan and Result as structured JSON', async () => {
    const oldRepository = path.join(testRoot, 'old-repository');
    fs.mkdirSync(oldRepository);
    fs.writeFileSync(path.join(oldRepository, 'mcv.yaml'), yaml.stringify({
      schemaVersion: 1,
      repositoryId: 'old-repository-id',
      initializedAt: '2026-07-22T00:00:00.000Z',
      targets: {},
    }));

    await createProgram(context()).parseAsync(['node', 'mcv', 'migrate', oldRepository, '--dry-run', '--json']);
    expect(console.log).toHaveBeenCalledOnce();
    expect(JSON.parse(String(vi.mocked(console.log).mock.calls[0]?.[0]))).toMatchObject({
      operation: 'migrate',
      status: 'planned',
      readyToApply: true,
      repositoryPath: oldRepository,
      changes: expect.arrayContaining([
        expect.objectContaining({ id: 'repository-backup', kind: 'backup' }),
        expect.objectContaining({ id: 'catalog-scan', kind: 'scan' }),
        expect.objectContaining({ id: 'schema-version', before: 1, after: 4 }),
        expect.objectContaining({ id: 'repository-profiles', kind: 'add' }),
      ]),
    });
    expect(yaml.parse(fs.readFileSync(path.join(oldRepository, 'mcv.yaml'), 'utf8')).schemaVersion).toBe(1);

    vi.mocked(console.log).mockClear();
    await createProgram(context()).parseAsync(['node', 'mcv', 'migrate', oldRepository, '--yes', '--json']);
    expect(console.log).toHaveBeenCalledOnce();
    expect(JSON.parse(String(vi.mocked(console.log).mock.calls[0]?.[0]))).toMatchObject({
      operation: 'migrate',
      status: 'succeeded',
      repositoryPath: oldRepository,
      data: { previousSchemaVersion: 1, repositorySchemaVersion: 4, backupVerified: true },
    });
  });

  it('does not Apply Migration without an explicit --yes', async () => {
    const oldRepository = path.join(testRoot, 'old-repository-no-mode');
    fs.mkdirSync(oldRepository);
    fs.writeFileSync(path.join(oldRepository, 'mcv.yaml'), yaml.stringify({
      schemaVersion: 1,
      repositoryId: 'old-repository-no-mode-id',
      targets: {},
    }));

    await createProgram(context()).parseAsync(['node', 'mcv', 'migrate', oldRepository]);

    expect(vi.mocked(console.log).mock.calls.flat().join('\n')).toContain(`Repository  ${oldRepository}`);
    expect(yaml.parse(fs.readFileSync(path.join(oldRepository, 'mcv.yaml'), 'utf8')).schemaVersion).toBe(1);
  });
});

function createRepository(root: string, name: string, repositoryId: string): string {
  const repositoryPath = path.join(root, name);
  fs.mkdirSync(repositoryPath);
  fs.writeFileSync(path.join(repositoryPath, 'mcv.yaml'), yaml.stringify({
    schemaVersion: 4,
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
    capture: { preserveUnknownNativeFields: true },
    deploy: { backupBeforeWrite: true, useSymlinks: false },
  }));
  return repositoryPath;
}
