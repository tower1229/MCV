import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { formatManagedBlock, hashManagedBlockBody, upsertManagedBlock } from './managed-block.js';
import type { ManagedReceipt } from './managed-receipt.js';
import { projectIdeInstructionsFile } from './project-rules.js';

describe('project IDE Instructions projection', () => {
  let testRoot: string;
  let targetRoot: string;

  beforeEach(() => {
    testRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mcv-project-rules-')));
    targetRoot = path.join(testRoot, 'project');
    fs.mkdirSync(targetRoot, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(testRoot, { recursive: true, force: true });
  });

  it('creates AGENTS.md Managed Block content when the file is absent', () => {
    const projection = projectIdeInstructionsFile(
      targetRoot, 'AGENTS.md', 'instruction:codex', '# Rules\n', undefined,
    );
    expect(projection.drifted).toBe(false);
    expect(projection.unchanged).toBe(false);
    expect(projection.content).toBe(`${formatManagedBlock('instruction:codex', '# Rules\n')}\n`);
    expect(projection.receiptKey).toBe('AGENTS.md#mcv:instruction:codex');
  });

  it('preserves user content outside the block', () => {
    fs.writeFileSync(path.join(targetRoot, 'CLAUDE.md'), '# Local intro\n');
    const projection = projectIdeInstructionsFile(
      targetRoot, 'CLAUDE.md', 'instruction:claude-code', '# Rules\n', undefined,
    );
    expect(projection.content.startsWith('# Local intro\n')).toBe(true);
    expect(projection.content).toContain('<!-- mcv:begin instruction:claude-code -->');
  });

  it('flags Drift when a local block no longer matches the Receipt hash', () => {
    const deployed = upsertManagedBlock(undefined, 'instruction:gemini', '# Deployed\n');
    fs.writeFileSync(path.join(targetRoot, 'GEMINI.md'), deployed);
    const receipt: ManagedReceipt = {
      schemaVersion: 1,
      repositoryId: 'repo',
      managed: {
        'GEMINI.md#mcv:instruction:gemini': {
          assetId: 'instruction:gemini',
          hash: hashManagedBlockBody('# Deployed\n'),
        },
      },
    };
    fs.writeFileSync(
      path.join(targetRoot, 'GEMINI.md'),
      deployed.replace('# Deployed\n', '# Local edit\n'),
    );
    const projection = projectIdeInstructionsFile(
      targetRoot, 'GEMINI.md', 'instruction:gemini', '# Newer instructions\n', receipt,
    );
    expect(projection.drifted).toBe(true);
  });

  it('migrates a verified legacy block and its Receipt key in place', () => {
    const deployed = upsertManagedBlock(undefined, 'rule:canonical', '# Deployed\n');
    fs.writeFileSync(path.join(targetRoot, 'AGENTS.md'), deployed);
    const receipt: ManagedReceipt = {
      schemaVersion: 1,
      repositoryId: 'repo',
      managed: {
        'AGENTS.md#mcv:rule:canonical': {
          assetId: 'rule:canonical',
          hash: hashManagedBlockBody('# Deployed\n'),
        },
      },
    };
    const projection = projectIdeInstructionsFile(
      targetRoot, 'AGENTS.md', 'instruction:codex', '# Newer instructions\n', receipt,
    );
    expect(projection.drifted).toBe(false);
    expect(projection.unchanged).toBe(false);
    expect(projection.migratedReceiptKey).toBe('AGENTS.md#mcv:rule:canonical');
    expect(projection.content).not.toContain('mcv:begin rule:canonical');
    expect(projection.content).toContain('mcv:begin instruction:codex');
  });

  it('blocks a legacy block without a Receipt instead of appending a second block', () => {
    fs.writeFileSync(
      path.join(targetRoot, 'CLAUDE.md'),
      upsertManagedBlock(undefined, 'rule:canonical', '# Legacy\n'),
    );

    const projection = projectIdeInstructionsFile(
      targetRoot,
      'CLAUDE.md',
      'instruction:claude-code',
      '# New instructions\n',
      undefined,
    );

    expect(projection.drifted).toBe(true);
    expect(projection.content).toContain('mcv:begin rule:canonical');
    expect(projection.content).not.toContain('mcv:begin instruction:claude-code');
  });

  it('blocks a legacy block when its Receipt hash does not match', () => {
    fs.writeFileSync(
      path.join(targetRoot, 'GEMINI.md'),
      upsertManagedBlock(undefined, 'rule:canonical', '# Local edit\n'),
    );
    const receipt: ManagedReceipt = {
      schemaVersion: 1,
      repositoryId: 'repo',
      managed: {
        'GEMINI.md#mcv:rule:canonical': {
          assetId: 'rule:canonical',
          hash: hashManagedBlockBody('# Previously deployed\n'),
        },
      },
    };

    const projection = projectIdeInstructionsFile(
      targetRoot,
      'GEMINI.md',
      'instruction:gemini',
      '# New instructions\n',
      receipt,
    );

    expect(projection.drifted).toBe(true);
    expect(projection.migratedReceiptKey).toBeUndefined();
  });
});
