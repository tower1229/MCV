import * as fs from 'fs';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parse as parseToml } from 'smol-toml';
import { parse as parseYaml } from 'yaml';
import type { DeployRequest } from '../assets/deploy-request.js';
import type { SelectedRepositoryView } from '../assets/selected-repository-view.js';
import { CodexAdapter } from './codex.js';

describe('CodexAdapter', () => {
  it('declares the conventional Agent Skills surface as macOS-link capable', () => {
    const adapter = new CodexAdapter();
    expect(adapter.skillSurfaces).toEqual([expect.objectContaining({ id: 'codex' })]);
    expect(adapter.skillSurfaces[0].destinationRoot({
      homeDir: '/Users/test',
      platform: 'darwin',
      env: {},
    })).toBe(path.join('/Users/test', '.agents', 'skills'));
    expect(adapter.skillSurfaces[0].supportsManagedDirectoryLinks('darwin')).toBe(true);
    expect(adapter.skillSurfaces[0].supportsManagedDirectoryLinks('win32')).toBe(false);
  });

  let homeDir: string;

  beforeEach(() => {
    homeDir = fs.mkdtempSync(path.join(process.cwd(), '.mcv-codex-adapter-test-'));
  });

  afterEach(() => {
    fs.rmSync(homeDir, { recursive: true, force: true });
  });

  it('discovers and separates Codex managed, native, and local configuration', async () => {
    const codexRoot = path.join(homeDir, '.codex');
    fs.mkdirSync(codexRoot);
    fs.writeFileSync(
      path.join(codexRoot, 'config.toml'),
      [
        'model = "gpt-5"',
        '[projects."C:/local/project"]',
        'trust_level = "trusted"',
        '[mcp_servers.local]',
        `command = "${path.join(homeDir, 'bin', 'server.exe').replace(/\\/g, '\\\\')}"`,
        '[mcp_servers.local.env]',
        'API_TOKEN = "real-token"',
        '',
      ].join('\n'),
    );
    fs.writeFileSync(path.join(codexRoot, 'AGENTS.md'), '# Rules\n');
    const adapter = new CodexAdapter();
    const context = { homeDir, platform: 'win32' as const, env: {} };

    await expect(adapter.detect(context)).resolves.toMatchObject({
      id: 'codex',
      name: 'Codex',
      detected: true,
    });
    const result = await adapter.capture(await adapter.discoverFiles(context), context);
    const native = result.files.find(
      (file) => file.repositoryPath === 'ide/codex/native/config.toml',
    );
    const mcp = result.files.find((file) => file.repositoryPath === 'common/mcp.yaml');

    expect(parseToml(native?.content.toString() ?? '')).toEqual({ model: 'gpt-5' });
    expect(parseYaml(mcp?.content.toString() ?? '')).toEqual({
      servers: {
        local: {
          command: '${HOME}\\bin\\server.exe',
          env: { API_TOKEN: 'real-token' },
          transport: 'stdio',
        },
      },
    });
    expect(result.files).toContainEqual(expect.objectContaining({
      repositoryPath: 'ide/codex/instructions.md',
      content: '# Rules\n',
    }));
  });

  it('projects IDE Instructions as a Managed Block for project scope', async () => {
    const projectRoot = path.join(homeDir, 'project');
    fs.mkdirSync(projectRoot, { recursive: true });
    fs.writeFileSync(path.join(projectRoot, 'AGENTS.md'), '# Local intro\n');
    const adapter = new CodexAdapter();
    const context = { homeDir, platform: 'darwin' as const, env: {} };
    const view: SelectedRepositoryView = {
      instructions: { codex: { id: 'instruction:codex', content: '# Rules\n' } },
      skills: [],
      mcpServers: {},
      mcpOverrides: {},
      nativeAssets: new Map(),
    };
    const operation = await adapter.project(view, {
      ...projectRequest(),
      targetRoot: projectRoot,
    }, context);
    expect(operation.files).toHaveLength(1);
    expect(operation.files[0].targetPath).toBe(path.join(projectRoot, 'AGENTS.md'));
    expect(operation.files[0].content.toString()).toBe('# Rules\n');
  });

  it('projects selected native config for global scope', async () => {
    const codexRoot = path.join(homeDir, '.codex');
    fs.mkdirSync(codexRoot);
    fs.writeFileSync(path.join(codexRoot, 'config.toml'), 'model = "local"\n');
    const adapter = new CodexAdapter();
    const context = { homeDir, platform: 'darwin' as const, env: {} };
    const view: SelectedRepositoryView = {
      instructions: {},
      skills: [],
      mcpServers: {},
      mcpOverrides: {},
      nativeAssets: new Map([
        ['native:codex/user-settings', Buffer.from('model = "repo"\n')],
      ]),
    };
    const operation = await adapter.project(view, globalRequest(homeDir), context);
    const config = operation.files.find((file) => file.targetPath === path.join(codexRoot, 'config.toml'));
    expect(parseToml(config?.content.toString() ?? '')).toEqual({ model: 'repo' });
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
