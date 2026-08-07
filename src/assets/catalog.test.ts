import * as fs from 'fs';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import * as yaml from 'yaml';
import { computeCatalogRevision, deriveAssetCatalog } from './catalog.js';

describe('Asset Catalog', () => {
  const roots: string[] = [];
  afterEach(() => {
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
  });

  it('derives one Asset per Canonical rules, Skill, MCP server, and declared Native unit', () => {
    const repositoryPath = createRepository();
    fs.mkdirSync(path.join(repositoryPath, 'common', 'skills', 'code-review'), { recursive: true });
    fs.writeFileSync(
      path.join(repositoryPath, 'common', 'AGENTS.md'),
      '# Rules\n',
    );
    fs.writeFileSync(
      path.join(repositoryPath, 'common', 'skills', 'code-review', 'SKILL.md'),
      '---\nname: code-review\ndescription: Review pull requests\n---\n# Review\n',
    );
    fs.writeFileSync(
      path.join(repositoryPath, 'common', 'mcp.yaml'),
      yaml.stringify({
        servers: {
          context7: { command: 'npx', args: ['-y', '@upstash/context7-mcp'], transport: 'stdio' },
        },
      }),
    );
    fs.mkdirSync(path.join(repositoryPath, 'ide', 'codex', 'native'), { recursive: true });
    fs.writeFileSync(path.join(repositoryPath, 'ide', 'codex', 'native', 'config.toml'), 'model = "gpt"\n');
    fs.mkdirSync(path.join(repositoryPath, 'ide', 'codex'), { recursive: true });
    fs.writeFileSync(
      path.join(repositoryPath, 'ide', 'codex', 'mcp-overrides.yaml'),
      yaml.stringify({ context7: { timeout: 30 } }),
    );

    const catalog = deriveAssetCatalog(repositoryPath);
    const ids = catalog.assets.map((asset) => asset.id);
    expect(ids).toEqual([
      'mcp:context7',
      'native:codex/user-settings',
      'rule:canonical',
      'skill:code-review',
    ]);

    const skill = catalog.assets.find((asset) => asset.id === 'skill:code-review');
    expect(skill).toMatchObject({
      type: 'skill',
      displayName: 'code-review',
      description: 'Review pull requests',
      activation: 'on-demand',
      supportedScopes: ['project', 'global'],
      supportedTargets: ['codex', 'claude-code', 'gemini'],
      sourcePaths: ['common/skills/code-review'],
    });
    expect(skill?.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(skill?.sizeBytes).toBeGreaterThan(0);

    const mcp = catalog.assets.find((asset) => asset.id === 'mcp:context7');
    expect(mcp).toMatchObject({
      type: 'mcp',
      displayName: 'context7',
      description: 'context7',
      activation: 'tool-surface',
      sourcePaths: ['common/mcp.yaml', 'ide/codex/mcp-overrides.yaml'],
    });

    const rules = catalog.assets.find((asset) => asset.id === 'rule:canonical');
    expect(rules).toMatchObject({
      type: 'rule',
      displayName: 'Canonical Rules',
      activation: 'always',
      sourcePaths: ['common/AGENTS.md'],
    });

    const native = catalog.assets.find((asset) => asset.id === 'native:codex/user-settings');
    expect(native).toMatchObject({
      type: 'native',
      displayName: 'user-settings',
      activation: 'configuration',
      supportedScopes: ['global'],
      supportedTargets: ['codex'],
      sourcePaths: ['ide/codex/native/config.toml'],
    });
  });

  it('attaches platform overrides to the base Asset and never catalogs them separately', () => {
    const repositoryPath = createRepository();
    fs.writeFileSync(path.join(repositoryPath, 'common', 'AGENTS.md'), '# base\n');
    fs.mkdirSync(path.join(repositoryPath, 'overrides', 'macos', 'common'), { recursive: true });
    fs.writeFileSync(
      path.join(repositoryPath, 'overrides', 'macos', 'common', 'AGENTS.md'),
      '# macos\n',
    );

    const before = deriveAssetCatalog(repositoryPath);
    expect(before.assets.map((asset) => asset.id)).toEqual(['rule:canonical']);
    expect(before.assets[0]?.sourcePaths).toEqual([
      'common/AGENTS.md',
      'overrides/macos/common/AGENTS.md',
    ]);
    expect(before.assets.some((asset) => asset.id.includes('override'))).toBe(false);

    fs.writeFileSync(
      path.join(repositoryPath, 'overrides', 'macos', 'common', 'AGENTS.md'),
      '# macos changed\n',
    );
    expect(deriveAssetCatalog(repositoryPath).revision).not.toBe(before.revision);
  });

  it('computes a stable Catalog Revision that changes when Asset content or set changes', () => {
    const repositoryPath = createRepository();
    fs.writeFileSync(path.join(repositoryPath, 'common', 'AGENTS.md'), '# Rules\n');
    const first = deriveAssetCatalog(repositoryPath);
    const second = deriveAssetCatalog(repositoryPath);
    expect(first.revision).toBe(second.revision);
    expect(first.revision).toMatch(/^[a-f0-9]{64}$/);
    expect(computeCatalogRevision(first.assets)).toBe(first.revision);

    fs.writeFileSync(path.join(repositoryPath, 'common', 'AGENTS.md'), '# Changed\n');
    const afterContent = deriveAssetCatalog(repositoryPath);
    expect(afterContent.revision).not.toBe(first.revision);

    fs.writeFileSync(
      path.join(repositoryPath, 'common', 'mcp.yaml'),
      yaml.stringify({ servers: { extra: { command: 'true', transport: 'stdio' } } }),
    );
    expect(deriveAssetCatalog(repositoryPath).revision).not.toBe(afterContent.revision);
  });

  it('skips Skills with invalid directory names and never starts MCP servers', () => {
    const repositoryPath = createRepository();
    fs.mkdirSync(path.join(repositoryPath, 'common', 'skills', 'Bad Name'), { recursive: true });
    fs.writeFileSync(
      path.join(repositoryPath, 'common', 'skills', 'Bad Name', 'SKILL.md'),
      '---\nname: Bad Name\n---\n',
    );
    fs.writeFileSync(
      path.join(repositoryPath, 'common', 'mcp.yaml'),
      yaml.stringify({
        servers: {
          local: { command: 'echo', transport: 'stdio' },
        },
      }),
    );

    const catalog = deriveAssetCatalog(repositoryPath);
    expect(catalog.assets.map((asset) => asset.id)).toEqual(['mcp:local']);
    expect(catalog.assets[0]?.description).toBe('local');
  });

  function createRepository(): string {
    const root = fs.mkdtempSync(path.join(process.cwd(), '.mcv-catalog-'));
    roots.push(root);
    fs.mkdirSync(path.join(root, 'common'), { recursive: true });
    return root;
  }
});
