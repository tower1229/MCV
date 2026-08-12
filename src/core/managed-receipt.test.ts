import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  managedReceiptPath,
  readManagedReceipt,
  writeManagedReceipt,
  type ManagedReceipt,
} from './managed-receipt.js';

describe('Managed Receipt', () => {
  let testRoot: string;
  let targetRoot: string;

  beforeEach(() => {
    testRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mcv-receipt-')));
    targetRoot = path.join(testRoot, 'project');
    fs.mkdirSync(targetRoot, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(testRoot, { recursive: true, force: true });
  });

  it('reads undefined when managed.json is absent (conservative mode)', () => {
    expect(readManagedReceipt(targetRoot)).toBeUndefined();
    expect(managedReceiptPath(targetRoot)).toBe(path.join(targetRoot, '.mcv', 'managed.json'));
  });

  it('round-trips a schema v1 Receipt without storing absolute paths', () => {
    const receipt: ManagedReceipt = {
      schemaVersion: 1,
      repositoryId: 'repo-1',
      managed: {
        'AGENTS.md#mcv:instruction:codex': {
          assetId: 'instruction:codex',
          hash: 'a'.repeat(64),
        },
      },
    };
    writeManagedReceipt(targetRoot, receipt);
    expect(readManagedReceipt(targetRoot)).toEqual(receipt);
    const raw = fs.readFileSync(managedReceiptPath(targetRoot), 'utf8');
    expect(raw).not.toContain(targetRoot);
    expect(raw).not.toContain(testRoot);
  });
});
