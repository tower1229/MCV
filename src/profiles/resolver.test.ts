import * as fs from 'fs';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import * as yaml from 'yaml';
import { deriveAssetCatalog } from '../assets/catalog.js';
import { resolveProfiles } from './resolver.js';
import { emptyProfilesDocument, writeProfilesDocument } from './store.js';

describe('resolveProfiles', () => {
  const roots: string[] = [];
  afterEach(() => {
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
  });

  it('unions multiple Profiles and deduplicates by Asset ID regardless of Profile order', () => {
    const repositoryPath = createRepositoryWithAssets();
    seedProfiles(repositoryPath, {
      global: { assets: ['instruction:codex'] },
      dev: { assets: ['skill:a', 'skill:b', 'mcp:context7'] },
      design: { assets: ['skill:b', 'instruction:codex'] },
    });

    const forward = resolveProfiles(repositoryPath, ['dev', 'design'], 'global');
    const reverse = resolveProfiles(repositoryPath, ['design', 'dev'], 'global');

    expect(forward).toMatchObject({ status: 'resolved' });
    expect(reverse).toMatchObject({ status: 'resolved' });
    if (forward.status !== 'resolved' || reverse.status !== 'resolved') return;

    expect(forward.selection.assetIds).toEqual([
      'instruction:codex',
      'mcp:context7',
      'skill:a',
      'skill:b',
    ]);
    expect(forward.selection.assetIds).toEqual(reverse.selection.assetIds);
    expect(forward.selection.profileIds).toEqual(['dev', 'design']);
    expect(reverse.selection.profileIds).toEqual(['design', 'dev']);
    expect(forward.selection.profilesRevision).toBe(reverse.selection.profilesRevision);
    expect(forward.selection.catalogRevision).toBe(reverse.selection.catalogRevision);
    expect(forward.issues).toEqual([]);
  });

  it('fails as an input error when a Profile ID is missing', () => {
    const repositoryPath = createRepositoryWithAssets();
    seedProfiles(repositoryPath, {
      global: { assets: ['instruction:codex'] },
    });

    const result = resolveProfiles(repositoryPath, ['missing'], 'global');
    expect(result).toMatchObject({
      status: 'failed',
      error: {
        code: 'deploy.profileNotFound',
        message: expect.stringContaining('missing'),
      },
    });
  });

  it('fails the whole Plan when a Profile references a missing Asset', () => {
    const repositoryPath = createRepositoryWithAssets();
    writeProfilesDocument(repositoryPath, {
      schemaVersion: 1,
      profiles: {
        global: { assets: ['instruction:codex'] },
        broken: { assets: ['skill:gone'] },
      },
    });

    const result = resolveProfiles(repositoryPath, ['broken'], 'global');
    expect(result).toMatchObject({
      status: 'failed',
      error: {
        code: 'deploy.missingAsset',
        message: expect.stringContaining('skill:gone'),
      },
    });
  });

  it('skips scope-unsupported Assets with a notice and keeps the rest', () => {
    const repositoryPath = createRepositoryWithAssets({
      includeNative: true,
    });
    seedProfiles(repositoryPath, {
      global: {
        assets: ['instruction:codex', 'skill:a', 'native:codex/user-settings'],
      },
    });

    const result = resolveProfiles(repositoryPath, ['global'], 'project');
    expect(result).toMatchObject({ status: 'resolved' });
    if (result.status !== 'resolved') return;

    expect(result.selection.assetIds).toEqual(['instruction:codex', 'skill:a']);
    expect(result.issues).toEqual([
      expect.objectContaining({
        severity: 'notice',
        code: 'deploy.scopeUnsupported',
        message: expect.stringContaining('native:codex/user-settings'),
      }),
    ]);
  });

  it('returns a successful empty selection with a notice when every Asset is skipped', () => {
    const repositoryPath = createRepositoryWithAssets({
      includeNative: true,
      skipInstructions: true,
    });
    seedProfiles(repositoryPath, {
      global: { assets: ['native:codex/user-settings'] },
    });

    const result = resolveProfiles(repositoryPath, ['global'], 'project');
    expect(result).toMatchObject({ status: 'resolved' });
    if (result.status !== 'resolved') return;

    expect(result.selection.assetIds).toEqual([]);
    expect(result.issues).toEqual([
      expect.objectContaining({
        severity: 'notice',
        code: 'deploy.scopeUnsupported',
      }),
      expect.objectContaining({
        severity: 'notice',
        code: 'deploy.emptySelection',
        message: expect.stringMatching(/no assets|empty|skipped/i),
      }),
    ]);
  });

  function createRepositoryWithAssets(options: {
    includeNative?: boolean;
    skipInstructions?: boolean;
  } = {}): string {
    const root = fs.mkdtempSync(path.join(process.cwd(), '.mcv-resolver-'));
    roots.push(root);
    fs.mkdirSync(path.join(root, 'common', 'skills', 'a'), { recursive: true });
    fs.mkdirSync(path.join(root, 'common', 'skills', 'b'), { recursive: true });
    if (!options.skipInstructions) {
      fs.mkdirSync(path.join(root, 'ide', 'codex'), { recursive: true });
      fs.writeFileSync(path.join(root, 'ide', 'codex', 'instructions.md'), '# instructions\n');
    }
    fs.writeFileSync(
      path.join(root, 'common', 'skills', 'a', 'SKILL.md'),
      '---\nname: a\n---\n',
    );
    fs.writeFileSync(
      path.join(root, 'common', 'skills', 'b', 'SKILL.md'),
      '---\nname: b\n---\n',
    );
    fs.writeFileSync(
      path.join(root, 'common', 'mcp.yaml'),
      yaml.stringify({ servers: { context7: { command: 'npx', transport: 'stdio' } } }),
    );
    if (options.includeNative) {
      fs.mkdirSync(path.join(root, 'ide', 'codex', 'native'), { recursive: true });
      fs.writeFileSync(path.join(root, 'ide', 'codex', 'native', 'config.toml'), 'model = "o4"\n');
    }
    writeProfilesDocument(root, emptyProfilesDocument());
    return root;
  }

  function seedProfiles(
    repositoryPath: string,
    profiles: Record<string, { title?: string; description?: string; assets: string[] }>,
  ): void {
    writeProfilesDocument(repositoryPath, {
      schemaVersion: 1,
      profiles: {
        global: profiles.global ?? { assets: [] },
        ...profiles,
      },
    });
    expect(deriveAssetCatalog(repositoryPath).assets.length).toBeGreaterThan(0);
  }
});
