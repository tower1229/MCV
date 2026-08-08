import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { isRecord } from '../utils/objects.js';
import { parseStructuredObject, stringifyStructuredObject, } from '../utils/structured-config.js';
import { managedReceiptKey } from './managed-block.js';
import { assertPathContainedInProjectRoot } from './project-target.js';
const PROJECT_MCP_TARGETS = [
    {
        id: 'codex',
        ide: 'codex',
        relativePath: '.codex/config.toml',
        serversKey: 'mcp_servers',
        format: 'toml',
        surface: 'codex',
    },
    {
        id: 'claude-code',
        ide: 'claude-code',
        relativePath: '.mcp.json',
        serversKey: 'mcpServers',
        format: 'json',
        surface: 'claude-code',
    },
    {
        id: 'gemini-cli',
        ide: 'gemini',
        relativePath: '.gemini/settings.json',
        serversKey: 'mcpServers',
        format: 'json',
        surface: 'gemini-cli',
    },
];
export function projectMcpDestinationTargets(targets) {
    return PROJECT_MCP_TARGETS.filter((target) => {
        if (target.id === 'codex')
            return targets.codex;
        if (target.id === 'claude-code')
            return targets.claudeCode;
        return targets.geminiCli;
    });
}
export function hashProjectMcpServerValue(value) {
    return createHash('sha256').update(stableValue(value), 'utf8').digest('hex');
}
export function projectMcpServer(targetRoot, target, server, receipt) {
    const targetPath = path.join(targetRoot, ...target.relativePath.split('/'));
    assertPathContainedInProjectRoot(targetRoot, targetPath);
    const serverHash = hashProjectMcpServerValue(server.desired);
    const receiptKey = managedReceiptKey(target.relativePath, server.assetId);
    const base = {
        target,
        targetPath,
        serverName: server.name,
        assetId: server.assetId,
        receiptKey,
        serverHash,
        desired: server.desired,
    };
    if (!fs.existsSync(targetPath)) {
        return { ...base, status: 'absent' };
    }
    let document;
    try {
        document = parseStructuredObject(fs.readFileSync(targetPath, 'utf8'), target.format, targetPath);
    }
    catch {
        return { ...base, status: 'conflict' };
    }
    const servers = isRecord(document[target.serversKey])
        ? document[target.serversKey]
        : undefined;
    if (!servers || !(server.name in servers)) {
        return { ...base, status: 'absent' };
    }
    const localValue = servers[server.name];
    const localHash = hashProjectMcpServerValue(localValue);
    if (localHash === serverHash) {
        return { ...base, status: 'identical' };
    }
    const recorded = receipt?.managed[receiptKey];
    if (recorded !== undefined
        && recorded.assetId === server.assetId
        && recorded.hash === localHash) {
        return { ...base, status: 'update' };
    }
    return { ...base, status: 'conflict' };
}
/** Merge selected server keys into an existing project MCP config file. Non-selected keys stay. */
export function overlayProjectMcpFile(existingContent, target, serversToWrite) {
    const document = existingContent && existingContent.length > 0
        ? parseStructuredObject(existingContent, target.format, target.relativePath)
        : {};
    const currentServers = isRecord(document[target.serversKey])
        ? { ...document[target.serversKey] }
        : {};
    for (const [name, value] of Object.entries(serversToWrite)) {
        currentServers[name] = value;
    }
    return stringifyStructuredObject({
        ...document,
        [target.serversKey]: currentServers,
    }, target.format);
}
/** Remove named MCP server keys while preserving the rest of the document. */
export function removeProjectMcpServers(existingContent, target, serverNames) {
    const document = parseStructuredObject(existingContent, target.format, target.relativePath);
    const currentServers = isRecord(document[target.serversKey])
        ? { ...document[target.serversKey] }
        : {};
    for (const name of serverNames) {
        delete currentServers[name];
    }
    const next = { ...document };
    if (Object.keys(currentServers).length === 0)
        delete next[target.serversKey];
    else
        next[target.serversKey] = currentServers;
    return stringifyStructuredObject(next, target.format);
}
function stableValue(value) {
    if (Array.isArray(value))
        return `[${value.map(stableValue).join(',')}]`;
    if (isRecord(value)) {
        return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableValue(value[key])}`).join(',')}}`;
    }
    return JSON.stringify(value);
}
