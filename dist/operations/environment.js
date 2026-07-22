"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.inspectEnvironment = inspectEnvironment;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const adapters_1 = require("../adapters");
const contracts_1 = require("./contracts");
const repository_1 = require("../utils/repository");
async function inspectEnvironment(context, repositoryPath = null) {
    const environments = await Promise.all((0, adapters_1.createAdapterDefinitions)().map(async ({ targetId, adapter }) => {
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
        schemaVersion: contracts_1.OPERATION_SCHEMA_VERSION,
        operation: 'discover',
        status: 'reported',
        ready: true,
        repositoryPath,
        changes: [],
        environments,
        missingVariables: repositoryPath
            ? findMissingVariables(repositoryPath, (0, repository_1.readManifest)(repositoryPath), context)
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
    visitRepositoryTextFiles(repositoryPath, (content) => {
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
function visitRepositoryTextFiles(directory, visit) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        if (entry.name === '.git' || entry.name === 'node_modules')
            continue;
        const entryPath = path.join(directory, entry.name);
        if (entry.isDirectory())
            visitRepositoryTextFiles(entryPath, visit);
        else if (entry.isFile() && /\.(?:json|ya?ml|toml|md)$/i.test(entry.name)) {
            visit(fs.readFileSync(entryPath, 'utf8'));
        }
    }
}
