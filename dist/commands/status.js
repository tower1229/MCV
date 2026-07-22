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
exports.showStatus = showStatus;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const child_process_1 = require("child_process");
const adapters_1 = require("../adapters");
const files_1 = require("../utils/files");
const repository_1 = require("../utils/repository");
const state_1 = require("../utils/state");
async function showStatus(context) {
    const state = (0, state_1.readState)(context);
    if (state.repositoryPath) {
        console.log(`[bound] ${state.repositoryPath} (${state.defaultRepositoryId ?? 'unknown repository ID'})`);
        if (!fs.existsSync(path.join(state.repositoryPath, 'mcv.yaml'))) {
            console.log('[repository-missing] Bound repository cannot be read.');
        }
        else {
            reportGit(state.repositoryPath);
            await reportSurfaces(state.repositoryPath, context);
            reportMissingEnvironment(state.repositoryPath, context.env);
        }
    }
    const baseline = state.baselineSnapshot;
    if (!baseline || Object.keys(baseline.files).length === 0) {
        console.log('No deployment baseline found. Run `mcv deploy` first.');
    }
    else {
        for (const [filePath, expectedHash] of Object.entries(baseline.files)) {
            if (!fs.existsSync(filePath))
                console.log(`[missing] ${filePath}`);
            else
                console.log(`[${(0, files_1.hashFile)(filePath) === expectedHash ? 'matching' : 'drifted'}] ${filePath}`);
        }
    }
    if (state.lastOperation)
        console.log(`[last-${state.lastOperation.success ? 'success' : 'failure'}] ${state.lastOperation.kind} ${state.lastOperation.time}`);
}
function reportGit(repositoryPath) {
    try {
        const output = (0, child_process_1.execFileSync)('git', ['status', '--porcelain'], { cwd: repositoryPath, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
        console.log(`[git-${output.trim() ? 'dirty' : 'clean'}] ${repositoryPath}`);
    }
    catch {
        console.log(`[git-unavailable] ${repositoryPath}`);
    }
}
async function reportSurfaces(repositoryPath, context) {
    const manifest = (0, repository_1.readManifest)(repositoryPath);
    for (const definition of (0, adapters_1.createAdapterDefinitions)()) {
        if (manifest.targets[definition.targetId]?.enabled !== true)
            continue;
        const detected = await definition.adapter.detect(context);
        console.log(`[${detected.detected ? 'detected' : 'not-detected'}] ${definition.name}`);
        if (definition.targetId === 'gemini') {
            for (const directory of detected.configDirectories)
                console.log(`[surface-${directory.exists ? 'present' : 'absent'}] gemini/${directory.id}`);
        }
    }
}
function reportMissingEnvironment(repositoryPath, env) {
    const missing = new Set();
    const walk = (directory) => {
        for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
            if (entry.name === '.git' || entry.name === 'node_modules')
                continue;
            const current = path.join(directory, entry.name);
            if (entry.isDirectory())
                walk(current);
            else if (entry.isFile() && /\.(?:json|ya?ml|toml|md)$/i.test(entry.name)) {
                const content = fs.readFileSync(current, 'utf8');
                for (const match of content.matchAll(/\$\{env:([A-Z][A-Z0-9_]*)\}/g))
                    if (!env[match[1]])
                        missing.add(match[1]);
            }
        }
    };
    walk(repositoryPath);
    for (const name of [...missing].sort())
        console.log(`[missing-env] ${name}`);
}
