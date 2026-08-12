import * as fs from 'fs';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import * as yaml from 'yaml';
import { deriveAssetCatalog } from '../assets/catalog.js';
import {
  acquireOperationLock,
  releaseOperationLock,
  repositoryOperationLockResource,
} from '../utils/operation-lock.js';
import { createProfileService } from './service.js';
import {
  computeProfilesRevision,
  emptyProfilesDocument,
  serializeProfilesDocument,
  writeProfilesDocument,
} from './store.js';

describe('ProfileService', () => {
  const roots: string[] = [];
  afterEach(() => {
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
  });

  it('serializes profiles.yaml with global first, lexicographic IDs, sorted unique assets, and no churn fields', () => {
    const repositoryPath = createRepositoryWithAssets();
    writeProfilesDocument(repositoryPath, {
      schemaVersion: 1,
      profiles: {
        zen: { title: 'Z', assets: ['skill:b', 'skill:a', 'skill:a'] },
        global: { title: 'Global', assets: ['instruction:codex', 'mcp:context7'] },
        alpha: { description: 'A', assets: ['skill:a'] },
      },
    });

    const raw = fs.readFileSync(path.join(repositoryPath, 'profiles.yaml'), 'utf8');
    expect(raw).not.toMatch(/updatedAt|createdAt/);
    expect(yaml.parse(raw)).toEqual({
      schemaVersion: 1,
      profiles: {
        global: {
          title: 'Global',
          assets: ['instruction:codex', 'mcp:context7'],
        },
        alpha: {
          description: 'A',
          assets: ['skill:a'],
        },
        zen: {
          title: 'Z',
          assets: ['skill:a', 'skill:b'],
        },
      },
    });
    const serialized = serializeProfilesDocument(yaml.parse(raw));
    expect(serialized.indexOf('global:')).toBeLessThan(serialized.indexOf('alpha:'));
    expect(serialized.indexOf('alpha:')).toBeLessThan(serialized.indexOf('zen:'));
  });

  it('rejects deleting global and only removes the Profile set definition', () => {
    const repositoryPath = createRepositoryWithAssets();
    seedProfiles(repositoryPath, {
      global: { assets: ['instruction:codex'] },
      dev: { assets: ['skill:a'] },
    });
    const service = createProfileService(repositoryPath);
    const inventory = service.inspect();

    const rejected = service.delete({
      id: 'global',
      expectedProfilesRevision: inventory.profilesRevision,
      expectedCatalogRevision: inventory.catalogRevision,
    });
    expect(rejected).toMatchObject({
      status: 'rejected',
      error: { code: 'profile.globalRequired' },
    });
    expect(yaml.parse(fs.readFileSync(path.join(repositoryPath, 'profiles.yaml'), 'utf8')).profiles.global)
      .toEqual({ assets: ['instruction:codex'] });

    const deleted = service.delete({
      id: 'dev',
      expectedProfilesRevision: inventory.profilesRevision,
      expectedCatalogRevision: inventory.catalogRevision,
    });
    expect(deleted).toMatchObject({
      status: 'updated',
      deleted: ['dev'],
      diff: { dev: { added: 0, removed: 1, total: 0 } },
    });
    expect(fs.existsSync(path.join(repositoryPath, 'common', 'skills', 'a', 'SKILL.md'))).toBe(true);
    expect(Object.keys(service.inspect().profiles)).toEqual(['global']);
  });

  it('creates, updates, and unions Profiles with Asset dedup while validating revisions', () => {
    const repositoryPath = createRepositoryWithAssets();
    seedProfiles(repositoryPath, {
      global: { assets: ['instruction:codex'] },
    });
    const service = createProfileService(repositoryPath);
    let inventory = service.inspect();
    expect(inventory.unassignedAssetIds.sort()).toEqual([
      'mcp:context7',
      'skill:a',
      'skill:b',
    ]);

    const created = service.create({
      id: 'dev',
      title: 'Development',
      assets: ['skill:a', 'skill:b', 'skill:a'],
      expectedProfilesRevision: inventory.profilesRevision,
      expectedCatalogRevision: inventory.catalogRevision,
    });
    expect(created).toMatchObject({
      status: 'updated',
      created: ['dev'],
      diff: { dev: { added: 2, removed: 0, total: 2 } },
    });

    inventory = service.inspect();
    const conflict = service.update({
      id: 'dev',
      addAssets: ['mcp:context7'],
      expectedProfilesRevision: 'stale',
      expectedCatalogRevision: inventory.catalogRevision,
    });
    expect(conflict).toMatchObject({
      status: 'conflict',
      error: { code: 'profile.revisionConflict' },
    });

    const updated = service.update({
      id: 'global',
      addAssets: ['skill:a', 'mcp:context7'],
      expectedProfilesRevision: inventory.profilesRevision,
      expectedCatalogRevision: inventory.catalogRevision,
    });
    expect(updated).toMatchObject({
      status: 'updated',
      updated: ['global'],
      diff: { global: { added: 2, removed: 0, total: 3 } },
    });

    inventory = service.inspect();
    expect(inventory.profiles.global.assets).toEqual([
      'instruction:codex',
      'mcp:context7',
      'skill:a',
    ]);
    expect(inventory.profiles.dev.assets).toEqual(['skill:a', 'skill:b']);
    expect(inventory.unassignedAssetIds).toEqual([]);

    const replaced = service.replaceAll({
      expectedProfilesRevision: inventory.profilesRevision,
      expectedCatalogRevision: inventory.catalogRevision,
      profiles: {
        global: { assets: ['instruction:codex'] },
        design: { assets: ['skill:b'] },
      },
    });
    expect(replaced).toMatchObject({
      status: 'updated',
      created: ['design'],
      updated: expect.arrayContaining(['global']),
      deleted: ['dev'],
    });
    expect(service.inspect().profiles).toEqual({
      global: { assets: ['instruction:codex'] },
      design: { assets: ['skill:b'] },
    });
  });

  it('fails without writing while another process owns the Repository mutation lock', () => {
    const repositoryPath = createRepositoryWithAssets();
    seedProfiles(repositoryPath, { global: { assets: ['instruction:codex'] } });
    const before = fs.readFileSync(path.join(repositoryPath, 'profiles.yaml'));
    const service = createProfileService(repositoryPath);
    const inventory = service.inspect();
    const lock = acquireOperationLock(repositoryOperationLockResource(repositoryPath));

    try {
      const result = service.update({
        id: 'global',
        addAssets: ['skill:a'],
        expectedProfilesRevision: inventory.profilesRevision,
        expectedCatalogRevision: inventory.catalogRevision,
      });

      expect(result).toMatchObject({
        status: 'conflict',
        error: { code: 'profile.repositoryBusy' },
      });
      expect(fs.readFileSync(path.join(repositoryPath, 'profiles.yaml'))).toEqual(before);
    } finally {
      releaseOperationLock(lock);
    }
  });

  it('rejects unknown Asset IDs and invalid Profile IDs', () => {
    const repositoryPath = createRepositoryWithAssets();
    seedProfiles(repositoryPath, { global: { assets: [] } });
    const service = createProfileService(repositoryPath);
    const inventory = service.inspect();

    expect(service.create({
      id: 'Bad_ID',
      expectedProfilesRevision: inventory.profilesRevision,
      expectedCatalogRevision: inventory.catalogRevision,
    })).toMatchObject({
      status: 'rejected',
      error: { code: 'profile.invalidId' },
    });

    expect(service.create({
      id: 'dev',
      assets: ['skill:missing'],
      expectedProfilesRevision: inventory.profilesRevision,
      expectedCatalogRevision: inventory.catalogRevision,
    })).toMatchObject({
      status: 'rejected',
      error: { code: 'profile.unknownAsset' },
    });
  });

  it('applies an atomic upsert/delete mutation batch and refuses deleting global', () => {
    const repositoryPath = createRepositoryWithAssets();
    seedProfiles(repositoryPath, {
      global: { assets: ['instruction:codex'] },
      old: { assets: ['skill:a'] },
    });
    const service = createProfileService(repositoryPath);
    const inventory = service.inspect();

    const rejected = service.applyMutations({
      expectedProfilesRevision: inventory.profilesRevision,
      expectedCatalogRevision: inventory.catalogRevision,
      mutations: [
        { operation: 'upsert', id: 'dev', assets: ['skill:b'] },
        { operation: 'delete', id: 'global' },
      ],
    });
    expect(rejected).toMatchObject({
      status: 'rejected',
      error: { code: 'profile.globalRequired' },
    });
    expect(service.inspect().profilesRevision).toBe(inventory.profilesRevision);

    const updated = service.applyMutations({
      expectedProfilesRevision: inventory.profilesRevision,
      expectedCatalogRevision: inventory.catalogRevision,
      mutations: [
        {
          operation: 'upsert',
          id: 'global',
          description: 'Stable',
          assets: ['instruction:codex', 'mcp:context7'],
        },
        { operation: 'upsert', id: 'dev', assets: ['skill:b'] },
        { operation: 'delete', id: 'old' },
      ],
    });
    expect(updated).toMatchObject({
      status: 'updated',
      created: ['dev'],
      updated: ['global'],
      deleted: ['old'],
      diff: {
        global: { added: 1, removed: 0, total: 2 },
        dev: { added: 1, removed: 0, total: 1 },
        old: { added: 0, removed: 1, total: 0 },
      },
    });
    expect(fs.existsSync(path.join(repositoryPath, 'common', 'skills', 'a', 'SKILL.md'))).toBe(true);
    expect(Object.keys(service.inspect().profiles).sort()).toEqual(['dev', 'global']);
  });

  it('Profiles Revision is the SHA-256 of normalized profiles.yaml content', () => {
    const document = emptyProfilesDocument();
    document.profiles.global = { title: 'Global', assets: ['instruction:codex'] };
    const revision = computeProfilesRevision(document);
    expect(revision).toMatch(/^[a-f0-9]{64}$/);
    expect(computeProfilesRevision(document)).toBe(revision);
    document.profiles.global.assets = ['instruction:codex', 'mcp:context7'];
    expect(computeProfilesRevision(document)).not.toBe(revision);
  });

  function createRepositoryWithAssets(): string {
    const root = fs.mkdtempSync(path.join(process.cwd(), '.mcv-profiles-'));
    roots.push(root);
    fs.mkdirSync(path.join(root, 'common', 'skills', 'a'), { recursive: true });
    fs.mkdirSync(path.join(root, 'common', 'skills', 'b'), { recursive: true });
    fs.mkdirSync(path.join(root, 'ide', 'codex'), { recursive: true });
    fs.writeFileSync(path.join(root, 'ide', 'codex', 'instructions.md'), '# instructions\n');
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
    // Ensure catalog is readable for revision checks in callers.
    expect(deriveAssetCatalog(repositoryPath).assets.length).toBeGreaterThan(0);
  }
});
