import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as yaml from 'yaml';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DeviceContext } from '../adapters/types.js';
import { readState, writeState } from '../utils/state.js';

const profilesWriteControl = vi.hoisted(() => ({ failNext: false }));

vi.mock('../profiles/store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../profiles/store.js')>();
  return {
    ...actual,
    writeProfilesDocument(
      repositoryPath: string,
      document: Parameters<typeof actual.writeProfilesDocument>[1],
    ) {
      if (profilesWriteControl.failNext) {
        profilesWriteControl.failNext = false;
        throw new Error('forced profiles write failure');
      }
      return actual.writeProfilesDocument(repositoryPath, document);
    },
  };
});

import { applyMigrationPlan, createMigrationPlan } from './repository.js';
import { writeProfilesDocument } from '../profiles/store.js';

describe('Repository migration rollback', () => {
  let testRoot: string;
  let homeDir: string;
  let context: DeviceContext;

  beforeEach(() => {
    testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mcv-migration-rollback-'));
    homeDir = path.join(testRoot, 'home');
    fs.mkdirSync(homeDir);
    context = {
      homeDir,
      platform: 'win32',
      env: { APPDATA: homeDir },
      pathEnv: '',
    };
    profilesWriteControl.failNext = false;
  });

  afterEach(() => {
    fs.rmSync(testRoot, { recursive: true, force: true });
  });

  it('rolls back a failed v4 migration completely and remains safely re-runnable', () => {
    const repositoryPath = createV4Repository(testRoot, 'migration-v4-rollback');
    const manifestBefore = fs.readFileSync(path.join(repositoryPath, 'mcv.yaml'), 'utf8');
    const agentsBefore = fs.readFileSync(path.join(repositoryPath, 'common', 'AGENTS.md'));
    const profilesBefore = fs.readFileSync(path.join(repositoryPath, 'profiles.yaml'), 'utf8');
    writeState(context, {
      schemaVersion: 2,
      deviceId: 'device-id',
      managedInventory: {
        [path.join(homeDir, '.codex', 'config.toml')]: { source: repositoryPath, hash: 'hash' },
      },
    });
    const plan = createMigrationPlan(context, repositoryPath);
    profilesWriteControl.failNext = true;

    const result = applyMigrationPlan(context, plan);

    expect(result).toMatchObject({
      status: 'failed',
      error: { code: 'repository.migrationFailed' },
    });
    expect(fs.readFileSync(path.join(repositoryPath, 'mcv.yaml'), 'utf8')).toBe(manifestBefore);
    expect(fs.readFileSync(path.join(repositoryPath, 'profiles.yaml'), 'utf8')).toBe(profilesBefore);
    expect(fs.readFileSync(path.join(repositoryPath, 'common', 'AGENTS.md'))).toEqual(agentsBefore);
    expect(readState(context)).toEqual({
      schemaVersion: 2,
      deviceId: 'device-id',
      managedInventory: {
        [path.join(homeDir, '.codex', 'config.toml')]: { source: repositoryPath, hash: 'hash' },
      },
    });

    const retry = applyMigrationPlan(context, createMigrationPlan(context, repositoryPath));
    expect(retry).toMatchObject({
      status: 'succeeded',
      data: { previousSchemaVersion: 4, repositorySchemaVersion: 5 },
    });
    expect(yaml.parse(fs.readFileSync(path.join(repositoryPath, 'profiles.yaml'), 'utf8')).profiles.global.assets).toEqual([
      'instruction:claude-code',
      'instruction:codex',
      'instruction:gemini',
      'skill:code-review',
    ]);
  });
});

function createV4Repository(root: string, name: string): string {
  const repositoryPath = path.join(root, name);
  fs.mkdirSync(path.join(repositoryPath, 'common', 'skills', 'code-review'), { recursive: true });
  fs.mkdirSync(path.join(repositoryPath, 'ide', 'codex', 'native'), { recursive: true });
  fs.writeFileSync(path.join(repositoryPath, 'mcv.yaml'), yaml.stringify({
    schemaVersion: 4,
    repositoryId: `${name}-id`,
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
  fs.writeFileSync(path.join(repositoryPath, 'common', 'AGENTS.md'), '# Canonical rules\n');
  fs.writeFileSync(
    path.join(repositoryPath, 'common', 'skills', 'code-review', 'SKILL.md'),
    '---\nname: code-review\ndescription: Review pull requests\n---\n# Review\n',
  );
  fs.writeFileSync(path.join(repositoryPath, 'common', 'mcp.yaml'), yaml.stringify({
    servers: {
      context7: { command: 'npx', args: ['-y', '@upstash/context7-mcp'], transport: 'stdio' },
    },
  }));
  fs.writeFileSync(path.join(repositoryPath, 'ide', 'codex', 'native', 'config.toml'), 'model = "gpt"\n');
  writeProfilesDocument(repositoryPath, {
    schemaVersion: 1,
    profiles: {
      global: { assets: ['rule:canonical', 'skill:code-review'] },
    },
  });
  return repositoryPath;
}
