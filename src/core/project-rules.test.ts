import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { formatManagedBlock, hashManagedBlockBody, upsertManagedBlock } from './managed-block.js';
import type { ManagedReceipt } from './managed-receipt.js';
import { projectCanonicalRulesFile } from './project-rules.js';

describe('project Canonical Rules projection', () => {
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
    const projection = projectCanonicalRulesFile(targetRoot, 'AGENTS.md', '# Rules\n', undefined);
    expect(projection.drifted).toBe(false);
    expect(projection.unchanged).toBe(false);
    expect(projection.content).toBe(`${formatManagedBlock('rule:canonical', '# Rules\n')}\n`);
    expect(projection.receiptKey).toBe('AGENTS.md#mcv:rule:canonical');
  });

  it('preserves user content outside the block', () => {
    fs.writeFileSync(path.join(targetRoot, 'CLAUDE.md'), '# Local intro\n');
    const projection = projectCanonicalRulesFile(targetRoot, 'CLAUDE.md', '# Rules\n', undefined);
    expect(projection.content.startsWith('# Local intro\n')).toBe(true);
    expect(projection.content).toContain('<!-- mcv:begin rule:canonical -->');
  });

  it('flags Drift when a local block no longer matches the Receipt hash', () => {
    const deployed = upsertManagedBlock(undefined, 'rule:canonical', '# Deployed\n');
    fs.writeFileSync(path.join(targetRoot, 'GEMINI.md'), deployed);
    const receipt: ManagedReceipt = {
      schemaVersion: 1,
      repositoryId: 'repo',
      managed: {
        'GEMINI.md#mcv:rule:canonical': {
          assetId: 'rule:canonical',
          hash: hashManagedBlockBody('# Deployed\n'),
        },
      },
    };
    fs.writeFileSync(
      path.join(targetRoot, 'GEMINI.md'),
      deployed.replace('# Deployed\n', '# Local edit\n'),
    );
    const projection = projectCanonicalRulesFile(targetRoot, 'GEMINI.md', '# Newer canonical\n', receipt);
    expect(projection.drifted).toBe(true);
  });

  it('allows a normal update when the local block still matches the Receipt', () => {
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
    const projection = projectCanonicalRulesFile(targetRoot, 'AGENTS.md', '# Newer canonical\n', receipt);
    expect(projection.drifted).toBe(false);
    expect(projection.unchanged).toBe(false);
  });
});
