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
});
