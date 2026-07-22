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
});
