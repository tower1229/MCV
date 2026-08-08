import { describe, expect, it } from 'vitest';
import type { AssetCatalogItem } from '../../assets/catalog.js';
import {
  createInitialProfileEditorState,
  filteredCatalogAssets,
  profileEditorReducer,
  selectedAssetIds,
  type ProfileEditorState,
} from './reducer.js';

const catalog: AssetCatalogItem[] = [
  {
    id: 'rule:canonical',
    type: 'rule',
    displayName: 'Canonical Rules',
    sourcePaths: ['common/AGENTS.md'],
    contentHash: 'r',
    sizeBytes: 1,
    activation: 'always',
    supportedScopes: ['project', 'global'],
    supportedTargets: ['codex', 'claude-code', 'gemini'],
  },
  {
    id: 'skill:debug',
    type: 'skill',
    displayName: 'debug',
    description: 'Debug helpers',
    sourcePaths: ['common/skills/debug'],
    contentHash: 's',
    sizeBytes: 2,
    activation: 'on-demand',
    supportedScopes: ['project', 'global'],
    supportedTargets: ['codex', 'claude-code'],
  },
  {
    id: 'mcp:context7',
    type: 'mcp',
    displayName: 'context7',
    sourcePaths: ['common/mcp.yaml'],
    contentHash: 'm',
    sizeBytes: 3,
    activation: 'tool-surface',
    supportedScopes: ['project', 'global'],
    supportedTargets: ['gemini'],
  },
];

function readyState(overrides: Partial<ProfileEditorState> = {}): ProfileEditorState {
  const loaded = profileEditorReducer(
    createInitialProfileEditorState({ initialProfileId: 'dev' }),
    {
      type: 'inventory.loaded',
      profilesRevision: 'profiles-rev-1',
      catalogRevision: 'catalog-rev-1',
      profiles: {
        global: { title: 'Global', assets: ['rule:canonical'] },
        dev: { title: 'Dev', assets: ['skill:debug'] },
      },
      catalog,
    },
  );
  return { ...loaded, ...overrides };
}

