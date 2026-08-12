import * as fs from 'fs';
import * as path from 'path';
import {
  extractManagedBlock,
  hashManagedBlockBody,
  managedBlockDrifted,
  managedReceiptKey,
  removeManagedBlock,
  upsertManagedBlock,
} from './managed-block.js';
import type { ManagedReceipt } from './managed-receipt.js';
import { assertPathContainedInProjectRoot } from './project-target.js';

export const LEGACY_RULES_ASSET_ID = 'rule:canonical' as const;

export type ProjectInstructionsFileName = 'AGENTS.md' | 'CLAUDE.md' | 'GEMINI.md';

export interface ProjectInstructionsProjection {
  targetPath: string;
  relativePath: ProjectInstructionsFileName;
  content: string;
  receiptKey: string;
  bodyHash: string;
  drifted: boolean;
  unchanged: boolean;
  migratedReceiptKey?: string;
}

export function projectIdeInstructionsFile(
  targetRoot: string,
  relativePath: ProjectInstructionsFileName,
  assetId: `instruction:${string}`,
  instructionsBody: string,
  receipt: ManagedReceipt | undefined,
): ProjectInstructionsProjection {
  const targetPath = path.join(targetRoot, relativePath);
  assertPathContainedInProjectRoot(targetRoot, targetPath);

  const existing = fs.existsSync(targetPath)
    ? fs.readFileSync(targetPath, 'utf8')
    : undefined;
  const legacyReceiptKey = managedReceiptKey(relativePath, LEGACY_RULES_ASSET_ID);
  const legacyBody = existing === undefined
    ? undefined
    : extractManagedBlock(existing, LEGACY_RULES_ASSET_ID);
  const legacyEntry = receipt?.managed[legacyReceiptKey];
  const legacyVerified = legacyBody !== undefined
    && legacyEntry?.assetId === LEGACY_RULES_ASSET_ID
    && legacyEntry.hash === hashManagedBlockBody(legacyBody);
  const legacyUnverified = legacyBody !== undefined && !legacyVerified;
  const base = legacyVerified
    ? removeManagedBlock(existing as string, LEGACY_RULES_ASSET_ID)
    : existing;
  const content = legacyUnverified
    ? existing as string
    : upsertManagedBlock(base, assetId, instructionsBody);
  const receiptKey = managedReceiptKey(relativePath, assetId);
  const bodyHash = hashManagedBlockBody(instructionsBody);
  const currentBody = existing === undefined
    ? undefined
    : extractManagedBlock(existing, assetId);
  const unchanged = existing !== undefined && existing === content;

  let drifted = false;
  if (legacyUnverified) {
    drifted = true;
  } else if (currentBody !== undefined && managedBlockDrifted(existing as string, assetId, instructionsBody)) {
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
    ...(legacyVerified ? { migratedReceiptKey: legacyReceiptKey } : {}),
  };
}
