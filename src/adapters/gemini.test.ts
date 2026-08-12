import * as fs from 'fs';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DeployRequest } from '../assets/deploy-request.js';
import type { SelectedRepositoryView } from '../assets/selected-repository-view.js';
import { parse as parseYaml } from 'yaml';
import { GeminiAdapter } from './gemini.js';

describe('GeminiAdapter', () => {
  let homeDir: string;

  beforeEach(() => {
    homeDir = fs.mkdtempSync(path.join(process.cwd(), '.mcv-gemini-adapter-test-'));
  });

  afterEach(() => {
    fs.rmSync(homeDir, { recursive: true, force: true });
  });

  it('declares independent Gemini CLI and Antigravity Skill Surfaces', () => {
    const adapter = new GeminiAdapter();
    const context = { homeDir: '/Users/test', platform: 'darwin' as const, env: {} };
    expect(adapter.skillSurfaces).toEqual([
      expect.objectContaining({ id: 'gemini-cli' }),
      expect.objectContaining({ id: 'antigravity' }),
    ]);
    expect(adapter.skillSurfaces[0].destinationRoot(context))
      .toBe(path.join('/Users/test', '.gemini', 'skills'));
    expect(adapter.skillSurfaces[1].destinationRoot(context))
      .toBe(path.join('/Users/test', '.gemini', 'config', 'skills'));
    expect(adapter.skillSurfaces[0].supportsManagedDirectoryLinks('darwin')).toBe(true);
    expect(adapter.skillSurfaces[0].supportsManagedDirectoryLinks('win32')).toBe(false);
    expect(adapter.skillSurfaces[1].supportsManagedDirectoryLinks('darwin')).toBe(false);
    expect(adapter.skillSurfaces[1].supportsManagedDirectoryLinks('win32')).toBe(false);
  });

  it('discovers Gemini and separates MCP servers from native settings', async () => {
    const geminiRoot = path.join(homeDir, '.gemini');
    fs.mkdirSync(geminiRoot);
    fs.writeFileSync(
      path.join(geminiRoot, 'settings.json'),
      JSON.stringify({ ui: { theme: 'dark' }, mcpServers: { local: { command: 'server' } } }),
    );
    const adapter = new GeminiAdapter();
    const context = { homeDir, platform: 'darwin' as const, env: {} };

    await expect(adapter.detect(context)).resolves.toMatchObject({
      id: 'gemini',
      name: 'Gemini',
      detected: true,
    });
    const result = await adapter.capture(await adapter.discoverFiles(context), context);
    const native = result.files.find(
      (file) => file.repositoryPath === 'ide/gemini/native/gemini-cli/settings.json',
    );
    const mcp = result.files.find((file) => file.repositoryPath === 'common/mcp.yaml');

    expect(JSON.parse(native?.content.toString() ?? '')).toEqual({ ui: { theme: 'dark' } });
    expect(parseYaml(mcp?.content.toString() ?? '')).toEqual({
      servers: { local: { command: 'server', transport: 'stdio' } },
    });
  });

  it('preserves credential-shaped and environment configuration fields verbatim', async () => {
    const userRoot = path.join(homeDir, 'Library', 'Application Support', 'Antigravity', 'User');
    fs.mkdirSync(userRoot, { recursive: true });
    fs.writeFileSync(path.join(userRoot, 'settings.json'), JSON.stringify({
      apiKey: 'plain-key',
      oauth: { accessToken: 'plain-token' },
      environmentVariables: { API_TOKEN: '${env:API_TOKEN}' },
      'terminal.integrated.env.osx': { SERVICE_TOKEN: 'plain-service-token' },
      windowState: { x: 10 },
    }));
    const adapter = new GeminiAdapter();
    const context = { homeDir, platform: 'darwin' as const, env: {} };

    const result = await adapter.capture(await adapter.discoverFiles(context), context);
    const native = result.files.find(
      (file) => file.repositoryPath === 'ide/gemini/native/antigravity/ide-settings.json',
    );

    expect(JSON.parse(native?.content.toString() ?? '')).toEqual({
      apiKey: 'plain-key',
      oauth: { accessToken: 'plain-token' },
      environmentVariables: { API_TOKEN: '${env:API_TOKEN}' },
      'terminal.integrated.env.osx': { SERVICE_TOKEN: 'plain-service-token' },
    });
  });

  it('projects IDE Instructions as a Managed Block for project scope', async () => {
    const projectRoot = path.join(homeDir, 'project');
    fs.mkdirSync(projectRoot, { recursive: true });
    const adapter = new GeminiAdapter();
    const context = { homeDir, platform: 'darwin' as const, env: {} };
    const view: SelectedRepositoryView = {
      instructions: { gemini: { id: 'instruction:gemini', content: '# Rules\n' } },
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
      targetPath: path.join(projectRoot, 'GEMINI.md'),
      content: '# Rules\n',
    })]);
  });

  it('projects selected native settings for global scope', async () => {
    const geminiRoot = path.join(homeDir, '.gemini');
    fs.mkdirSync(geminiRoot);
    fs.writeFileSync(path.join(geminiRoot, 'settings.json'), JSON.stringify({ ui: { theme: 'local' } }));
    const adapter = new GeminiAdapter();
    const context = { homeDir, platform: 'darwin' as const, env: {} };
    const view: SelectedRepositoryView = {
      instructions: {},
      skills: [],
      mcpServers: {},
      mcpOverrides: {},
      nativeAssets: new Map([
        ['native:gemini/gemini-cli-settings', Buffer.from(JSON.stringify({ ui: { theme: 'repo' } }))],
      ]),
    };
    const operation = await adapter.project(view, globalRequest(homeDir), context);
    const settings = operation.files.find(
      (file) => file.targetPath === path.join(geminiRoot, 'settings.json'),
    );
    expect(JSON.parse(settings?.content.toString() ?? '')).toEqual({ ui: { theme: 'repo' } });
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
