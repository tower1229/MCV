import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawn, spawnSync } from 'child_process';
import { describe, expect, it } from 'vitest';
import { writeProfilesDocument } from './profiles/store.js';
import { seedGlobalProfileWithCatalog } from './operations/deploy-request-helpers.js';

const cliPath = path.join(process.cwd(), 'dist', 'index.js');
const packagePath = path.join(process.cwd(), 'package.json');

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

describe('packaged mcv CLI', { timeout: 120_000 }, () => {
  it('ships one native ESM CLI entry', () => {
    const packageMetadata = JSON.parse(fs.readFileSync(packagePath, 'utf8')) as {
      type?: string;
    };
    const cliSource = fs.readFileSync(cliPath, 'utf8');

    expect(packageMetadata.type).toBe('module');
    expect(cliSource).toMatch(/^#!\/usr\/bin\/env node\s+import /);
    expect(cliSource).toContain('import.meta.url');
    expect(cliSource).not.toMatch(/\brequire\s*\(|\bmodule\.exports\b|\bexports\./);
  });

  it('prints the Overview and succeeds when invoked without arguments outside a TTY', () => {
    const isolatedRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mcv-cli-overview-')));
    const repositoryPath = path.join(isolatedRoot, 'repository');
    fs.mkdirSync(repositoryPath);
    fs.writeFileSync(path.join(repositoryPath, 'mcv.yaml'), [
      'schemaVersion: 4',
      'repositoryId: cli-overview-test',
      'initializedAt: 2026-08-10T00:00:00.000Z',
      'targets: { codex: { enabled: true } }',
      'variables: {}',
      'capture: { preserveUnknownNativeFields: true }',
      'deploy: { backupBeforeWrite: true, useSymlinks: false }',
      '',
    ].join('\n'));
    writeProfilesDocument(repositoryPath, { schemaVersion: 1, profiles: { global: { assets: [] } } });
    try {
      const result = spawnSync(process.execPath, [cliPath], {
        cwd: repositoryPath,
        encoding: 'utf8',
        env: isolatedEnvironment(isolatedRoot),
      });

      expect(result.status).toBe(0);
      expect(result.stdout).toContain('Repository:');
      expect(result.stdout).not.toContain('Usage: mcv [options] [command]');
      expect(result.stderr).toBe('');

      const missingProfile = spawnSync(process.execPath, [cliPath, 'deploy'], {
        cwd: repositoryPath,
        encoding: 'utf8',
        env: isolatedEnvironment(isolatedRoot),
      });
      expect(missingProfile.status).toBe(2);
    } finally {
      fs.rmSync(isolatedRoot, { recursive: true, force: true });
    }
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
    const packageMetadata = JSON.parse(fs.readFileSync(packagePath, 'utf8')) as {
      version: string;
    };
    const result = spawnSync(process.execPath, [cliPath, '--version'], {
      encoding: 'utf8',
    });

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe(packageMetadata.version);
    expect(result.stderr).toBe('');
  });

  it('prints exactly one Environment Report JSON document', () => {
    const result = spawnSync(process.execPath, [cliPath, 'discover', '--json'], {
      encoding: 'utf8',
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(JSON.parse(result.stdout)).toEqual(expect.objectContaining({
      schemaVersion: 3,
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
        schemaVersion: 3,
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
        schemaVersion: 3,
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
      'schemaVersion: 4',
      'repositoryId: process-binding-id',
      'initializedAt: 2026-07-22T00:00:00.000Z',
      'capture: { preserveUnknownNativeFields: true }',
      'deploy: { backupBeforeWrite: true, useSymlinks: false }',
      'targets: {}',
      'variables: {}',
      '',
    ].join('\n'));
    seedGlobalProfileWithCatalog(repositoryPath);
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
  }, 120_000);

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

  it('rejects forced Capture TUI outside a TTY and conflicting TUI overrides', () => {
    const unavailable = spawnSync(
      process.execPath,
      [cliPath, 'capture', '--tui'],
      { encoding: 'utf8' },
    );
    const conflicting = spawnSync(
      process.execPath,
      [cliPath, 'capture', '--tui', '--no-tui'],
      { encoding: 'utf8' },
    );

    expect(unavailable.status).toBe(2);
    expect(unavailable.stderr).toContain('requires an interactive terminal');
    expect(conflicting.status).toBe(2);
    expect(conflicting.stderr).toContain("options '--tui' and '--no-tui' cannot be used together");
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
        schemaVersion: 3,
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
        schemaVersion: 3,
        operation: 'migrate',
        status: 'succeeded',
        repositoryPath: resolvedRepositoryPath,
        data: expect.objectContaining({
          previousSchemaVersion: 1,
          repositorySchemaVersion: 4,
          backupVerified: true,
        }),
      }));
      expect(fs.readFileSync(path.join(repositoryPath, 'mcv.yaml'), 'utf8')).toContain('schemaVersion: 4');
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
      'schemaVersion: 4',
      'repositoryId: process-capture-id',
      'initializedAt: 2026-07-22T00:00:00.000Z',
      'capture: { preserveUnknownNativeFields: true }',
      'deploy: { backupBeforeWrite: true, useSymlinks: false }',
      'targets:',
      '  claudeCode:',
      '    enabled: true',
      'variables: {}',
      '',
    ].join('\n'));
    writeProfilesDocument(repositoryPath, {
      schemaVersion: 1,
      profiles: { global: { assets: [] } },
    });
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
        schemaVersion: 3,
        operation: 'capture',
        status: 'planned',
        repositoryPath: resolvedRepositoryPath,
        changes: [expect.objectContaining({
          id: expect.any(String),
          ide: 'claude-code',
          itemType: 'file',
        })],
      }));
      expect(result.stdout).toContain('process-secret-must-not-leak');
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
      expect(fs.readFileSync(
        path.join(repositoryPath, 'ide', 'claude-code', 'native', 'settings.json'),
        'utf8',
      )).toContain('process-secret-must-not-leak');
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
      'schemaVersion: 4',
      'repositoryId: process-deploy-id',
      'initializedAt: 2026-07-22T00:00:00.000Z',
      'capture: { preserveUnknownNativeFields: true }',
      'deploy: { backupBeforeWrite: true, useSymlinks: false }',
      'targets:',
      '  claudeCode:',
      '    enabled: true',
      'variables: {}',
      '',
    ].join('\n'));
    fs.writeFileSync(path.join(repositoryPath, 'common', 'AGENTS.md'), '# Process rules\n');
    seedGlobalProfileWithCatalog(repositoryPath);
    try {
      const result = spawnSync(
        process.execPath,
        [cliPath, 'deploy', '--global', '--dry-run', '--json'],
        {
          cwd: repositoryPath,
          encoding: 'utf8',
          env: isolatedEnvironment(isolatedRoot),
        },
      );

      expect(result.status).toBe(0);
      expect(result.stderr).toBe('');
      expect(JSON.parse(result.stdout)).toEqual(expect.objectContaining({
        schemaVersion: 3,
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
        [cliPath, 'deploy', '--global', '--yes', '--json'],
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

  it('reports and applies a matching external Skill link through the packaged CLI', () => {
    const isolatedRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mcv-cli-linked-skill-')));
    const repositoryPath = path.join(isolatedRoot, 'repository');
    const sourceSkill = path.join(repositoryPath, 'common', 'skills', 'review', 'SKILL.md');
    const externalRoot = path.join(isolatedRoot, 'external-skills');
    const externalSkill = path.join(externalRoot, 'review', 'SKILL.md');
    const linkedRoot = path.join(isolatedRoot, '.claude', 'skills');
    fs.mkdirSync(path.dirname(sourceSkill), { recursive: true });
    fs.mkdirSync(path.dirname(externalSkill), { recursive: true });
    fs.mkdirSync(path.dirname(linkedRoot), { recursive: true });
    fs.writeFileSync(path.join(repositoryPath, 'mcv.yaml'), [
      'schemaVersion: 4',
      'repositoryId: process-linked-skill-id',
      'initializedAt: 2026-07-29T00:00:00.000Z',
      'capture: { preserveUnknownNativeFields: true }',
      'deploy: { backupBeforeWrite: true, useSymlinks: false }',
      'targets:',
      '  claudeCode:',
      '    enabled: true',
      'variables: {}',
      '',
    ].join('\n'));
    fs.writeFileSync(sourceSkill, '# Review\n');
    fs.writeFileSync(externalSkill, '# Review\n');
    fs.symlinkSync(externalRoot, linkedRoot, process.platform === 'win32' ? 'junction' : 'dir');
    seedGlobalProfileWithCatalog(repositoryPath);
    try {
      const overviewResult = spawnSync(process.execPath, [cliPath], {
        cwd: repositoryPath,
        encoding: 'utf8',
        env: isolatedEnvironment(isolatedRoot),
      });
      const plainStatusResult = spawnSync(process.execPath, [cliPath, 'status', '--plain'], {
        cwd: repositoryPath,
        encoding: 'utf8',
        env: isolatedEnvironment(isolatedRoot),
      });
      expect(overviewResult.status).toBe(0);
      expect(plainStatusResult.status).toBe(0);
      expect(overviewResult.stdout).toBe(plainStatusResult.stdout);
      expect(plainStatusResult.stdout).toContain(
        'Linked Skills: ✓ 1 package matches through existing local links · no action required',
      );
      expect(plainStatusResult.stdout).toContain('Coverage: Claude Code 1');
      expect(plainStatusResult.stdout).not.toContain('✓ review · Claude Code · Already matches');
      expect(plainStatusResult.stderr).toBe('');

      const verboseStatusResult = spawnSync(process.execPath, [cliPath, 'status', '--verbose'], {
        cwd: repositoryPath,
        encoding: 'utf8',
        env: isolatedEnvironment(isolatedRoot),
      });
      expect(verboseStatusResult.status).toBe(0);
      expect(verboseStatusResult.stdout).toContain('✓ review · Claude Code · Already matches');
      expect(verboseStatusResult.stdout).toContain(linkedRoot);
      expect(verboseStatusResult.stdout).toContain(externalRoot);
      expect(verboseStatusResult.stdout).toContain('1 expected file placement verified');
      expect(verboseStatusResult.stderr).toBe('');

      const jsonStatusResult = spawnSync(process.execPath, [cliPath, 'status', '--json'], {
        cwd: repositoryPath,
        encoding: 'utf8',
        env: isolatedEnvironment(isolatedRoot),
      });
      expect(jsonStatusResult.status).toBe(0);
      expect(JSON.parse(jsonStatusResult.stdout)).toMatchObject({
        schemaVersion: 3,
        operation: 'status',
        linkFacts: [expect.objectContaining({
          packageNames: ['review'],
          affectedFileCount: 1,
        })],
      });
      expect(jsonStatusResult.stdout).not.toMatch(/\u001b\[/);

      const planResult = spawnSync(
        process.execPath,
        [cliPath, 'deploy', '--global', '--dry-run', '--json'],
        {
          cwd: repositoryPath,
          encoding: 'utf8',
          env: isolatedEnvironment(isolatedRoot),
        },
      );

      expect(planResult.status).toBe(0);
      expect(planResult.stderr).toBe('');
      const plan = JSON.parse(planResult.stdout);
      expect(plan).toMatchObject({
        operation: 'deploy',
        status: 'planned',
        readyToApply: true,
        changes: [],
        linkOutcomes: [expect.objectContaining({
          status: 'satisfied-via-link',
          ownership: 'external',
          scope: 'shared-link-root',
          ide: 'claude-code',
          surface: 'claude-code',
          linkPath: linkedRoot,
          resolvedPath: externalRoot,
          packageNames: ['review'],
          affectedFileCount: 1,
        })],
        issues: [expect.objectContaining({
          severity: 'notice',
          message: expect.stringContaining('Satisfied via link'),
        })],
      });

      const applyResult = spawnSync(
        process.execPath,
        [cliPath, 'deploy', '--global', '--yes', '--json'],
        {
          cwd: repositoryPath,
          encoding: 'utf8',
          env: isolatedEnvironment(isolatedRoot),
        },
      );
      expect(applyResult.status).toBe(0);
      expect(JSON.parse(applyResult.stdout)).toMatchObject({
        operation: 'deploy',
        status: 'succeeded',
        data: { appliedChangeIds: [], writtenPaths: [], deletedPaths: [] },
      });
      expect(fs.readFileSync(externalSkill, 'utf8')).toBe('# Review\n');
    } finally {
      fs.rmSync(isolatedRoot, { recursive: true, force: true });
    }
  });

  it.skipIf(process.platform !== 'darwin')(
    'materializes and projects one Skill through the packaged CLI',
    () => {
      const isolatedRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mcv-cli-managed-skill-')));
      const repositoryPath = path.join(isolatedRoot, 'repository');
      const sourceSkill = path.join(repositoryPath, 'common', 'skills', 'review', 'SKILL.md');
      const storeSkill = path.join(isolatedRoot, '.agents', 'skills', 'review', 'SKILL.md');
      const projection = path.join(isolatedRoot, '.claude', 'skills', 'review');
      fs.mkdirSync(path.dirname(sourceSkill), { recursive: true });
      fs.writeFileSync(path.join(repositoryPath, 'mcv.yaml'), [
        'schemaVersion: 4',
        'repositoryId: process-managed-skill-id',
        'initializedAt: 2026-07-30T00:00:00.000Z',
        'capture: { preserveUnknownNativeFields: true }',
        'deploy: { backupBeforeWrite: true, useSymlinks: true }',
        'targets:',
        '  codex:',
        '    enabled: true',
        '  claudeCode:',
        '    enabled: true',
        'variables: {}',
        '',
      ].join('\n'));
      fs.writeFileSync(sourceSkill, '# Review\n');
      seedGlobalProfileWithCatalog(repositoryPath);
      try {
        const planResult = spawnSync(
          process.execPath,
          [cliPath, 'deploy', '--global', '--dry-run', '--json'],
          {
            cwd: repositoryPath,
            encoding: 'utf8',
            env: isolatedEnvironment(isolatedRoot),
          },
        );
        expect(planResult.status).toBe(0);
        expect(JSON.parse(planResult.stdout).changes).toEqual(expect.arrayContaining([
          expect.objectContaining({
            targetPath: storeSkill,
            deploymentKind: 'physical-materialization',
          }),
          expect.objectContaining({
            targetPath: projection,
            ide: 'claude-code',
            surface: 'claude-code',
            deploymentKind: 'managed-link-projection',
          }),
        ]));

        const applyResult = spawnSync(
          process.execPath,
          [cliPath, 'deploy', '--global', '--yes', '--json'],
          {
            cwd: repositoryPath,
            encoding: 'utf8',
            env: isolatedEnvironment(isolatedRoot),
          },
        );
        expect(applyResult.status).toBe(0);
        expect(JSON.parse(applyResult.stdout)).toMatchObject({
          status: 'succeeded',
          data: { projectionPaths: [projection] },
        });
        expect(fs.readFileSync(storeSkill, 'utf8')).toBe('# Review\n');
        expect(fs.lstatSync(projection).isSymbolicLink()).toBe(true);

        const satisfiedResult = spawnSync(
          process.execPath,
          [cliPath, 'deploy', '--global', '--yes', '--json'],
          {
            cwd: repositoryPath,
            encoding: 'utf8',
            env: isolatedEnvironment(isolatedRoot),
          },
        );
        expect(satisfiedResult.status).toBe(0);
        expect(JSON.parse(satisfiedResult.stdout)).toMatchObject({
          status: 'succeeded',
          linkOutcomes: [expect.objectContaining({
            status: 'satisfied-via-link',
            ownership: 'managed',
            ide: 'claude-code',
            surface: 'claude-code',
            linkPath: projection,
          })],
        });
      } finally {
        fs.rmSync(isolatedRoot, { recursive: true, force: true });
      }
    },
  );

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
    const repositoryPath = path.join(isolatedRoot, 'repository');
    const backupPath = path.join('files', 'settings.json');
    const digest = (content: string): string =>
      crypto.createHash('sha256').update(content).digest('hex');
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.mkdirSync(path.join(backupDirectory, 'files'), { recursive: true });
    fs.mkdirSync(repositoryPath);
    fs.writeFileSync(path.join(repositoryPath, 'mcv.yaml'), [
      'schemaVersion: 4',
      'repositoryId: restore-interrupt-id',
      'initializedAt: 2026-07-27T00:00:00.000Z',
      'capture: { preserveUnknownNativeFields: true }',
      'deploy: { backupBeforeWrite: true, useSymlinks: false }',
      'targets: {}',
      'variables: {}',
      '',
    ].join('\n'));
    fs.writeFileSync(path.join(stateRoot, 'config.json'), `${JSON.stringify({
      schemaVersion: 3,
      repositoryPath,
      defaultRepositoryId: 'restore-interrupt-id',
    }, null, 2)}\n`);
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
        [cliPath, 'restore', '--global', '--dry-run', '--json'],
        {
          encoding: 'utf8',
          env: isolatedEnvironment(isolatedRoot),
        },
      );

      expect(result.status).toBe(0);
      expect(result.stderr).toBe('');
      expect(JSON.parse(result.stdout)).toEqual(expect.objectContaining({
        schemaVersion: 3,
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
        [cliPath, 'restore', '--global', '--yes', '--json'],
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
    const projectRoot = path.join(isolatedRoot, 'project');
    const targetPath = path.join(projectRoot, 'settings.json');
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
      scope: 'project',
      targetRoot: projectRoot,
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
          'expect -exact {Restore Latest Deployment · Review}',
          'send "\\003"',
          'expect eof',
          'set result [wait]',
          'exit [lindex $result 3]',
        ].join('\n')], {
          cwd: projectRoot,
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
      expect(result.stdout).toContain('Invalid YAML configuration.');
      expect(result.stdout).not.toContain('invalid-log-secret-must-not-leak');
      expect(fs.readFileSync(path.join(repositoryPath, 'mcv.yaml'), 'utf8')).toContain(
        'invalid-log-secret-must-not-leak',
      );
    } finally {
      fs.rmSync(isolatedRoot, { recursive: true, force: true });
    }
  });
});
