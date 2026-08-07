import * as fs from 'fs';
import * as path from 'path';
import { atomicWriteTextFile } from './files.js';
export const CURRENT_DEVICE_STATE_SCHEMA_VERSION = 3;
export function mapManagedInventoryToGlobalScope(inventory) {
    if (!inventory)
        return undefined;
    const mapped = {};
    for (const [targetPath, entry] of Object.entries(inventory)) {
        mapped[targetPath] = {
            source: entry.source,
            hash: entry.hash,
            scope: 'global',
        };
    }
    return mapped;
}
export function getStateFilePath(context) {
    if (context.platform === 'win32') {
        return path.join(context.env.APPDATA || path.join(context.homeDir, 'AppData', 'Roaming'), 'mcv', 'config.json');
    }
    if (context.platform === 'darwin') {
        return path.join(context.homeDir, 'Library', 'Application Support', 'mcv', 'config.json');
    }
    return path.join(context.homeDir, '.config', 'mcv', 'config.json');
}
export function readState(context) {
    const statePath = getStateFilePath(context);
    if (fs.existsSync(statePath)) {
        try {
            const content = fs.readFileSync(statePath, 'utf-8');
            return normalizeLegacyState(JSON.parse(content));
        }
        catch {
            return {};
        }
    }
    return {};
}
function normalizeLegacyState(state) {
    const projections = state.managedSkillLayout?.projections;
    if (!projections)
        return state;
    for (const projection of Object.values(projections)) {
        if (projection.ide === 'gemini-cli' || projection.ide === 'antigravity') {
            projection.surface = projection.ide;
            projection.ide = 'gemini';
        }
    }
    return state;
}
export function writeState(context, state) {
    const statePath = getStateFilePath(context);
    const dir = path.dirname(statePath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    atomicWriteTextFile(statePath, JSON.stringify(state, null, 2));
}
export function recordCaptureSuccess(context) {
    const state = readState(context);
    state.lastOperation = {
        kind: 'capture',
        time: new Date().toISOString(),
        success: true,
    };
    writeState(context, state);
}
