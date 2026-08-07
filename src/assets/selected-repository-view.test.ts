import * as fs from 'fs';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import * as yaml from 'yaml';
import type { DeviceContext } from '../adapters/types.js';
import { writeProfilesDocument } from '../profiles/store.js';
import { resolveProfiles } from '../profiles/resolver.js';
import { buildSelectedRepositoryView } from './selected-repository-view.js';

describe('buildSelectedRepositoryView', () => {
  const roots: string[] = [];
  afterEach(() => {
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
  });

  it('includes only selected Rules, Skills, MCP servers with overrides, and Native assets', () => {
    const repositoryPath = createRepository();
    writeProfilesDocument(repositoryPath, {
      schemaVersion: 1,
      profiles: {
        global: {
          assets: [
            'rule:canonical',
            'skill:keep',
            'skill:drop',
            'mcp:context7',
            'mcp:other',
            'native:codex/user-settings',
          ],
        },
        slim: {
          assets: ['skill:keep', 'mcp:context7', 'native:codex/user-settings'],
        },
      },
    });
    const resolved = resolveProfiles(repositoryPath, ['slim'], 'global');
    expect(resolved.status).toBe('resolved');
    if (resolved.status !== 'resolved') return;

    const view = buildSelectedRepositoryView(repositoryPath, resolved.selection, deviceContext());
    expect(view.rules).toBeUndefined();
    expect(view.skills.map((skill) => skill.id)).toEqual(['skill:keep']);
    expect(view.skills[0]?.files.map((file) => file.relativePath)).toEqual(['SKILL.md']);
    expect(Object.keys(view.mcpServers).sort()).toEqual(['context7']);
    expect(view.mcpOverrides.codex).toEqual({ context7: { timeout: 30 } });
    expect(view.mcpOverrides['claude-code']).toBeUndefined();
    expect([...view.nativeAssets.keys()]).toEqual(['native:codex/user-settings']);
    expect(view.nativeAssets.get('native:codex/user-settings')?.toString('utf8')).toContain('model');
  });

  function createRepository(): string {
    const root = fs.mkdtempSync(path.join(process.cwd(), '.mcv-selected-view-'));
    roots.push(root);
    fs.mkdirSync(path.join(root, 'common', 'skills', 'keep'), { recursive: true });
    fs.mkdirSync(path.join(root, 'common', 'skills', 'drop'), { recursive: true });
    fs.mkdirSync(path.join(root, 'ide', 'codex', 'native'), { recursive: true });
    fs.writeFileSync(path.join(root, 'common', 'AGENTS.md'), '# rules\n');
    fs.writeFileSync(path.join(root, 'common', 'skills', 'keep', 'SKILL.md'), '---\nname: keep\n---\n');
    fs.writeFileSync(path.join(root, 'common', 'skills', 'drop', 'SKILL.md'), '---\nname: drop\n---\n');
    fs.writeFileSync(
      path.join(root, 'common', 'mcp.yaml'),
      yaml.stringify({
        servers: {
          context7: { command: 'npx', args: ['context7'] },
          other: { command: 'npx', args: ['other'] },
        },
      }),
    );
    fs.writeFileSync(
      path.join(root, 'ide', 'codex', 'mcp-overrides.yaml'),
      yaml.stringify({ context7: { timeout: 30 }, other: { timeout: 10 } }),
    );
    fs.writeFileSync(path.join(root, 'ide', 'codex', 'native', 'config.toml'), 'model = "o4"\n');
    return root;
  }

  function deviceContext(): DeviceContext {
    return {
      homeDir: path.join(roots[0]!, 'home'),
      platform: process.platform,
      env: {},
    };
  }
});
