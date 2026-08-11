import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'yaml';
import { deriveAssetCatalog } from '../assets/catalog.js';
import { parseAssetId } from '../assets/ids.js';
import { isRecord } from '../utils/objects.js';
import { READ_ASSETS_MAX_CURSOR_BYTES, READ_ASSETS_MAX_RESPONSE_BYTES, } from './contracts.js';
import { serializedToolResultBytes } from './tool-result.js';
const CURSOR_VERSION = 1;
const READ_ASSETS_TOOL_NAME = 'read_assets';
const WIRE_ENVELOPE_RESERVE_BYTES = 1024;
export function readAssets(repositoryPath, input) {
    try {
        const catalog = deriveAssetCatalog(repositoryPath);
        const byId = new Map(catalog.assets.map((asset) => [asset.id, asset]));
        const decoded = input.cursor === undefined
            ? undefined
            : decodeContinuation(input.cursor);
        if (input.cursor !== undefined && decoded === undefined) {
            return invalidCursorError();
        }
        const state = decoded ?? {
            version: CURSOR_VERSION,
            catalogRevision: catalog.revision,
            assetIds: input.assetIds ?? [],
            includeFiles: input.includeFiles !== false,
            assetIndex: 0,
            fileIndex: 0,
            byteOffset: 0,
        };
        if (decoded && decoded.catalogRevision !== catalog.revision) {
            return readError('mcp.staleCursor', 'The Asset Catalog changed after this read_assets cursor was created. Restart the read with assetIds.');
        }
        const missing = state.assetIds.filter((id) => !byId.has(id));
        if (missing.length > 0) {
            return readError('mcp.unknownAssets', `Unknown Asset IDs: ${missing.join(', ')}`);
        }
        const invalidState = validateContinuationState(repositoryPath, state, byId);
        if (invalidState)
            return invalidState;
        return readPage(repositoryPath, state, byId);
    }
    catch (error) {
        return readError('mcp.readFailed', error instanceof Error ? error.message : String(error));
    }
}
function readPage(repositoryPath, initialState, byId) {
    let state = initialState;
    let assets = [];
    while (state.assetIndex < state.assetIds.length) {
        const asset = byId.get(state.assetIds[state.assetIndex]);
        const files = state.includeFiles ? loadAssetFiles(repositoryPath, asset) : [];
        if (files.length === 0) {
            const nextState = advanceAsset(state);
            const candidateAssets = appendAsset(assets, asset, []);
            if (!fitsResponse(candidateAssets, nextState)) {
                return finishPageOrError(assets, state);
            }
            assets = candidateAssets;
            state = nextState;
            continue;
        }
        const file = files[state.fileIndex];
        const buffer = Buffer.from(file.content, 'utf8');
        const remaining = buffer.subarray(state.byteOffset);
        const completeState = state.fileIndex + 1 < files.length
            ? { ...state, fileIndex: state.fileIndex + 1, byteOffset: 0 }
            : advanceAsset(state);
        const completeFile = fileContent(file.path, remaining);
        const completeAssets = appendAsset(assets, asset, [completeFile]);
        if (fitsResponse(completeAssets, completeState)) {
            assets = completeAssets;
            state = completeState;
            continue;
        }
        const partial = largestFittingSlice(assets, asset, file.path, buffer, state);
        if (!partial)
            return finishPageOrError(assets, state);
        return finalizeReadOutput(partial.assets, partial.state);
    }
    return finalizeReadOutput(assets, state);
}
function largestFittingSlice(assets, asset, filePath, buffer, state) {
    let low = 1;
    let high = buffer.byteLength - state.byteOffset - 1;
    let best;
    while (low <= high) {
        const candidateLength = Math.floor((low + high) / 2);
        const requestedEnd = state.byteOffset + candidateLength;
        const end = utf8SliceEnd(buffer, requestedEnd);
        if (end <= state.byteOffset) {
            low = candidateLength + 1;
            continue;
        }
        const nextState = { ...state, byteOffset: end };
        const fragment = fileContent(filePath, buffer.subarray(state.byteOffset, end));
        const candidateAssets = appendAsset(assets, asset, [fragment]);
        if (fitsResponse(candidateAssets, nextState)) {
            best = { assets: candidateAssets, state: nextState };
            low = candidateLength + 1;
        }
        else {
            high = candidateLength - 1;
        }
    }
    return best;
}
function fitsResponse(assets, state) {
    return finalizedResponseBytes(assets, state)
        <= READ_ASSETS_MAX_RESPONSE_BYTES - WIRE_ENVELOPE_RESERVE_BYTES;
}
function finishPageOrError(assets, state) {
    if (assets.length > 0)
        return finalizeReadOutput(assets, state);
    return readError('mcp.responseLimitExceeded', 'Asset metadata cannot fit within the read_assets response limit.');
}
function finalizeReadOutput(assets, state) {
    const done = state.assetIndex >= state.assetIds.length;
    const nextCursor = done ? undefined : encodeContinuation(state);
    if (nextCursor !== undefined
        && Buffer.byteLength(nextCursor, 'utf8') > READ_ASSETS_MAX_CURSOR_BYTES) {
        return readError('mcp.cursorLimitExceeded', 'The read_assets continuation cursor exceeds its size limit. Read fewer Assets at a time.');
    }
    const base = {
        status: 'ok',
        assets,
        truncated: !done,
        ...(nextCursor === undefined ? {} : { nextCursor }),
    };
    let output = { ...base, responseBytes: 0 };
    for (let attempt = 0; attempt < 8; attempt += 1) {
        const responseBytes = serializedToolResultBytes(READ_ASSETS_TOOL_NAME, output);
        if (responseBytes === output.responseBytes)
            return output;
        output = { ...base, responseBytes };
    }
    return output;
}
function finalizedResponseBytes(assets, state) {
    return finalizeReadOutput(assets, state).responseBytes
        ?? Number.POSITIVE_INFINITY;
}
function appendAsset(assets, asset, files) {
    const last = assets.at(-1);
    if (last?.id === asset.id) {
        return [
            ...assets.slice(0, -1),
            { ...last, files: [...last.files, ...files] },
        ];
    }
    return [...assets, { id: asset.id, type: asset.type, files }];
}
function fileContent(pathValue, content) {
    return {
        path: pathValue,
        content: content.toString('utf8'),
        encoding: 'utf-8',
        byteLength: content.byteLength,
    };
}
function advanceAsset(state) {
    return {
        ...state,
        assetIndex: state.assetIndex + 1,
        fileIndex: 0,
        byteOffset: 0,
    };
}
function validateContinuationState(repositoryPath, state, byId) {
    if (state.assetIndex > state.assetIds.length) {
        return invalidCursorError();
    }
    if (state.assetIndex === state.assetIds.length) {
        return state.fileIndex === 0 && state.byteOffset === 0
            ? undefined
            : invalidCursorError();
    }
    const asset = byId.get(state.assetIds[state.assetIndex]);
    const files = state.includeFiles ? loadAssetFiles(repositoryPath, asset) : [];
    if (files.length === 0) {
        return state.fileIndex === 0 && state.byteOffset === 0
            ? undefined
            : invalidCursorError();
    }
    if (state.fileIndex >= files.length) {
        return invalidCursorError();
    }
    const buffer = Buffer.from(files[state.fileIndex].content, 'utf8');
    if (state.byteOffset > buffer.byteLength || !isUtf8Boundary(buffer, state.byteOffset)) {
        return invalidCursorError();
    }
    return undefined;
}
function loadAssetFiles(repositoryPath, asset) {
    const files = [];
    const parsed = parseAssetId(asset.id);
    if (parsed.type === 'mcp') {
        for (const relative of asset.sourcePaths) {
            const absolute = path.join(repositoryPath, ...relative.split('/'));
            if (!fs.existsSync(absolute))
                continue;
            if (relative.endsWith('mcp.yaml') || relative.endsWith('mcp-overrides.yaml')) {
                const raw = fs.readFileSync(absolute, 'utf8');
                const document = yaml.parse(raw);
                if (relative.includes('mcp-overrides')) {
                    if (isRecord(document) && parsed.name in document) {
                        files.push({
                            path: `${relative}#${parsed.name}`,
                            content: yaml.stringify({ [parsed.name]: document[parsed.name] }),
                        });
                    }
                    continue;
                }
                if (isRecord(document) && isRecord(document.servers) && parsed.name in document.servers) {
                    files.push({
                        path: `${relative}#${parsed.name}`,
                        content: yaml.stringify({ [parsed.name]: document.servers[parsed.name] }),
                    });
                }
                continue;
            }
            files.push({ path: relative, content: fs.readFileSync(absolute, 'utf8') });
        }
        return files;
    }
    for (const relative of asset.sourcePaths) {
        const absolute = path.join(repositoryPath, ...relative.split('/'));
        if (!fs.existsSync(absolute))
            continue;
        const stat = fs.statSync(absolute);
        if (stat.isDirectory()) {
            collectDirectoryFiles(repositoryPath, absolute, files);
            continue;
        }
        files.push({ path: relative, content: fs.readFileSync(absolute, 'utf8') });
    }
    return files;
}
function collectDirectoryFiles(repositoryPath, directory, files) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })
        .sort((left, right) => left.name.localeCompare(right.name))) {
        const absolute = path.join(directory, entry.name);
        if (entry.isDirectory()) {
            collectDirectoryFiles(repositoryPath, absolute, files);
            continue;
        }
        if (!entry.isFile())
            continue;
        files.push({
            path: path.relative(repositoryPath, absolute).split(path.sep).join('/'),
            content: fs.readFileSync(absolute, 'utf8'),
        });
    }
}
function utf8SliceEnd(buffer, requestedEnd) {
    if (requestedEnd >= buffer.byteLength)
        return buffer.byteLength;
    let end = Math.max(0, requestedEnd);
    while (end > 0 && !isUtf8Boundary(buffer, end))
        end -= 1;
    return end;
}
function isUtf8Boundary(buffer, offset) {
    return offset === 0
        || offset === buffer.byteLength
        || (buffer[offset] & 0xc0) !== 0x80;
}
function encodeContinuation(state) {
    return Buffer.from(JSON.stringify(state), 'utf8').toString('base64url');
}
function decodeContinuation(cursor) {
    try {
        const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
        if (!isRecord(parsed))
            return undefined;
        if (parsed.version !== CURSOR_VERSION
            || typeof parsed.catalogRevision !== 'string'
            || !Array.isArray(parsed.assetIds)
            || parsed.assetIds.length === 0
            || parsed.assetIds.length > 50
            || parsed.assetIds.some((id) => typeof id !== 'string')
            || typeof parsed.includeFiles !== 'boolean'
            || !isNonnegativeInteger(parsed.assetIndex)
            || !isNonnegativeInteger(parsed.fileIndex)
            || !isNonnegativeInteger(parsed.byteOffset)) {
            return undefined;
        }
        return {
            version: CURSOR_VERSION,
            catalogRevision: parsed.catalogRevision,
            assetIds: parsed.assetIds,
            includeFiles: parsed.includeFiles,
            assetIndex: parsed.assetIndex,
            fileIndex: parsed.fileIndex,
            byteOffset: parsed.byteOffset,
        };
    }
    catch {
        return undefined;
    }
}
function isNonnegativeInteger(value) {
    return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}
function readError(code, message) {
    return { status: 'error', error: { code, message } };
}
function invalidCursorError() {
    return readError('mcp.invalidCursor', 'read_assets cursor is invalid.');
}
