import * as fs from 'fs';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { createProgram } from '../index';

describe('mcv init', () => {
  const originalCwd = process.cwd();
  let testRoot: string;
  let repositoryPath: string;
  let stateRoot: string;

  beforeEach(() => {
    testRoot = fs.mkdtempSync(path.join(originalCwd, '.mcv-init-test-'));
    repositoryPath = path.join(testRoot, 'repository');
    stateRoot = path.join(testRoot, 'device');
    fs.mkdirSync(repositoryPath);

    process.chdir(repositoryPath);
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    process.chdir(originalCwd);
    vi.restoreAllMocks();
    fs.rmSync(testRoot, { recursive: true, force: true });
  });

  it('marks the current directory as an MCV repository and binds this device', async () => {
    await createProgram({
      homeDir: stateRoot,
      platform: 'win32',
      env: { APPDATA: stateRoot },
      pathEnv: '',
    }).parseAsync(['node', 'mcv', 'init', '--yes', '--json']);

    expect(console.log).toHaveBeenCalledOnce();
    expect(JSON.parse(String(vi.mocked(console.log).mock.calls[0]?.[0]))).toMatchObject({
      schemaVersion: 1,
      operation: 'init',
      status: 'succeeded',
      repositoryPath,
      changes: [],
      issues: [],
      nextActions: [],
      data: { repositoryId: expect.any(String), repositorySchemaVersion: 2 },
    });

    const manifest = parseYaml(
      fs.readFileSync(path.join(repositoryPath, 'mcv.yaml'), 'utf8'),
    );
    expect(manifest).toMatchObject({
      schemaVersion: 2,
      repositoryId: expect.any(String),
      initializedAt: expect.any(String),
      targets: {
        codex: { enabled: true },
        claudeCode: { enabled: true },
        gemini: { enabled: true, surfaces: { geminiCli: 'auto', antigravity: 'auto' } },
      },
      variables: {},
      security: {
        scanSecrets: true,
        allowPlaintextSecrets: false,
      },
      capture: {
        preserveUnknownNativeFields: true,
      },
      deploy: {
        backupBeforeWrite: true,
        useSymlinks: false,
      },
    });

    const state = JSON.parse(
      fs.readFileSync(path.join(stateRoot, 'mcv', 'config.json'), 'utf8'),
    );
    expect(state).toMatchObject({
      deviceId: expect.any(String),
      defaultRepositoryId: manifest.repositoryId,
      repositoryPath,
      baselineSnapshot: {
        recordedAt: expect.any(String),
        files: {},
      },
    });
  });

  it('prints a read-only structured Init Plan', async () => {
    await createProgram({
      homeDir: stateRoot,
      platform: 'win32',
      env: { APPDATA: stateRoot },
      pathEnv: '',
    }).parseAsync(['node', 'mcv', 'init', '--dry-run', '--json']);

    expect(console.log).toHaveBeenCalledOnce();
    expect(JSON.parse(String(vi.mocked(console.log).mock.calls[0]?.[0]))).toMatchObject({
      schemaVersion: 1,
      operation: 'init',
      status: 'planned',
      readyToApply: true,
      operationId: expect.any(String),
      preconditions: expect.any(Object),
      repositoryPath,
      changes: expect.arrayContaining([
        expect.objectContaining({ id: 'repository-manifest', kind: 'add' }),
        expect.objectContaining({ id: 'repository-binding', kind: 'bind' }),
      ]),
    });
    expect(fs.existsSync(path.join(repositoryPath, 'mcv.yaml'))).toBe(false);
    expect(fs.existsSync(path.join(stateRoot, 'mcv', 'config.json'))).toBe(false);
  });

  it('does not Apply Init without an explicit --yes', async () => {
    await createProgram({
      homeDir: stateRoot,
      platform: 'win32',
      env: { APPDATA: stateRoot },
      pathEnv: '',
    }).parseAsync(['node', 'mcv', 'init']);

    expect(vi.mocked(console.log).mock.calls[0]?.[0]).toBe(`Init Plan: ${repositoryPath}`);
    expect(fs.existsSync(path.join(repositoryPath, 'mcv.yaml'))).toBe(false);
    expect(fs.existsSync(path.join(stateRoot, 'mcv', 'config.json'))).toBe(false);
  });

  it('is exposed as the mcv executable in the npm package', () => {
    const packageJson = JSON.parse(
      fs.readFileSync(path.join(originalCwd, 'package.json'), 'utf8'),
    );

    expect(packageJson.bin).toEqual({ mcv: 'dist/index.js' });
  });
});
