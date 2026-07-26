import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawn, spawnSync } from 'child_process';
import { describe, expect, it } from 'vitest';

const cliPath = path.join(process.cwd(), 'dist', 'index.js');

function isolatedEnvironment(homeDir: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    HOME: homeDir,
    USERPROFILE: homeDir,
    APPDATA: homeDir,
    CODEX_HOME: path.join(homeDir, '.codex'),
    CLAUDE_CONFIG_DIR: path.join(homeDir, '.claude'),
  };
}

describe('packaged mcv CLI', () => {
  it('prints help and succeeds when invoked without arguments outside a TTY', () => {
    const result = spawnSync(process.execPath, [cliPath], {
      encoding: 'utf8',
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Usage: mcv [options] [command]');
    expect(result.stderr).toBe('');
  });

  it('prints help successfully through the published bin entry', () => {
    const result = spawnSync(process.execPath, [cliPath, '--help'], {
      encoding: 'utf8',
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Usage: mcv [options] [command]');
    expect(result.stderr).toBe('');
  });

  it('prints the package version immediately', () => {
    const result = spawnSync(process.execPath, [cliPath, '--version'], {
      encoding: 'utf8',
    });

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe('0.1.0');
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

  it('rejects conflicting read-only output modes as usage errors', () => {
    const discoverResult = spawnSync(
      process.execPath,
      [cliPath, 'discover', '--plain', '--json'],
      { encoding: 'utf8' },
    );
    const statusResult = spawnSync(
      process.execPath,
      [cliPath, 'status', '--plain', '--json'],
      { encoding: 'utf8' },
    );

    for (const result of [discoverResult, statusResult]) {
      expect(result.status).toBe(2);
      expect(result.stdout).toBe('');
      expect(result.stderr).toContain("options '--plain' and '--json' cannot be used together");
    }
  });

  it('prints exactly one Repository Report JSON document', () => {
    const isolatedHome = fs.mkdtempSync(path.join(os.tmpdir(), 'mcv-cli-repository-'));
    try {
      const result = spawnSync(process.execPath, [cliPath, 'repo', '--json'], {
        encoding: 'utf8',
        env: isolatedEnvironment(isolatedHome),
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
        [cliPath, 'bind', invalidRepository, '--yes', '--json'],
        {
          encoding: 'utf8',
          env: isolatedEnvironment(isolatedRoot),
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

  it('routes Bind and Unbind through packaged JSON Plans and Results', () => {
    const isolatedRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mcv-cli-binding-'));
    const repositoryPath = path.join(isolatedRoot, 'repository');
    const statePath = process.platform === 'darwin'
      ? path.join(isolatedRoot, 'Library', 'Application Support', 'mcv', 'config.json')
      : process.platform === 'win32'
        ? path.join(isolatedRoot, 'mcv', 'config.json')
        : path.join(isolatedRoot, '.config', 'mcv', 'config.json');
    fs.mkdirSync(repositoryPath);
    fs.writeFileSync(path.join(repositoryPath, 'mcv.yaml'), [
      'schemaVersion: 2',
      'repositoryId: process-binding-id',
      'initializedAt: 2026-07-22T00:00:00.000Z',
      'security: { scanSecrets: true, allowPlaintextSecrets: false }',
      'capture: { preserveUnknownNativeFields: true }',
      'deploy: { backupBeforeWrite: true, useSymlinks: false }',
      'targets: {}',
      'variables: {}',
      '',
    ].join('\n'));
    const invoke = (...args: string[]) => spawnSync(
      process.execPath,
      [cliPath, ...args],
      {
        encoding: 'utf8',
        env: isolatedEnvironment(isolatedRoot),
      },
    );

    try {
      const bindPlan = invoke('bind', repositoryPath, '--dry-run', '--json');
      expect(bindPlan.status).toBe(0);
      expect(bindPlan.stderr).toBe('');
      expect(JSON.parse(bindPlan.stdout)).toEqual(expect.objectContaining({
        operation: 'bind',
        status: 'planned',
        readyToApply: true,
      }));
      expect(fs.existsSync(statePath)).toBe(false);

      const bindResult = invoke('bind', repositoryPath, '--yes', '--json');
      expect(bindResult.status).toBe(0);
      expect(bindResult.stderr).toBe('');
      expect(JSON.parse(bindResult.stdout)).toEqual(expect.objectContaining({
        operation: 'bind',
        status: 'succeeded',
      }));
      expect(JSON.parse(fs.readFileSync(statePath, 'utf8'))).toMatchObject({
        repositoryPath,
        defaultRepositoryId: 'process-binding-id',
      });

      const statusReport = invoke('status', '--json');
      expect(statusReport.status).toBe(0);
      expect(statusReport.stderr).toBe('');
      expect(JSON.parse(statusReport.stdout)).toEqual(expect.objectContaining({
        operation: 'status',
        status: 'reported',
        repositoryPath,
      }));
      expect(statusReport.stdout).not.toMatch(/\u001b\[/);

      const unbindPlan = invoke('unbind', '--dry-run', '--json');
      expect(unbindPlan.status).toBe(0);
      expect(unbindPlan.stderr).toBe('');
      expect(JSON.parse(unbindPlan.stdout)).toEqual(expect.objectContaining({
        operation: 'unbind',
        status: 'planned',
        readyToApply: true,
      }));
      expect(JSON.parse(fs.readFileSync(statePath, 'utf8'))).toHaveProperty(
        'repositoryPath',
        repositoryPath,
      );

      const unbindResult = invoke('unbind', '--yes', '--json');
      expect(unbindResult.status).toBe(0);
      expect(unbindResult.stderr).toBe('');
      expect(JSON.parse(unbindResult.stdout)).toEqual(expect.objectContaining({
        operation: 'unbind',
        status: 'succeeded',
      }));
      expect(JSON.parse(fs.readFileSync(statePath, 'utf8'))).not.toHaveProperty('repositoryPath');
    } finally {
      fs.rmSync(isolatedRoot, { recursive: true, force: true });
    }
  });

  it('rejects invalid write mode combinations before running the Operation', () => {
    const conflicting = spawnSync(
      process.execPath,
      [cliPath, 'bind', '--dry-run', '--yes'],
      { encoding: 'utf8' },
    );
    const missingMode = spawnSync(
      process.execPath,
      [cliPath, 'unbind', '--json'],
      { encoding: 'utf8' },
    );

    expect(conflicting.status).toBe(2);
    expect(conflicting.stdout).toBe('');
    expect(conflicting.stderr).toContain("options '--dry-run' and '--yes' cannot be used together");
    expect(missingMode.status).toBe(2);
    expect(missingMode.stdout).toBe('');
    expect(missingMode.stderr).toContain("option '--json' requires '--dry-run' or '--yes'");
  });

  it('uses exit code 2 for unknown commands and options', () => {
    const unknownCommand = spawnSync(
      process.execPath,
      [cliPath, 'unknown-command'],
      { encoding: 'utf8' },
    );
    const unknownOption = spawnSync(
      process.execPath,
      [cliPath, 'status', '--unknown-option'],
      { encoding: 'utf8' },
    );

    for (const result of [unknownCommand, unknownOption]) {
      expect(result.status).toBe(2);
      expect(result.stdout).toBe('');
      expect(result.stderr).toMatch(/unknown option|too many arguments/);
    }
  });

  it('uses exit code 3 for a non-interactive human-decision block', () => {
    const isolatedRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mcv-cli-blocked-'));
    const repositoryPath = path.join(isolatedRoot, 'non-empty-repository');
    fs.mkdirSync(repositoryPath);
    fs.writeFileSync(path.join(repositoryPath, 'keep.txt'), 'existing content\n');
    try {
      const result = spawnSync(
        process.execPath,
        [cliPath, 'init', '--yes', '--json'],
        {
          cwd: repositoryPath,
          encoding: 'utf8',
          env: isolatedEnvironment(isolatedRoot),
        },
      );

      expect(result.status).toBe(3);
      expect(result.stderr).toBe('');
      expect(JSON.parse(result.stdout)).toEqual(expect.objectContaining({
        operation: 'init',
        status: 'blocked',
        issues: [expect.objectContaining({
          severity: 'warning',
          code: 'repository.initTargetNotEmpty',
        })],
      }));
      expect(result.stdout).not.toMatch(/\u001b\[/);
      expect(fs.existsSync(path.join(repositoryPath, 'mcv.yaml'))).toBe(false);
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
          env: isolatedEnvironment(isolatedRoot),
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
          env: isolatedEnvironment(isolatedRoot),
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
          env: isolatedEnvironment(isolatedRoot),
        },
      );

      expect(
        result.status,
        `signal=${String(result.signal)} error=${String(result.error)} stderr=${result.stderr}`,
      ).toBe(0);
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

      const applyResult = spawnSync(
        process.execPath,
        [cliPath, 'capture', '--yes', '--json'],
        {
          cwd: repositoryPath,
          encoding: 'utf8',
          env: isolatedEnvironment(isolatedRoot),
        },
      );
      expect(applyResult.status).toBe(0);
      expect(applyResult.stderr).toBe('');
      expect(JSON.parse(applyResult.stdout)).toEqual(expect.objectContaining({
        operation: 'capture',
        status: 'succeeded',
        data: expect.objectContaining({ appliedChangeIds: [expect.any(String)] }),
      }));
      expect(applyResult.stdout).not.toMatch(/\u001b\[/);
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
          env: isolatedEnvironment(isolatedRoot),
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

      const applyResult = spawnSync(
        process.execPath,
        [cliPath, 'deploy', '--yes', '--json'],
        {
          cwd: repositoryPath,
          encoding: 'utf8',
          env: isolatedEnvironment(isolatedRoot),
        },
      );
      expect(applyResult.status).toBe(0);
      expect(applyResult.stderr).toBe('');
      expect(JSON.parse(applyResult.stdout)).toEqual(expect.objectContaining({
        operation: 'deploy',
        status: 'succeeded',
        data: expect.objectContaining({ appliedChangeIds: [expect.any(String)] }),
      }));
      expect(applyResult.stdout).not.toMatch(/\u001b\[/);
      expect(fs.readFileSync(path.join(isolatedRoot, '.claude', 'CLAUDE.md'), 'utf8'))
        .toBe('# Process rules\n');
    } finally {
      fs.rmSync(isolatedRoot, { recursive: true, force: true });
    }
  });

  it('prints exactly one read-only Restore Plan JSON document', () => {
    const isolatedRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mcv-cli-restore-')));
    const targetPath = path.join(isolatedRoot, 'target', 'settings.json');
    const deployedContent = 'deployed content';
    const originalContent = 'original content';
    const stateRoot = process.platform === 'darwin'
      ? path.join(isolatedRoot, 'Library', 'Application Support', 'mcv')
      : process.platform === 'win32'
        ? path.join(isolatedRoot, 'mcv')
        : path.join(isolatedRoot, '.config', 'mcv');
    const backupDirectory = path.join(stateRoot, 'backups', 'complete');
    const backupPath = path.join('files', 'settings.json');
    const digest = (content: string): string =>
      crypto.createHash('sha256').update(content).digest('hex');
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.mkdirSync(path.join(backupDirectory, 'files'), { recursive: true });
    fs.writeFileSync(targetPath, deployedContent);
    fs.writeFileSync(path.join(backupDirectory, backupPath), originalContent);
    fs.writeFileSync(path.join(backupDirectory, 'manifest.json'), JSON.stringify({
      createdAt: '2026-07-19T00:00:00.000Z',
      status: 'complete',
      files: [{
        action: 'modify',
        originalPath: targetPath,
        backupPath,
        beforeHash: digest(originalContent),
        afterHash: digest(deployedContent),
      }],
    }));
    try {
      const result = spawnSync(
        process.execPath,
        [cliPath, 'restore', '--dry-run', '--json'],
        {
          encoding: 'utf8',
          env: isolatedEnvironment(isolatedRoot),
        },
      );

      expect(result.status).toBe(0);
      expect(result.stderr).toBe('');
      expect(JSON.parse(result.stdout)).toEqual(expect.objectContaining({
        schemaVersion: 1,
        operation: 'restore',
        status: 'planned',
        readyToApply: true,
        backup: { id: 'complete', createdAt: '2026-07-19T00:00:00.000Z' },
        changes: [expect.objectContaining({ action: 'restore', targetPath })],
      }));
      expect(result.stdout).not.toMatch(/\u001b\[/);
      expect(fs.readFileSync(targetPath, 'utf8')).toBe(deployedContent);
      expect(fs.existsSync(path.join(stateRoot, 'restore-backups'))).toBe(false);

      const applyResult = spawnSync(
        process.execPath,
        [cliPath, 'restore', '--yes', '--json'],
        {
          encoding: 'utf8',
          env: isolatedEnvironment(isolatedRoot),
        },
      );
      expect(applyResult.status).toBe(0);
      expect(applyResult.stderr).toBe('');
      expect(JSON.parse(applyResult.stdout)).toEqual(expect.objectContaining({
        operation: 'restore',
        status: 'succeeded',
        data: expect.objectContaining({ appliedChangeIds: [expect.any(String)] }),
      }));
      expect(applyResult.stdout).not.toMatch(/\u001b\[/);
      expect(fs.readFileSync(targetPath, 'utf8')).toBe(originalContent);
    } finally {
      fs.rmSync(isolatedRoot, { recursive: true, force: true });
    }
  });

  it.skipIf(process.platform !== 'darwin' || !fs.existsSync('/usr/bin/expect'))('exits 130 when Ctrl+C interrupts Restore before Apply', async () => {
    const isolatedRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mcv-cli-restore-interrupt-')));
    const targetPath = path.join(isolatedRoot, 'target', 'settings.json');
    const deployedContent = 'deployed content';
    const originalContent = 'original content';
    const stateRoot = process.platform === 'darwin'
      ? path.join(isolatedRoot, 'Library', 'Application Support', 'mcv')
      : path.join(isolatedRoot, '.config', 'mcv');
    const backupDirectory = path.join(stateRoot, 'backups', 'complete');
    const digest = (content: string): string =>
      crypto.createHash('sha256').update(content).digest('hex');
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.mkdirSync(path.join(backupDirectory, 'files'), { recursive: true });
    fs.writeFileSync(targetPath, deployedContent);
    fs.writeFileSync(path.join(backupDirectory, 'files', 'settings.json'), originalContent);
    fs.writeFileSync(path.join(backupDirectory, 'manifest.json'), JSON.stringify({
      createdAt: '2026-07-19T00:00:00.000Z',
      status: 'complete',
      files: [{
        action: 'modify',
        originalPath: targetPath,
        backupPath: 'files/settings.json',
        beforeHash: digest(originalContent),
        afterHash: digest(deployedContent),
      }],
    }));
    try {
      const outcome = await new Promise<{ code: number | null; output: string }>((resolve, reject) => {
        const child = spawn('/usr/bin/expect', ['-c', [
          'set timeout 3',
          'log_user 1',
          'spawn $env(MCV_TEST_NODE) $env(MCV_TEST_CLI) restore',
          'expect -exact {Restore every file in this Plan? [y/N] }',
          'send "\\003"',
          'expect eof',
          'set result [wait]',
          'exit [lindex $result 3]',
        ].join('\n')], {
          env: {
            ...process.env,
            HOME: isolatedRoot,
            APPDATA: isolatedRoot,
            MCV_TEST_NODE: process.execPath,
            MCV_TEST_CLI: cliPath,
          },
          stdio: ['pipe', 'pipe', 'pipe'],
        });
        let output = '';
        const timeout = setTimeout(() => {
          child.kill('SIGKILL');
          reject(new Error(`Timed out waiting for Restore prompt. Output: ${output}`));
        }, 4_000);
        const collect = (chunk: Buffer): void => {
          output += chunk.toString('utf8');
        };
        child.stdout.on('data', collect);
        child.stderr.on('data', collect);
        child.once('error', (error) => {
          clearTimeout(timeout);
          reject(error);
        });
        child.once('exit', (code) => {
          clearTimeout(timeout);
          resolve({ code, output });
        });
      });

      expect(outcome).toMatchObject({ code: 130, output: expect.stringContaining('restore.cancelled') });
      expect(fs.readFileSync(targetPath, 'utf8')).toBe(deployedContent);
      expect(fs.existsSync(path.join(stateRoot, 'restore-backups'))).toBe(false);
    } finally {
      fs.rmSync(isolatedRoot, { recursive: true, force: true });
    }
  }, 5_000);

  it('rejects Restore JSON without dry-run and exposes no force bypass', () => {
    const invalid = spawnSync(process.execPath, [cliPath, 'restore', '--json'], {
      encoding: 'utf8',
    });
    const help = spawnSync(process.execPath, [cliPath, 'restore', '--help'], {
      encoding: 'utf8',
    });

    expect(invalid.status).toBe(2);
    expect(invalid.stdout).toBe('');
    expect(invalid.stderr).toContain("option '--json' requires '--dry-run'");
    expect(help.status).toBe(0);
    expect(help.stdout).not.toMatch(/force|selection/i);
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
          env: isolatedEnvironment(isolatedRoot),
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
