import * as fs from 'fs';
import * as path from 'path';
import { extractManagedBlock, hashManagedBlockBody, managedBlockDrifted, managedReceiptKey, upsertManagedBlock, } from './managed-block.js';
import { assertPathContainedInProjectRoot } from './project-target.js';
export const CANONICAL_RULES_ASSET_ID = 'rule:canonical';
export function projectCanonicalRulesFile(targetRoot, relativePath, rulesBody, receipt) {
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
    if (currentBody !== undefined && managedBlockDrifted(existing, CANONICAL_RULES_ASSET_ID, rulesBody)) {
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
    };
}
