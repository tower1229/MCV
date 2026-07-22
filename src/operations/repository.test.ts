import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as yaml from 'yaml';
import { execFileSync } from 'child_process';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DeviceContext } from '../adapters/types';
import { readState, writeState } from '../utils/state';
import { bindRepository, inspectRepository, unbindRepository } from './repository';

describe('Repository operations', () => {
  const originalCwd = process.cwd();
  let testRoot: string;
  let homeDir: string;
  let context: DeviceContext;

  beforeEach(() => {
    testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mcv-repository-operation-'));
    homeDir = path.join(testRoot, 'home');
    fs.mkdirSync(homeDir);
    context = {
      homeDir,
      platform: 'win32',
      env: { APPDATA: homeDir },
      pathEnv: '',
    };
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(testRoot, { recursive: true, force: true });
  });

  it('binds the current directory through a structured Result when no path is supplied', () => {
    process.chdir(createRepository(testRoot, 'repository-current', 'repository-current-id'));
    const repositoryPath = process.cwd();

    const result = bindRepository(context);

    expect(result).toEqual({
      schemaVersion: 1,
      operation: 'bind',
      status: 'succeeded',
      repositoryPath,
      changes: [],
      issues: [],
      nextActions: [],
      data: {
        repositoryId: 'repository-current-id',
        repositorySchemaVersion: 2,
        previousRepositoryPath: null,
      },
    });
    expect(readState(context)).toMatchObject({
      defaultRepositoryId: 'repository-current-id',
      repositoryPath,
    });
  });

  it('binds an explicitly supplied Repository path', () => {
    const repositoryPath = createRepository(testRoot, 'repository-explicit', 'repository-explicit-id');

    const result = bindRepository(context, repositoryPath);

    expect(result).toMatchObject({
      operation: 'bind',
      status: 'succeeded',
      repositoryPath,
      data: { repositoryId: 'repository-explicit-id' },
    });
    expect(readState(context)).toMatchObject({
      defaultRepositoryId: 'repository-explicit-id',
      repositoryPath,
    });
  });

  it('rejects a Repository whose ID differs from the local binding', () => {
    const originalPath = createRepository(testRoot, 'repository-original', 'repository-original-id');
    const otherPath = createRepository(testRoot, 'repository-other', 'repository-other-id');
    writeState(context, {
      schemaVersion: 2,
      defaultRepositoryId: 'repository-original-id',
      repositoryPath: originalPath,
    });

    const result = bindRepository(context, otherPath);

    expect(result).toMatchObject({
      operation: 'bind',
      status: 'failed',
      repositoryPath: otherPath,
      error: {
        code: 'repository.idMismatch',
        nextActions: ['Unbind the current Repository before binding a different one.'],
      },
    });
    expect(readState(context)).toMatchObject({
      defaultRepositoryId: 'repository-original-id',
      repositoryPath: originalPath,
    });
  });

  it('returns a failed Result without changing state for a directory without a manifest', () => {
    const invalidPath = path.join(testRoot, 'not-a-repository');
    fs.mkdirSync(invalidPath);
    writeState(context, { schemaVersion: 2, deviceId: 'device-id' });

    const result = bindRepository(context, invalidPath);

    expect(result).toMatchObject({
      operation: 'bind',
      status: 'failed',
      repositoryPath: invalidPath,
      error: {
        code: 'repository.invalidManifest',
        nextActions: ['Choose a directory containing a valid mcv.yaml manifest.'],
      },
    });
    expect(readState(context)).toEqual({ schemaVersion: 2, deviceId: 'device-id' });
  });

  it('rebinds a moved Repository after validating the preserved Repository ID', () => {
    const missingOldPath = path.join(testRoot, 'old-location');
    const movedPath = createRepository(testRoot, 'new-location', 'moved-repository-id');
    writeState(context, {
      schemaVersion: 2,
      defaultRepositoryId: 'moved-repository-id',
      repositoryPath: missingOldPath,
    });

    const result = bindRepository(context, movedPath);

    expect(result).toMatchObject({
      operation: 'bind',
      status: 'succeeded',
      repositoryPath: movedPath,
      data: {
        repositoryId: 'moved-repository-id',
        previousRepositoryPath: missingOldPath,
      },
    });
    expect(readState(context).repositoryPath).toBe(movedPath);
  });

  it('unbinds only local binding fields without modifying Repository or IDE data', () => {
    const repositoryPath = createRepository(testRoot, 'repository-unbind', 'repository-unbind-id');
    const manifestPath = path.join(repositoryPath, 'mcv.yaml');
    const manifestBefore = fs.readFileSync(manifestPath, 'utf8');
    const idePath = path.join(homeDir, '.codex', 'config.toml');
    fs.mkdirSync(path.dirname(idePath), { recursive: true });
    fs.writeFileSync(idePath, 'model = "gpt-5"\n');
    writeState(context, {
      schemaVersion: 2,
      deviceId: 'device-id',
      defaultRepositoryId: 'repository-unbind-id',
      repositoryPath,
      baselineSnapshot: { recordedAt: '2026-07-22T00:00:00.000Z', files: { [idePath]: 'hash' } },
      managedInventory: { [idePath]: { source: 'repository', hash: 'hash' } },
      lastOperation: { kind: 'deploy', time: '2026-07-22T00:00:00.000Z', success: true },
    });

    const result = unbindRepository(context);

    expect(result).toMatchObject({
      schemaVersion: 1,
      operation: 'unbind',
      status: 'succeeded',
      repositoryPath,
      data: {
        repositoryId: 'repository-unbind-id',
        previousRepositoryPath: repositoryPath,
      },
    });
    expect(readState(context)).toEqual({
      schemaVersion: 2,
      deviceId: 'device-id',
      baselineSnapshot: { recordedAt: '2026-07-22T00:00:00.000Z', files: { [idePath]: 'hash' } },
      managedInventory: { [idePath]: { source: 'repository', hash: 'hash' } },
      lastOperation: { kind: 'deploy', time: '2026-07-22T00:00:00.000Z', success: true },
    });
    expect(fs.readFileSync(manifestPath, 'utf8')).toBe(manifestBefore);
    expect(fs.readFileSync(idePath, 'utf8')).toBe('model = "gpt-5"\n');
  });

  it('inspects a valid non-Git Repository without producing an Issue or Git field', () => {
    const repositoryPath = createRepository(testRoot, 'repository-inspect', 'repository-inspect-id');
    writeState(context, {
      schemaVersion: 2,
      defaultRepositoryId: 'repository-inspect-id',
      repositoryPath,
    });

    const report = inspectRepository(context);

    expect(report).toEqual({
      schemaVersion: 1,
      operation: 'repository',
      status: 'reported',
      ready: true,
      repositoryPath,
      repositoryId: 'repository-inspect-id',
      repositorySchemaVersion: 2,
      valid: true,
      changes: [],
      issues: [],
      nextActions: [],
    });
    expect(report).not.toHaveProperty('git');
  });

  it('reports optional Git state without mutating the Repository', () => {
    const repositoryPath = createRepository(testRoot, 'repository-git', 'repository-git-id');
    execFileSync('git', ['init'], { cwd: repositoryPath, stdio: 'ignore' });
    const branch = execFileSync('git', ['symbolic-ref', '--short', 'HEAD'], {
      cwd: repositoryPath,
      encoding: 'utf8',
    }).trim();
    const statusBefore = execFileSync('git', ['status', '--porcelain'], {
      cwd: repositoryPath,
      encoding: 'utf8',
    });
    writeState(context, {
      schemaVersion: 2,
      defaultRepositoryId: 'repository-git-id',
      repositoryPath,
    });

    const report = inspectRepository(context);

    expect(report).toMatchObject({
      valid: true,
      issues: [],
      git: { branch, clean: false },
    });
    expect(execFileSync('git', ['status', '--porcelain'], {
      cwd: repositoryPath,
      encoding: 'utf8',
    })).toBe(statusBefore);
  });

  it('reports manifest identity and schema when the bound Repository is not currently valid', () => {
    const repositoryPath = path.join(testRoot, 'repository-old-schema');
    fs.mkdirSync(repositoryPath);
    fs.writeFileSync(path.join(repositoryPath, 'mcv.yaml'), yaml.stringify({
      schemaVersion: 1,
      repositoryId: 'repository-old-schema-id',
    }));
    writeState(context, {
      schemaVersion: 2,
      defaultRepositoryId: 'repository-old-schema-id',
      repositoryPath,
    });

    const report = inspectRepository(context);

    expect(report).toMatchObject({
      status: 'reported',
      ready: false,
      repositoryPath,
      repositoryId: 'repository-old-schema-id',
      repositorySchemaVersion: 1,
      valid: false,
      issues: [{ severity: 'error', code: 'repository.invalidManifest' }],
    });
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
