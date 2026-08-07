import * as fs from 'fs';
import * as path from 'path';
import {
  extractManagedBlock,
  hashManagedBlockBody,
  managedBlockDrifted,
  managedReceiptKey,
  upsertManagedBlock,
} from './managed-block.js';
import type { ManagedReceipt } from './managed-receipt.js';
import { assertPathContainedInProjectRoot } from './project-target.js';

export const CANONICAL_RULES_ASSET_ID = 'rule:canonical' as const;

export type ProjectRulesFileName = 'AGENTS.md' | 'CLAUDE.md' | 'GEMINI.md';

export interface ProjectRulesProjection {
  targetPath: string;
  relativePath: ProjectRulesFileName;
  content: string;
  receiptKey: string;
  bodyHash: string;
  drifted: boolean;
  unchanged: boolean;
}

export function projectCanonicalRulesFile(
  targetRoot: string,
  relativePath: ProjectRulesFileName,
  rulesBody: string,
  receipt: ManagedReceipt | undefined,
): ProjectRulesProjection {
  const targetPath = path.join(targetRoot, relativePath);
  assertPathContainedInProjectRoot(targetRoot, targetPath);

  const existing = fs.existsSync(targetPath)
    ? fs.readFileSync(targetPath, 'utf8')
    : undefined;
  const content = upsertManagedBlock(existing, CANONICAL_RULES_ASSET_ID, rulesBody);
  const receiptKey = managedReceiptKey(relativePath, CANONICAL_RULES_ASSET_ID);
  const bodyHash = hashManagedBlockBody(rulesBody);
  const currentBody = existing === undefined
    ? undefined
    : extractManagedBlock(existing, CANONICAL_RULES_ASSET_ID);
  const unchanged = existing !== undefined && existing === content;

  let drifted = false;
  if (currentBody !== undefined && managedBlockDrifted(existing as string, CANONICAL_RULES_ASSET_ID, rulesBody)) {
    const recorded = receipt?.managed[receiptKey];
    if (recorded === undefined) {
      // Conservative mode without Receipt ownership: differing local block is Drift.
      drifted = true;
    } else if (recorded.hash !== hashManagedBlockBody(currentBody)) {
      drifted = true;
    }
    // recorded.hash === current → last deploy matches local; Canonical changed → normal update.
  }

  return {
    targetPath,
    relativePath,
    content,
    receiptKey,
    bodyHash,
    drifted,
    unchanged,
  };
}
