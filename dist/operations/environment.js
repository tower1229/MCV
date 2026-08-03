import * as fs from 'fs';
import * as path from 'path';
import { createAdapterDefinitions } from '../adapters/index.js';
import { OPERATION_SCHEMA_VERSION, } from './contracts.js';
import { readManifest } from '../utils/repository.js';
export async function inspectEnvironment(context, repositoryPath = null) {
    const environments = await Promise.all(createAdapterDefinitions().map(async ({ targetId, adapter }) => {
        const [ide, configFiles] = await Promise.all([
            adapter.detect(context),
            adapter.discoverFiles(context),
        ]);
        return {
            id: environmentId(targetId),
            name: ide.name,
            detected: ide.detected,
            configDirectories: ide.configDirectories,
            configFiles,
        };
    }));
    return {
        schemaVersion: OPERATION_SCHEMA_VERSION,
        operation: 'discover',
        status: 'reported',
        ready: true,
        repositoryPath,
        changes: [],
        environments,
        missingVariables: repositoryPath
            ? findMissingVariables(repositoryPath, readManifest(repositoryPath), context)
            : [],
        issues: [],
        nextActions: [],
    };
}
function environmentId(targetId) {
    switch (targetId) {
        case 'codex': return 'codex';
        case 'claudeCode': return 'claude-code';
        case 'gemini': return 'gemini';
    }
}
function findMissingVariables(repositoryPath, manifest, context) {
    const missing = new Set();
    const availablePortable = new Set([
        'HOME',
        'MCV_REPO',
        ...Object.keys(context.variables ?? {}),
        ...availableManifestVariableNames(manifest.variables, context.platform),
    ]);
    visitRepositoryTextFiles(repositoryPath, new Set([path.resolve(repositoryPath, 'common', 'skills')]), (content) => {
        for (const match of content.matchAll(/\$\{env:([A-Z][A-Z0-9_]*)\}/g)) {
            if (!context.env[match[1]])
                missing.add(match[1]);
        }
        for (const match of content.matchAll(/\$\{([A-Z][A-Z0-9_]*)\}/g)) {
            if (!availablePortable.has(match[1]))
                missing.add(match[1]);
        }
    });
    return [...missing].sort();
}
function availableManifestVariableNames(variables, platform) {
    const platformKey = platform === 'win32' ? 'windows' : platform === 'darwin' ? 'macos' : 'linux';
    return Object.entries(variables).flatMap(([name, declaration]) => {
        if (typeof declaration === 'string')
            return [name];
        if (declaration && typeof declaration === 'object') {
            const platformValue = declaration[platformKey];
            if (typeof platformValue === 'string')
                return [name];
        }
        return [];
    });
}
function visitRepositoryTextFiles(directory, excludedDirectories, visit) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        if (entry.name === '.git' || entry.name === 'node_modules')
            continue;
        const entryPath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
            if (!excludedDirectories.has(path.resolve(entryPath))) {
                visitRepositoryTextFiles(entryPath, excludedDirectories, visit);
            }
        }
        else if (entry.isFile() && /\.(?:json|ya?ml|toml|md)$/i.test(entry.name)) {
            visit(fs.readFileSync(entryPath, 'utf8'));
        }
    }
}
