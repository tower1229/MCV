import { describe, expect, it } from 'vitest';
import {
  formatAssetId,
  isValidAssetId,
  parseAssetId,
  type AssetIdParts,
} from './ids.js';

describe('Asset IDs', () => {
  it('formats deterministic IDs for each Asset type', () => {
    expect(formatAssetId({ type: 'rule' })).toBe('rule:canonical');
    expect(formatAssetId({ type: 'skill', name: 'code-review' })).toBe('skill:code-review');
    expect(formatAssetId({ type: 'mcp', name: 'context7' })).toBe('mcp:context7');
    expect(formatAssetId({ type: 'native', target: 'codex', fileId: 'user-settings' }))
      .toBe('native:codex/user-settings');
    expect(formatAssetId({ type: 'native', target: 'claude-code', fileId: 'user-state' }))
      .toBe('native:claude-code/user-state');
  });

  it('parses valid Asset IDs back into typed parts', () => {
    const cases: Array<{ id: string; parts: AssetIdParts }> = [
      { id: 'rule:canonical', parts: { type: 'rule' } },
      { id: 'skill:debug', parts: { type: 'skill', name: 'debug' } },
      { id: 'mcp:filesystem', parts: { type: 'mcp', name: 'filesystem' } },
      {
        id: 'native:gemini/gemini-cli-settings',
        parts: { type: 'native', target: 'gemini', fileId: 'gemini-cli-settings' },
      },
    ];
    for (const { id, parts } of cases) {
      expect(parseAssetId(id)).toEqual(parts);
      expect(isValidAssetId(id)).toBe(true);
    }
  });

  it('rejects invalid paths, empty segments, and unknown prefixes', () => {
    const invalid = [
      '',
      'rule:other',
      'skill:',
      'skill:../escape',
      'skill:foo/bar',
      'skill:Foo',
      'skill:.hidden',
      'mcp:',
      'mcp:has/slash',
      'mcp:HasUpper',
      'native:codex',
      'native:codex/',
      'native:/user-settings',
      'native:codex/../escape',
      'native:unknown/user-settings',
      'native:codex/bad id',
      'component:x',
      'skill:code review',
    ];
    for (const id of invalid) {
      expect(isValidAssetId(id), id).toBe(false);
      expect(() => parseAssetId(id), id).toThrow(/invalid Asset ID/i);
    }
  });
});
