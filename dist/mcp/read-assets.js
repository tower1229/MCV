import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'yaml';
import { deriveAssetCatalog } from '../assets/catalog.js';
import { parseAssetId } from '../assets/ids.js';
import { isRecord } from '../utils/objects.js';
import { READ_ASSETS_MAX_RESPONSE_BYTES, } from './contracts.js';
export function readAssets(repositoryPath, input = {}) {
    try {
        const catalog = deriveAssetCatalog(repositoryPath);
        const byId = new Map(catalog.assets.map((asset) => [asset.id, asset]));
        const includeFiles = input.includeFiles !== false;
        let state;
        if (input.cursor) {
            const decoded = decodeContinuation(input.cursor);
            if (!decoded) {
                return {
                    status: 'error',
                    error: {
                        code: 'mcp.invalidCursor',
                        message: 'read_assets cursor is invalid.',
                    },
                };
            }
            state = decoded;
        }
        else {
            const assetIds = input.assetIds ?? [];
            if (assetIds.length === 0) {
                return {
                    status: 'error',
                    error: {
                        code: 'mcp.missingAssetIds',
                        message: 'read_assets requires assetIds or a continuation cursor.',
                    },
                };
            }
            const missing = assetIds.filter((id) => !byId.has(id));
            if (missing.length > 0) {
                return {
                    status: 'error',
                    error: {
                        code: 'mcp.unknownAssets',
                        message: `Unknown Asset IDs: ${missing.join(', ')}`,
                    },
                };
            }
            state = {
                remaining: assetIds.map((assetId) => {
                    const asset = byId.get(assetId);
                    return {
                        assetId,
                        files: includeFiles ? loadAssetFiles(repositoryPath, asset) : [],
                        fileIndex: 0,
                    };
                }),
            };
        }
        const assets = [];
        let responseBytes = 0;
        let truncated = false;
        while (state.remaining.length > 0) {
            const current = state.remaining[0];
            const asset = byId.get(current.assetId);
            if (!asset) {
                return {
                    status: 'error',
                    error: {
                        code: 'mcp.unknownAssets',
                        message: `Unknown Asset ID: ${current.assetId}`,
                    },
                };
            }
            const emittedFiles = [];
            const assetOverhead = Buffer.byteLength(asset.id, 'utf8') + 32;
            while (current.fileIndex < current.files.length) {
                const file = current.files[current.fileIndex];
                const contentBuffer = Buffer.from(file.content, 'utf8');
                const overhead = Buffer.byteLength(file.path, 'utf8') + 64;
                const fileBytes = contentBuffer.byteLength + overhead;
                const reservedAssetOverhead = emittedFiles.length === 0 && assets.length === 0
                    ? assetOverhead
                    : 0;
                const remainingBudget = READ_ASSETS_MAX_RESPONSE_BYTES - responseBytes - reservedAssetOverhead;
                if (fileBytes > remainingBudget) {
                    const alreadyEmitting = assets.length > 0 || emittedFiles.length > 0;
                    if (alreadyEmitting || remainingBudget <= overhead) {
                        truncated = true;
                        break;
                    }
                    const maxContentBytes = remainingBudget - overhead;
                    const end = utf8SliceEnd(contentBuffer, maxContentBytes);
                    if (end <= 0) {
                        truncated = true;
                        break;
                    }
                    const slice = contentBuffer.subarray(0, end).toString('utf8');
                    const remainder = contentBuffer.subarray(end).toString('utf8');
                    emittedFiles.push({
                        path: file.path,
                        content: slice,
                        encoding: 'utf-8',
                        byteLength: end,
                    });
                    responseBytes += end + overhead;
                    current.files[current.fileIndex] = { path: file.path, content: remainder };
                    truncated = true;
                    break;
                }
                emittedFiles.push({
                    path: file.path,
                    content: file.content,
                    encoding: 'utf-8',
                    byteLength: contentBuffer.byteLength,
                });
                responseBytes += fileBytes;
                current.fileIndex += 1;
            }
            if (emittedFiles.length > 0 || current.files.length === 0) {
                assets.push({
                    id: asset.id,
                    type: asset.type,
                    files: emittedFiles,
                });
                responseBytes += Buffer.byteLength(asset.id, 'utf8') + 32;
            }
            if (current.fileIndex >= current.files.length) {
                state.remaining.shift();
            }
            if (truncated)
                break;
            if (state.remaining.length > 0
                && responseBytes >= READ_ASSETS_MAX_RESPONSE_BYTES) {
                truncated = true;
                break;
            }
        }
        return {
            status: 'ok',
            assets,
            truncated,
            responseBytes,
            ...(truncated || state.remaining.length > 0
                ? { nextCursor: encodeContinuation(state) }
                : {}),
        };
    }
    catch (error) {
        return {
            status: 'error',
            error: {
                code: 'mcp.readFailed',
                message: error instanceof Error ? error.message : String(error),
            },
        };
    }
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
function utf8SliceEnd(buffer, maxBytes) {
    if (maxBytes >= buffer.byteLength)
        return buffer.byteLength;
    let end = Math.max(0, maxBytes);
    while (end > 0 && (buffer[end] & 0xc0) === 0x80)
        end -= 1;
    return end;
}
function encodeContinuation(state) {
    return Buffer.from(JSON.stringify(state), 'utf8').toString('base64url');
}
function decodeContinuation(cursor) {
    try {
        const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
        if (!isRecord(parsed) || !Array.isArray(parsed.remaining))
            return undefined;
        const remaining = [];
        for (const entry of parsed.remaining) {
            if (!isRecord(entry) || typeof entry.assetId !== 'string' || typeof entry.fileIndex !== 'number') {
                return undefined;
            }
            if (!Array.isArray(entry.files))
                return undefined;
            const files = [];
            for (const file of entry.files) {
                if (!isRecord(file) || typeof file.path !== 'string' || typeof file.content !== 'string') {
                    return undefined;
                }
                files.push({ path: file.path, content: file.content });
            }
            remaining.push({
                assetId: entry.assetId,
                files,
                fileIndex: entry.fileIndex,
            });
        }
        return { remaining };
    }
    catch {
        return undefined;
    }
}
