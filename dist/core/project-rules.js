import * as fs from 'fs';
import * as path from 'path';
import { extractManagedBlock, hashManagedBlockBody, managedBlockDrifted, managedReceiptKey, removeManagedBlock, upsertManagedBlock, } from './managed-block.js';
import { assertPathContainedInProjectRoot } from './project-target.js';
export const LEGACY_RULES_ASSET_ID = 'rule:canonical';
export function projectIdeInstructionsFile(targetRoot, relativePath, assetId, instructionsBody, receipt) {
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
        ? removeManagedBlock(existing, LEGACY_RULES_ASSET_ID)
        : existing;
    const content = legacyUnverified
        ? existing
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
    }
    else if (currentBody !== undefined && managedBlockDrifted(existing, assetId, instructionsBody)) {
        const recorded = receipt?.managed[receiptKey];
        if (recorded === undefined) {
            // Conservative mode without Receipt ownership: differing local block is Drift.
            drifted = true;
        }
        else if (recorded.hash !== hashManagedBlockBody(currentBody)) {
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
