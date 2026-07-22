import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { describe, expect, it } from 'vitest';

const cliPath = path.join(process.cwd(), 'dist', 'index.js');

describe('packaged mcv CLI', () => {
  it('prints help successfully through the published bin entry', () => {
    const result = spawnSync(process.execPath, [cliPath, '--help'], {
      encoding: 'utf8',
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Usage: mcv [options] [command]');
    expect(result.stderr).toBe('');
  });

  it('prints exactly one Environment Report JSON document', () => {
    const result = spawnSync(process.execPath, [cliPath, 'discover', '--json'], {
      encoding: 'utf8',
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(JSON.parse(result.stdout)).toEqual(expect.objectContaining({
      schemaVersion: 1,
      operation: 'discover',
      status: 'reported',
      ready: true,
      repositoryPath: null,
      changes: [],
      issues: [],
      nextActions: [],
    }));
    expect(result.stdout).not.toMatch(/\u001b\[/);
  });

  it('rejects conflicting Environment Report output modes as a usage error', () => {
    const result = spawnSync(
      process.execPath,
      [cliPath, 'discover', '--plain', '--json'],
      { encoding: 'utf8' },
    );

    expect(result.status).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain("options '--plain' and '--json' cannot be used together");
  });

  it('prints exactly one Repository Report JSON document', () => {
    const isolatedHome = fs.mkdtempSync(path.join(os.tmpdir(), 'mcv-cli-repository-'));
    try {
      const result = spawnSync(process.execPath, [cliPath, 'repo', '--json'], {
        encoding: 'utf8',
        env: { ...process.env, HOME: isolatedHome, APPDATA: isolatedHome },
      });

      expect(result.status).toBe(0);
      expect(result.stderr).toBe('');
      expect(JSON.parse(result.stdout)).toEqual(expect.objectContaining({
        schemaVersion: 1,
        operation: 'repository',
        status: 'reported',
        ready: false,
        repositoryPath: null,
        repositoryId: null,
        repositorySchemaVersion: null,
        valid: false,
        changes: [],
        issues: [expect.objectContaining({ code: 'repository.notBound' })],
      }));
      expect(result.stdout).not.toMatch(/\u001b\[/);
    } finally {
      fs.rmSync(isolatedHome, { recursive: true, force: true });
    }
  });

  it('returns one structured failed Bind Result for an invalid directory', () => {
    const isolatedRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mcv-cli-bind-'));
    const invalidRepository = path.join(isolatedRoot, 'invalid-repository');
    fs.mkdirSync(invalidRepository);
    try {
      const result = spawnSync(
        process.execPath,
        [cliPath, 'bind', invalidRepository, '--json'],
        {
          encoding: 'utf8',
          env: { ...process.env, HOME: isolatedRoot, APPDATA: isolatedRoot },
        },
      );

      expect(result.status).toBe(1);
      expect(result.stderr).toBe('');
      expect(JSON.parse(result.stdout)).toEqual(expect.objectContaining({
        schemaVersion: 1,
        operation: 'bind',
        status: 'failed',
        repositoryPath: invalidRepository,
        error: expect.objectContaining({ code: 'repository.invalidManifest' }),
      }));
    } finally {
      fs.rmSync(isolatedRoot, { recursive: true, force: true });
    }
  });

  it('prints one read-only Init Plan JSON document', () => {
    const isolatedRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mcv-cli-init-'));
    const repositoryPath = path.join(isolatedRoot, 'repository');
    fs.mkdirSync(repositoryPath);
    const resolvedRepositoryPath = fs.realpathSync(repositoryPath);
    try {
      const result = spawnSync(
        process.execPath,
        [cliPath, 'init', '--dry-run', '--json'],
        {
          cwd: repositoryPath,
          encoding: 'utf8',
          env: { ...process.env, HOME: isolatedRoot, APPDATA: isolatedRoot },
        },
      );

      expect(result.status).toBe(0);
      expect(result.stderr).toBe('');
      expect(JSON.parse(result.stdout)).toEqual(expect.objectContaining({
        schemaVersion: 1,
        operation: 'init',
        status: 'planned',
        readyToApply: true,
        repositoryPath: resolvedRepositoryPath,
        operationId: expect.any(String),
      }));
      expect(fs.existsSync(path.join(repositoryPath, 'mcv.yaml'))).toBe(false);
    } finally {
      fs.rmSync(isolatedRoot, { recursive: true, force: true });
    }
  });

  it('prints one Migration Result JSON document after a verified backup', () => {
    const isolatedRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mcv-cli-migrate-'));
    const repositoryPath = path.join(isolatedRoot, 'repository');
    fs.mkdirSync(repositoryPath);
    const resolvedRepositoryPath = fs.realpathSync(repositoryPath);
    fs.writeFileSync(path.join(repositoryPath, 'mcv.yaml'), [
      'schemaVersion: 1',
      'repositoryId: process-migration-id',
      'initializedAt: 2026-07-22T00:00:00.000Z',
      'targets: {}',
      '',
    ].join('\n'));
    try {
      const result = spawnSync(
        process.execPath,
        [cliPath, 'migrate', '--yes', '--json'],
        {
          cwd: repositoryPath,
          encoding: 'utf8',
          env: { ...process.env, HOME: isolatedRoot, APPDATA: isolatedRoot },
        },
      );

      expect(result.status).toBe(0);
      expect(result.stderr).toBe('');
      expect(JSON.parse(result.stdout)).toEqual(expect.objectContaining({
        schemaVersion: 1,
        operation: 'migrate',
        status: 'succeeded',
        repositoryPath: resolvedRepositoryPath,
        data: expect.objectContaining({
          previousSchemaVersion: 1,
          repositorySchemaVersion: 2,
          backupVerified: true,
        }),
      }));
      expect(fs.readFileSync(path.join(repositoryPath, 'mcv.yaml'), 'utf8')).toContain('schemaVersion: 2');
    } finally {
      fs.rmSync(isolatedRoot, { recursive: true, force: true });
    }
  });

  it('prints exactly one read-only Capture Plan JSON document', () => {
    const isolatedRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mcv-cli-capture-'));
    const repositoryPath = path.join(isolatedRoot, 'repository');
    const claudeRoot = path.join(isolatedRoot, '.claude');
    fs.mkdirSync(repositoryPath);
    const resolvedRepositoryPath = fs.realpathSync(repositoryPath);
    fs.mkdirSync(claudeRoot);
    fs.writeFileSync(path.join(repositoryPath, 'mcv.yaml'), [
      'schemaVersion: 2',
      'repositoryId: process-capture-id',
      'initializedAt: 2026-07-22T00:00:00.000Z',
      'security: { scanSecrets: true, allowPlaintextSecrets: false }',
      'capture: { preserveUnknownNativeFields: true }',
      'deploy: { backupBeforeWrite: true, useSymlinks: false }',
      'targets:',
      '  claudeCode:',
      '    enabled: true',
      'variables: {}',
      '',
    ].join('\n'));
    fs.writeFileSync(
      path.join(claudeRoot, 'settings.json'),
      JSON.stringify({ theme: 'dark', apiToken: 'process-secret-must-not-leak' }),
    );
    try {
      const result = spawnSync(
        process.execPath,
        [cliPath, 'capture', '--dry-run', '--json'],
        {
          cwd: repositoryPath,
          encoding: 'utf8',
          env: { ...process.env, HOME: isolatedRoot, APPDATA: isolatedRoot },
        },
      );

      expect(result.status).toBe(0);
      expect(result.stderr).toBe('');
      expect(JSON.parse(result.stdout)).toEqual(expect.objectContaining({
        schemaVersion: 1,
        operation: 'capture',
        status: 'planned',
        repositoryPath: resolvedRepositoryPath,
        changes: [expect.objectContaining({
          id: expect.any(String),
          ide: 'claude-code',
          itemType: 'file',
        })],
      }));
      expect(result.stdout).not.toContain('process-secret-must-not-leak');
      expect(fs.existsSync(path.join(repositoryPath, 'ide'))).toBe(false);
      expect(fs.existsSync(path.join(isolatedRoot, 'mcv', 'config.json'))).toBe(false);
    } finally {
      fs.rmSync(isolatedRoot, { recursive: true, force: true });
    }
  });

  it('prints exactly one read-only Deploy Plan JSON document', () => {
    const isolatedRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mcv-cli-deploy-')));
    const repositoryPath = path.join(isolatedRoot, 'repository');
    fs.mkdirSync(path.join(repositoryPath, 'common'), { recursive: true });
    fs.writeFileSync(path.join(repositoryPath, 'mcv.yaml'), [
      'schemaVersion: 2',
      'repositoryId: process-deploy-id',
      'initializedAt: 2026-07-22T00:00:00.000Z',
      'security: { scanSecrets: true, allowPlaintextSecrets: false }',
      'capture: { preserveUnknownNativeFields: true }',
      'deploy: { backupBeforeWrite: true, useSymlinks: false }',
      'targets:',
      '  claudeCode:',
      '    enabled: true',
      'variables: {}',
      '',
    ].join('\n'));
    fs.writeFileSync(path.join(repositoryPath, 'common', 'AGENTS.md'), '# Process rules\n');
    try {
      const result = spawnSync(
        process.execPath,
        [cliPath, 'deploy', '--dry-run', '--json'],
        {
          cwd: repositoryPath,
          encoding: 'utf8',
          env: { ...process.env, HOME: isolatedRoot, APPDATA: isolatedRoot },
        },
      );

      expect(result.status).toBe(0);
      expect(result.stderr).toBe('');
      expect(JSON.parse(result.stdout)).toEqual(expect.objectContaining({
        schemaVersion: 1,
        operation: 'deploy',
        status: 'planned',
        repositoryPath,
        changes: [expect.objectContaining({
          id: expect.stringMatching(/^deploy-[a-f0-9]{16}$/),
          ide: 'claude-code',
          capability: 'rules',
          strategy: 'replace-entire-file',
        })],
      }));
      expect(fs.existsSync(path.join(isolatedRoot, '.claude', 'CLAUDE.md'))).toBe(false);
    } finally {
      fs.rmSync(isolatedRoot, { recursive: true, force: true });
    }
  });

  it('does not echo invalid source content in Capture failure output', () => {
    const isolatedRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mcv-cli-capture-failure-'));
    const repositoryPath = path.join(isolatedRoot, 'repository');
    fs.mkdirSync(repositoryPath);
    fs.writeFileSync(
      path.join(repositoryPath, 'mcv.yaml'),
      'schemaVersion: [invalid-log-secret-must-not-leak\n',
    );
    try {
      const result = spawnSync(
        process.execPath,
        [cliPath, 'capture', '--dry-run'],
        {
          cwd: repositoryPath,
          encoding: 'utf8',
          env: { ...process.env, HOME: isolatedRoot, APPDATA: isolatedRoot },
        },
      );

      expect(result.status).toBe(1);
      expect(result.stderr).toBe('');
      expect(result.stdout).toContain('capture.planFailed');
      expect(result.stdout).not.toContain('invalid-log-secret-must-not-leak');
      expect(fs.readFileSync(path.join(repositoryPath, 'mcv.yaml'), 'utf8')).toContain(
        'invalid-log-secret-must-not-leak',
      );
    } finally {
      fs.rmSync(isolatedRoot, { recursive: true, force: true });
    }
  });
});
