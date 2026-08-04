import * as fs from 'fs';
import * as path from 'path';
import { createAdapterDefinitions } from '../adapters/index.js';
import { OPERATION_SCHEMA_VERSION, } from './contracts.js';
import { readManifest } from '../utils/repository.js';
const INTERPRETED_NATIVE_CONFIG_PATHS = [
    'ide/codex/native/config.toml',
    'ide/claude-code/native/settings.json',
    'ide/claude-code/native/.claude.json',
    'ide/gemini/native/gemini-cli/settings.json',
    'ide/gemini/native/antigravity/config.json',
    'ide/gemini/native/antigravity/mcp_config.json',
    'ide/gemini/native/antigravity/cli-settings.json',
    'ide/gemini/native/antigravity/ide-settings.json',
    'ide/gemini/native/antigravity/keybindings.json',
];
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
    for (const filePath of interpretedConfigurationFiles(repositoryPath, context.platform)) {
        const content = fs.readFileSync(filePath, 'utf8');
        for (const match of content.matchAll(/\$\{env:([A-Z][A-Z0-9_]*)\}/g)) {
            if (!context.env[match[1]])
                missing.add(match[1]);
        }
        for (const match of content.matchAll(/\$\{([A-Z][A-Z0-9_]*)\}/g)) {
            if (!availablePortable.has(match[1]))
                missing.add(match[1]);
        }
    }
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
function interpretedConfigurationFiles(repositoryPath, platform) {
    const platformDirectory = platform === 'win32' ? 'windows' : 'macos';
    const overrideRoot = path.join(repositoryPath, 'overrides', platformDirectory);
    const files = new Set();
    const manifestPath = path.join(repositoryPath, 'mcv.yaml');
    if (fs.existsSync(manifestPath))
        files.add(manifestPath);
    const commonMcp = path.join(repositoryPath, 'common', 'mcp.yaml');
    const overrideMcp = path.join(overrideRoot, 'common', 'mcp.yaml');
    if (fs.existsSync(overrideMcp))
        files.add(overrideMcp);
    else if (fs.existsSync(commonMcp))
        files.add(commonMcp);
    for (const relativePath of INTERPRETED_NATIVE_CONFIG_PATHS) {
        const override = path.join(overrideRoot, relativePath);
        const base = path.join(repositoryPath, relativePath);
        if (fs.existsSync(override))
            files.add(override);
        else if (fs.existsSync(base))
            files.add(base);
    }
    return [...files].sort();
}
