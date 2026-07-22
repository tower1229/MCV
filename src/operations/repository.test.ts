import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as yaml from 'yaml';
import { execFileSync } from 'child_process';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DeviceContext } from '../adapters/types';
import { readState, writeState } from '../utils/state';
import {
  applyInitPlan,
  applyMigrationPlan,
  applyBindPlan,
  applyUnbindPlan,
  createBindPlan,
  createInitPlan,
  createMigrationPlan,
  createUnbindPlan,
  inspectRepository,
} from './repository';

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

    const result = applyBindPlan(context, createBindPlan(context));

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

    const result = applyBindPlan(context, createBindPlan(context, repositoryPath));

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

    const result = applyBindPlan(context, createBindPlan(context, otherPath));

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

    const result = applyBindPlan(context, createBindPlan(context, invalidPath));

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

    const result = applyBindPlan(context, createBindPlan(context, movedPath));

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

    const result = applyUnbindPlan(context, createUnbindPlan(context));

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
      issues: [{ severity: 'error', code: 'repository.migrationRequired' }],
      nextActions: ['Run `mcv migrate --dry-run` to review the required migration.'],
    });
  });

  it('rejects binding an old schema with a stable migration-required error', () => {
    const repositoryPath = path.join(testRoot, 'repository-bind-old-schema');
    fs.mkdirSync(repositoryPath);
    fs.writeFileSync(path.join(repositoryPath, 'mcv.yaml'), yaml.stringify({
      schemaVersion: 1,
      repositoryId: 'repository-bind-old-schema-id',
    }));

    const result = applyBindPlan(context, createBindPlan(context, repositoryPath));

    expect(result).toMatchObject({
      status: 'failed',
      repositoryPath,
      error: {
        code: 'repository.migrationRequired',
        nextActions: ['Run `mcv migrate --dry-run` to review the required migration.'],
      },
    });
    expect(readState(context)).toEqual({});
  });

  it('keeps Bind planning read-only and applies only the current in-process Plan', () => {
    const repositoryPath = createRepository(testRoot, 'repository-bind-plan', 'repository-bind-plan-id');

    const plan = createBindPlan(context, repositoryPath);

    expect(plan).toMatchObject({
      operation: 'bind',
      status: 'planned',
      readyToApply: true,
      repositoryPath,
      operationId: expect.any(String),
      preconditions: {
        manifest: expect.any(String),
        state: expect.any(String),
      },
      changes: [{
        id: 'repository-binding',
        kind: 'bind',
        previousRepositoryPath: null,
        repositoryPath,
        repositoryId: 'repository-bind-plan-id',
      }],
    });
    expect(Object.isFrozen(plan)).toBe(true);
    expect(Object.isFrozen(plan.changes[0])).toBe(true);
    expect(readState(context)).toEqual({});

    const result = applyBindPlan(context, plan);

    expect(result).toMatchObject({ status: 'succeeded', operation: 'bind' });
    expect(readState(context)).toMatchObject({
      repositoryPath,
      defaultRepositoryId: 'repository-bind-plan-id',
    });
  });

  it('rejects a stale Bind Plan before changing local state', () => {
    const repositoryPath = createRepository(testRoot, 'repository-stale-plan', 'repository-stale-plan-id');
    const plan = createBindPlan(context, repositoryPath);
    writeState(context, { schemaVersion: 2, deviceId: 'changed-after-plan' });

    const result = applyBindPlan(context, plan);

    expect(result).toMatchObject({
      status: 'failed',
      error: { code: 'operation.stalePlan' },
    });
    expect(readState(context)).toEqual({ schemaVersion: 2, deviceId: 'changed-after-plan' });
  });

  it('rejects applying a Bind Plan to a different device state target', () => {
    const repositoryPath = createRepository(testRoot, 'repository-cross-device', 'repository-cross-device-id');
    const plan = createBindPlan(context, repositoryPath);
    const otherHome = path.join(testRoot, 'other-home');
    fs.mkdirSync(otherHome);
    const otherContext: DeviceContext = {
      homeDir: otherHome,
      platform: 'win32',
      env: { APPDATA: otherHome },
      pathEnv: '',
    };

    const result = applyBindPlan(otherContext, plan);

    expect(result).toMatchObject({
      status: 'failed',
      error: { code: 'operation.stalePlan' },
    });
    expect(readState(otherContext)).toEqual({});
  });

  it('rejects a Bind Plan when the manifest changes after planning', () => {
    const repositoryPath = createRepository(testRoot, 'repository-manifest-race', 'repository-manifest-race-id');
    const plan = createBindPlan(context, repositoryPath);
    fs.appendFileSync(path.join(repositoryPath, 'mcv.yaml'), '\n# changed after planning\n');

    const result = applyBindPlan(context, plan);

    expect(result).toMatchObject({
      status: 'failed',
      error: { code: 'operation.stalePlan' },
    });
    expect(readState(context)).toEqual({});
  });

  it('keeps Unbind planning read-only and applies only local binding removal', () => {
    const repositoryPath = createRepository(testRoot, 'repository-unbind-plan', 'repository-unbind-plan-id');
    writeState(context, {
      schemaVersion: 2,
      deviceId: 'device-id',
      defaultRepositoryId: 'repository-unbind-plan-id',
      repositoryPath,
    });

    const plan = createUnbindPlan(context);

    expect(plan).toMatchObject({
      operation: 'unbind',
      status: 'planned',
      readyToApply: true,
      repositoryPath,
      changes: [{ id: 'repository-binding', kind: 'unbind' }],
    });
    expect(readState(context)).toHaveProperty('repositoryPath', repositoryPath);

    const result = applyUnbindPlan(context, plan);

    expect(result).toMatchObject({ status: 'succeeded', operation: 'unbind' });
    expect(readState(context)).toEqual({ schemaVersion: 2, deviceId: 'device-id' });
  });

  it('freezes a failed Bind Plan as an immutable in-process snapshot', () => {
    const invalidPath = path.join(testRoot, 'repository-failed-plan');
    fs.mkdirSync(invalidPath);

    const plan = createBindPlan(context, invalidPath);

    expect(plan).toMatchObject({ status: 'failed', readyToApply: false });
    expect(Object.isFrozen(plan)).toBe(true);
    expect(Object.isFrozen(plan.issues)).toBe(true);
    expect(Object.isFrozen(plan.nextActions)).toBe(true);
  });

  it('reports a future schema as unsupported instead of migratable', () => {
    const repositoryPath = path.join(testRoot, 'repository-future-schema');
    fs.mkdirSync(repositoryPath);
    fs.writeFileSync(path.join(repositoryPath, 'mcv.yaml'), yaml.stringify({
      schemaVersion: 3,
      repositoryId: 'repository-future-schema-id',
    }));
    writeState(context, {
      schemaVersion: 2,
      defaultRepositoryId: 'repository-future-schema-id',
      repositoryPath,
    });

    expect(inspectRepository(context)).toMatchObject({
      valid: false,
      issues: [{ code: 'repository.unsupportedSchema' }],
    });
    expect(createBindPlan(context, repositoryPath)).toMatchObject({
      status: 'failed',
      error: { code: 'repository.unsupportedSchema' },
    });
  });

  it.each([false, true])('plans Init without writes and applies a valid empty Repository (git=%s)', (git) => {
    const repositoryPath = path.join(testRoot, git ? 'init-git' : 'init-plain');
    fs.mkdirSync(repositoryPath);
    if (git) execFileSync('git', ['init'], { cwd: repositoryPath, stdio: 'ignore' });

    const plan = createInitPlan(context, repositoryPath);

    expect(plan).toMatchObject({
      schemaVersion: 1,
      operation: 'init',
      status: 'planned',
      readyToApply: true,
      repositoryPath,
      operationId: expect.any(String),
      preconditions: {
        manifest: 'missing',
        state: 'missing',
        stateTarget: expect.any(String),
      },
      changes: [
        expect.objectContaining({ id: 'repository-manifest', kind: 'add', path: path.join(repositoryPath, 'mcv.yaml') }),
        expect.objectContaining({ id: 'repository-binding', kind: 'bind', repositoryPath }),
      ],
      issues: [],
    });
    expect(fs.existsSync(path.join(repositoryPath, 'mcv.yaml'))).toBe(false);
    expect(readState(context)).toEqual({});

    const result = applyInitPlan(context, plan);

    expect(result).toMatchObject({
      operation: 'init',
      status: 'succeeded',
      repositoryPath,
      data: {
        repositoryId: expect.any(String),
        repositorySchemaVersion: 2,
      },
    });
    expect(() => readManifestForTest(repositoryPath)).not.toThrow();
    expect(readState(context)).toMatchObject({
      defaultRepositoryId: result.status === 'succeeded' ? result.data?.repositoryId : undefined,
      repositoryPath,
      baselineSnapshot: { files: {} },
    });
  });

  it('rejects a stale Init Plan without overwriting the new target state', () => {
    const repositoryPath = path.join(testRoot, 'init-stale');
    fs.mkdirSync(repositoryPath);
    const plan = createInitPlan(context, repositoryPath);
    fs.writeFileSync(path.join(repositoryPath, 'mcv.yaml'), 'owned: elsewhere\n');

    const result = applyInitPlan(context, plan);

    expect(result).toMatchObject({ status: 'failed', error: { code: 'operation.stalePlan' } });
    expect(fs.readFileSync(path.join(repositoryPath, 'mcv.yaml'), 'utf8')).toBe('owned: elsewhere\n');
    expect(readState(context)).toEqual({});
  });

  it('rejects an Init Plan whose operation ID is not the active in-process Plan', () => {
    const repositoryPath = path.join(testRoot, 'init-operation-id');
    fs.mkdirSync(repositoryPath);
    const plan = createInitPlan(context, repositoryPath);

    const result = applyInitPlan(context, { ...plan, operationId: 'different-operation-id' });

    expect(result).toMatchObject({ status: 'failed', error: { code: 'operation.invalidPlan' } });
    expect(fs.existsSync(path.join(repositoryPath, 'mcv.yaml'))).toBe(false);
  });

  it('plans schema migration without writes and applies it only after verifying a backup', () => {
    const repositoryPath = createV1Repository(testRoot, 'migration-plan');
    const manifestPath = path.join(repositoryPath, 'mcv.yaml');
    const manifestBefore = fs.readFileSync(manifestPath, 'utf8');

    const plan = createMigrationPlan(context, repositoryPath);

    expect(plan).toMatchObject({
      schemaVersion: 1,
      operation: 'migrate',
      status: 'planned',
      readyToApply: true,
      repositoryPath,
      operationId: expect.any(String),
      preconditions: { repository: expect.any(String), stateTarget: expect.any(String) },
      changes: expect.arrayContaining([
        expect.objectContaining({ id: 'repository-backup', kind: 'backup' }),
        expect.objectContaining({ id: 'schema-version', kind: 'modify', before: 1, after: 2 }),
        expect.objectContaining({ id: 'gemini-settings-layout', kind: 'move' }),
        expect.objectContaining({ id: 'mcp-registry', kind: 'modify' }),
      ]),
    });
    expect(fs.readFileSync(manifestPath, 'utf8')).toBe(manifestBefore);
    expect(fs.existsSync(path.join(repositoryPath, 'ide', 'gemini', 'native', 'gemini-cli', 'settings.json'))).toBe(false);

    const result = applyMigrationPlan(context, plan);

    expect(result).toMatchObject({
      operation: 'migrate',
      status: 'succeeded',
      repositoryPath,
      data: {
        repositoryId: 'migration-plan-id',
        previousSchemaVersion: 1,
        repositorySchemaVersion: 2,
        backupPath: expect.any(String),
        backupVerified: true,
      },
    });
    if (result.status !== 'succeeded' || !result.data) throw new Error('expected migration success');
    expect(fs.readFileSync(path.join(result.data.backupPath, 'mcv.yaml'), 'utf8')).toBe(manifestBefore);
    expect(readManifestForTest(repositoryPath).schemaVersion).toBe(2);
    expect(fs.existsSync(path.join(repositoryPath, 'ide', 'gemini', 'native', 'gemini-cli', 'settings.json'))).toBe(true);
    expect(Object.keys(yaml.parse(fs.readFileSync(path.join(repositoryPath, 'common', 'mcp.yaml'), 'utf8')).servers)).toEqual(['user']);
  });

  it('rejects a stale Migration Plan before backup or repository writes', () => {
    const repositoryPath = createV1Repository(testRoot, 'migration-stale');
    const plan = createMigrationPlan(context, repositoryPath);
    fs.appendFileSync(path.join(repositoryPath, 'mcv.yaml'), '# changed\n');

    const result = applyMigrationPlan(context, plan);

    expect(result).toMatchObject({ status: 'failed', error: { code: 'operation.stalePlan' } });
    expect(yaml.parse(fs.readFileSync(path.join(repositoryPath, 'mcv.yaml'), 'utf8')).schemaVersion).toBe(1);
    expect(fs.existsSync(path.join(homeDir, 'mcv', 'repository-backups'))).toBe(false);
  });

  it('rejects a Migration Plan whose operation ID is not the active in-process Plan', () => {
    const repositoryPath = createV1Repository(testRoot, 'migration-operation-id');
    const plan = createMigrationPlan(context, repositoryPath);

    const result = applyMigrationPlan(context, { ...plan, operationId: 'different-operation-id' });

    expect(result).toMatchObject({ status: 'failed', error: { code: 'operation.invalidPlan' } });
    expect(yaml.parse(fs.readFileSync(path.join(repositoryPath, 'mcv.yaml'), 'utf8')).schemaVersion).toBe(1);
  });
});

function readManifestForTest(repositoryPath: string): Record<string, unknown> {
  return yaml.parse(fs.readFileSync(path.join(repositoryPath, 'mcv.yaml'), 'utf8')) as Record<string, unknown>;
}

function createV1Repository(root: string, name: string): string {
  const repositoryPath = path.join(root, name);
  fs.mkdirSync(path.join(repositoryPath, 'ide', 'gemini', 'native'), { recursive: true });
  fs.mkdirSync(path.join(repositoryPath, 'common'), { recursive: true });
  fs.writeFileSync(path.join(repositoryPath, 'mcv.yaml'), yaml.stringify({
    schemaVersion: 1,
    repositoryId: `${name}-id`,
    initializedAt: '2026-07-22T00:00:00.000Z',
    targets: { gemini: { enabled: true } },
    customField: 'preserved',
  }));
  fs.writeFileSync(path.join(repositoryPath, 'ide', 'gemini', 'native', 'settings.json'), '{}\n');
  fs.writeFileSync(path.join(repositoryPath, 'common', 'mcp.yaml'), yaml.stringify({
    servers: {
      node_repl: { command: 'runtime/node_repl.exe' },
      user: { command: 'server' },
    },
  }));
  return repositoryPath;
}

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