describe('profileEditorReducer', () => {
  it('starts in loading until inventory arrives as ready', () => {
    const loading = createInitialProfileEditorState({ initialProfileId: 'dev' });
    expect(loading.status).toBe('loading');
    expect(loading.selectedProfileId).toBe('dev');

    const ready = profileEditorReducer(loading, {
      type: 'inventory.loaded',
      profilesRevision: 'profiles-rev-1',
      catalogRevision: 'catalog-rev-1',
      profiles: {
        global: { assets: ['rule:canonical'] },
        dev: { assets: ['skill:debug'] },
      },
      catalog,
    });

    expect(ready.status).toBe('ready');
    expect(ready.selectedProfileId).toBe('dev');
    expect(selectedAssetIds(ready)).toEqual(['skill:debug']);
    expect(ready.profileIds).toEqual(['global', 'dev']);
  });

  it('marks dirty when an asset is toggled onto the selected Profile', () => {
    const ready = readyState();
    const dirty = profileEditorReducer(ready, {
      type: 'asset.toggled',
      assetId: 'mcp:context7',
    });

    expect(dirty.status).toBe('dirty');
    expect(selectedAssetIds(dirty).sort()).toEqual(['mcp:context7', 'skill:debug']);
    expect(dirty.changeSummary).toEqual({ added: 1, removed: 0 });
  });

  it('returns to ready when a toggle undoes the only pending change', () => {
    const dirty = profileEditorReducer(readyState(), {
      type: 'asset.toggled',
      assetId: 'skill:debug',
    });
    expect(dirty.status).toBe('dirty');
    expect(selectedAssetIds(dirty)).toEqual([]);

    const restored = profileEditorReducer(dirty, {
      type: 'asset.toggled',
      assetId: 'skill:debug',
    });
    expect(restored.status).toBe('ready');
    expect(selectedAssetIds(restored)).toEqual(['skill:debug']);
    expect(restored.changeSummary).toEqual({ added: 0, removed: 0 });
  });

  it('enters saving from dirty and resolves to ready after a successful save', () => {
    const dirty = profileEditorReducer(readyState(), {
      type: 'asset.toggled',
      assetId: 'mcp:context7',
    });
    const saving = profileEditorReducer(dirty, { type: 'save.requested' });
    expect(saving.status).toBe('saving');

    const saved = profileEditorReducer(saving, {
      type: 'save.succeeded',
      profilesRevision: 'profiles-rev-2',
      catalogRevision: 'catalog-rev-1',
      profiles: {
        global: { title: 'Global', assets: ['rule:canonical'] },
        dev: { title: 'Dev', assets: ['skill:debug', 'mcp:context7'] },
      },
    });

    expect(saved.status).toBe('ready');
    expect(saved.profilesRevision).toBe('profiles-rev-2');
    expect(selectedAssetIds(saved).sort()).toEqual(['mcp:context7', 'skill:debug']);
    expect(saved.changeSummary).toEqual({ added: 0, removed: 0 });
  });

  it('reports Revision conflicts from saving and keeps the dirty draft', () => {
    const dirty = profileEditorReducer(readyState(), {
      type: 'asset.toggled',
      assetId: 'mcp:context7',
    });
    const saving = profileEditorReducer(dirty, { type: 'save.requested' });
    const conflict = profileEditorReducer(saving, {
      type: 'save.conflicted',
      profilesRevision: 'profiles-rev-other',
      catalogRevision: 'catalog-rev-other',
      message: 'expected Profiles or Catalog Revision does not match the Repository.',
    });

    expect(conflict.status).toBe('conflict');
    expect(conflict.conflictMessage).toContain('Revision');
    expect(selectedAssetIds(conflict).sort()).toEqual(['mcp:context7', 'skill:debug']);
    expect(conflict.profilesRevision).toBe('profiles-rev-other');
  });

  it('returns to dirty when ProfileService rejects a save', () => {
    const dirty = profileEditorReducer(readyState(), {
      type: 'asset.toggled',
      assetId: 'mcp:context7',
    });
    const saving = profileEditorReducer(dirty, { type: 'save.requested' });
    const failed = profileEditorReducer(saving, {
      type: 'save.failed',
      message: 'Profile save was rejected.',
    });

    expect(failed.status).toBe('dirty');
    expect(failed.errorMessage).toBe('Profile save was rejected.');
    expect(selectedAssetIds(failed).sort()).toEqual(['mcp:context7', 'skill:debug']);
  });

  it('discards dirty edits on cancel and returns to the loaded baseline', () => {
    const dirty = profileEditorReducer(readyState(), {
      type: 'asset.toggled',
      assetId: 'mcp:context7',
    });
    const cancelled = profileEditorReducer(dirty, { type: 'cancel.requested' });

    expect(cancelled.status).toBe('ready');
    expect(selectedAssetIds(cancelled)).toEqual(['skill:debug']);
    expect(cancelled.changeSummary).toEqual({ added: 0, removed: 0 });
    expect(cancelled.exitReason).toBe('cancelled');
    expect(cancelled.exitSummary).toBe('Profile edits discarded.');
  });

  it('filters the Asset list by search, type, and technical compatibility', () => {
    const ready = readyState({
      searchQuery: 'deb',
      typeFilter: 'skill',
      compatibilityFilter: 'codex',
    });

    expect(filteredCatalogAssets(ready).map((asset) => asset.id)).toEqual(['skill:debug']);

    const geminiOnly = readyState({
      searchQuery: '',
      typeFilter: 'all',
      compatibilityFilter: 'gemini',
    });
    expect(filteredCatalogAssets(geminiOnly).map((asset) => asset.id)).toEqual([
      'rule:canonical',
      'mcp:context7',
    ]);
  });
});
