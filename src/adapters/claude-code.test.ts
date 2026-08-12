import * as fs from 'fs';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DeployRequest } from '../assets/deploy-request.js';
import type { SelectedRepositoryView } from '../assets/selected-repository-view.js';
import { ClaudeCodeAdapter } from './claude-code.js';
import { parse as parseYaml } from 'yaml';

describe('ClaudeCodeAdapter', () => {
  it('declares its per-Skill projection surface as macOS-link capable', () => {
    const adapter = new ClaudeCodeAdapter();
    expect(adapter.skillSurfaces).toEqual([expect.objectContaining({ id: 'claude-code' })]);
    expect(adapter.skillSurfaces[0].destinationRoot({
      homeDir: '/Users/test',
      platform: 'darwin',
      env: {},
    })).toBe(path.join('/Users/test', '.claude', 'skills'));
    expect(adapter.skillSurfaces[0].supportsManagedDirectoryLinks('darwin')).toBe(true);
    expect(adapter.skillSurfaces[0].supportsManagedDirectoryLinks('win32')).toBe(false);
  });

  let homeDir: string;

  beforeEach(() => {
    homeDir = fs.mkdtempSync(path.join(process.cwd(), '.mcv-claude-adapter-test-'));
  });

  afterEach(() => {
    fs.rmSync(homeDir, { recursive: true, force: true });
  });

  it('detects Claude Code from user configuration and reports known config paths', async () => {
    const claudeDir = path.join(homeDir, '.claude');
    fs.mkdirSync(claudeDir);
    fs.writeFileSync(path.join(claudeDir, 'settings.json'), '{}');

    const adapter = new ClaudeCodeAdapter();
    const context = { homeDir, platform: 'darwin' as const, env: {} };

    await expect(adapter.detect(context)).resolves.toEqual({
      id: 'claude-code',
      name: 'Claude Code',
      detected: true,
      configDirectories: [
        {
          id: 'config-root',
          path: path.join(homeDir, '.claude'),
          exists: true,
        },
      ],
    });
    await expect(adapter.discoverFiles(context)).resolves.toEqual([
      {
        id: 'user-settings',
        path: path.join(homeDir, '.claude', 'settings.json'),
        exists: true,
      },
      {
        id: 'user-instructions',
        path: path.join(homeDir, '.claude', 'CLAUDE.md'),
        exists: false,
      },
      {
        id: 'user-state',
        path: path.join(homeDir, '.claude.json'),
        exists: false,
      },
    ]);
  });

  it('detects a Claude Code executable before any config file exists', async () => {
    const binDir = path.join(homeDir, 'bin');
    fs.mkdirSync(binDir);
    fs.writeFileSync(path.join(binDir, 'claude.cmd'), '');

    const adapter = new ClaudeCodeAdapter();

    await expect(
      adapter.detect({
        homeDir,
        platform: 'win32',
        env: {},
        pathEnv: binDir,
        pathExt: '.CMD',
      }),
    ).resolves.toMatchObject({ detected: true });
  });

  it('detects Claude Code from its configuration directory alone', async () => {
    fs.mkdirSync(path.join(homeDir, '.claude'));

    const adapter = new ClaudeCodeAdapter();

    await expect(
      adapter.detect({ homeDir, platform: 'darwin', env: {}, pathEnv: '' }),
    ).resolves.toMatchObject({ detected: true });
    await expect(adapter.detect({ homeDir, platform: 'darwin', env: {}, pathEnv: '' })).resolves.toMatchObject({
      configDirectories: [
        {
          id: 'config-root',
          path: path.join(homeDir, '.claude'),
          exists: true,
        },
      ],
    });
  });

  it('does not treat a directory on PATH as the Claude Code executable', async () => {
    const binDir = path.join(homeDir, 'bin');
    fs.mkdirSync(path.join(binDir, 'claude.cmd'), { recursive: true });

    const adapter = new ClaudeCodeAdapter();

    await expect(
      adapter.detect({
        homeDir,
        platform: 'win32',
        env: {},
        pathEnv: binDir,
        pathExt: '.CMD',
      }),
    ).resolves.toMatchObject({ detected: false });
  });

  it('separates managed MCP data from native Claude Code settings during capture', async () => {
    const claudeDir = path.join(homeDir, '.claude');
    fs.mkdirSync(claudeDir);
    fs.writeFileSync(
      path.join(claudeDir, 'settings.json'),
      JSON.stringify({
        theme: 'dark',
        mcpServers: {
          local: {
            command: path.join(homeDir, '工具', 'server.exe'),
            env: { accessToken: 'real-token' },
          },
        },
      }),
    );

    const adapter = new ClaudeCodeAdapter();
    const context = { homeDir, platform: 'win32' as const, env: {} };
    const result = await adapter.capture(
      await adapter.discoverFiles(context),
      context,
    );

    const nativeSettings = result.files.find(
      (file) => file.repositoryPath === 'ide/claude-code/native/settings.json',
    );
    const mcpRegistry = result.files.find(
      (file) => file.repositoryPath === 'common/mcp.yaml',
    );

    expect(JSON.parse(nativeSettings?.content.toString() ?? '')).toEqual({ theme: 'dark' });
    expect(parseYaml(mcpRegistry?.content.toString() ?? '')).toEqual({
      servers: {
        local: {
          command: '${HOME}\\工具\\server.exe',
          env: { accessToken: 'real-token' },
          transport: 'stdio',
        },
      },
    });
    expect(result.summary).toEqual({
      fileCount: 2,
      parameterizedPathCount: 1,
      excludedFileCount: 0,
    });
  });

  it('preserves undeclared Claude state as native while excluding declared local fields', async () => {
    fs.writeFileSync(
      path.join(homeDir, '.claude.json'),
      JSON.stringify({
        customPreference: { compactMode: true },
        projects: { [homeDir]: { hasTrustDialogAccepted: true } },
      }),
    );

    const adapter = new ClaudeCodeAdapter();
    const context = { homeDir, platform: 'darwin' as const, env: {} };
    const result = await adapter.capture(
      await adapter.discoverFiles(context),
      context,
    );
    const nativeState = result.files.find(
      (file) => file.repositoryPath === 'ide/claude-code/native/.claude.json',
    );

    expect(JSON.parse(nativeState?.content.toString() ?? '')).toEqual({
      customPreference: { compactMode: true },
    });
  });

  it('projects IDE Instructions as a Managed Block for project scope', async () => {
    const projectRoot = path.join(homeDir, 'project');
    fs.mkdirSync(projectRoot, { recursive: true });
    const adapter = new ClaudeCodeAdapter();
    const context = { homeDir, platform: 'darwin' as const, env: {} };
    const view: SelectedRepositoryView = {
      instructions: { 'claude-code': { id: 'instruction:claude-code', content: '# Rules\n' } },
      skills: [],
      mcpServers: {},
      mcpOverrides: {},
      nativeAssets: new Map(),
    };
    const operation = await adapter.project(view, {
      ...projectRequest(),
      targetRoot: projectRoot,
    }, context);
    expect(operation.files).toEqual([expect.objectContaining({
      targetPath: path.join(projectRoot, 'CLAUDE.md'),
      content: '# Rules\n',
    })]);
  });

  it('projects selected native settings for global scope', async () => {
    const claudeDir = path.join(homeDir, '.claude');
    fs.mkdirSync(claudeDir);
    fs.writeFileSync(path.join(claudeDir, 'settings.json'), JSON.stringify({ theme: 'local' }));
    const adapter = new ClaudeCodeAdapter();
    const context = { homeDir, platform: 'darwin' as const, env: {} };
    const view: SelectedRepositoryView = {
      instructions: {},
      skills: [],
      mcpServers: {},
      mcpOverrides: {},
      nativeAssets: new Map([
        ['native:claude-code/user-settings', Buffer.from(JSON.stringify({ theme: 'repo' }))],
      ]),
    };
    const operation = await adapter.project(view, globalRequest(homeDir), context);
    const settings = operation.files.find(
      (file) => file.targetPath === path.join(claudeDir, 'settings.json'),
    );
    expect(JSON.parse(settings?.content.toString() ?? '')).toEqual({ theme: 'repo' });
  });
});

function emptyView(): SelectedRepositoryView {
  return { instructions: {}, skills: [], mcpServers: {}, mcpOverrides: {}, nativeAssets: new Map() };
}

function projectRequest(): DeployRequest {
  return {
    scope: 'project',
    targetRoot: '/tmp/project',
    profileIds: [],
    selection: { profileIds: [], profilesRevision: '', catalogRevision: '', assetIds: [] },
  };
}

function globalRequest(targetRoot: string): DeployRequest {
  return { ...projectRequest(), scope: 'global', targetRoot };
}
