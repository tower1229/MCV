import * as fs from 'fs';
import * as path from 'path';
import { isRecord } from '../utils/objects.js';
import { atomicWriteFile } from '../utils/files.js';
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
export function managedReceiptPath(targetRoot) {
    return path.join(targetRoot, '.mcv', 'managed.json');
}
export function readManagedReceipt(targetRoot) {
    const receiptPath = managedReceiptPath(targetRoot);
    if (!fs.existsSync(receiptPath))
        return undefined;
    try {
        const raw = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
        return parseManagedReceipt(raw);
    }
    catch {
        return undefined;
    }
}
export function writeManagedReceipt(targetRoot, receipt) {
    const receiptPath = managedReceiptPath(targetRoot);
    atomicWriteFile(receiptPath, serializeManagedReceipt(receipt));
}
export function serializeManagedReceipt(receipt) {
    return `${JSON.stringify(receipt, null, 2)}\n`;
}
export function parseManagedReceipt(raw) {
    if (!isRecord(raw)
        || raw.schemaVersion !== 1
        || typeof raw.repositoryId !== 'string'
        || !isRecord(raw.managed)) {
        return undefined;
    }
    const managed = {};
    for (const [key, value] of Object.entries(raw.managed)) {
        if (!isRecord(value)
            || typeof value.assetId !== 'string'
            || typeof value.hash !== 'string'
            || !SHA256_PATTERN.test(value.hash)) {
            return undefined;
        }
        managed[key] = { assetId: value.assetId, hash: value.hash };
    }
    return {
        schemaVersion: 1,
        repositoryId: raw.repositoryId,
        managed,
    };
}
