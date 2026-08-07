import { createHash } from 'crypto';
import { describe, expect, it } from 'vitest';
import {
  extractManagedBlock,
  formatManagedBlock,
  hashManagedBlockBody,
  managedBlockDrifted,
  managedReceiptKey,
  upsertManagedBlock,
} from './managed-block.js';

const ASSET_ID = 'rule:canonical';

describe('Managed Block helpers', () => {
  it('formats begin/end markers around Canonical Rules body', () => {
    expect(formatManagedBlock(ASSET_ID, '# Rules\n')).toBe([
      '<!-- mcv:begin rule:canonical -->',
      '# Rules',
      '<!-- mcv:end rule:canonical -->',
    ].join('\n'));
  });

  it('creates a file containing only the Managed Block when absent', () => {
    const next = upsertManagedBlock(undefined, ASSET_ID, '# Rules\n');
    expect(next).toBe(`${formatManagedBlock(ASSET_ID, '# Rules\n')}\n`);
    expect(extractManagedBlock(next, ASSET_ID)).toBe('# Rules\n');
  });

  it('updates only the Managed Block and preserves surrounding bytes', () => {
    const existing = [
      '# Project local\n',
      '<!-- mcv:begin rule:canonical -->\n',
      '# Old\n',
      '<!-- mcv:end rule:canonical -->\n',
      '## Footnotes\n',
    ].join('');
    const next = upsertManagedBlock(existing, ASSET_ID, '# New\n');
    expect(next.startsWith('# Project local\n')).toBe(true);
    expect(next.endsWith('## Footnotes\n')).toBe(true);
    expect(extractManagedBlock(next, ASSET_ID)).toBe('# New\n');
    expect(next).toBe([
      '# Project local\n',
      '<!-- mcv:begin rule:canonical -->\n',
      '# New\n',
      '<!-- mcv:end rule:canonical -->\n',
      '## Footnotes\n',
    ].join(''));
  });

  it('treats a locally modified block body as Drift', () => {
    const file = upsertManagedBlock(undefined, ASSET_ID, '# Deployed\n');
    const drifted = file.replace('# Deployed\n', '# Edited locally\n');
    expect(managedBlockDrifted(drifted, ASSET_ID, '# Deployed\n')).toBe(true);
    expect(managedBlockDrifted(file, ASSET_ID, '# Deployed\n')).toBe(false);
  });

  it('builds Receipt keys and stable body hashes', () => {
    expect(managedReceiptKey('AGENTS.md', ASSET_ID)).toBe('AGENTS.md#mcv:rule:canonical');
    expect(hashManagedBlockBody('# Rules\n')).toBe(
      createHash('sha256').update('# Rules\n', 'utf8').digest('hex'),
    );
  });
});
