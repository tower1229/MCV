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
exports.ClaudeCodeNativeFileHandler = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const objects_1 = require("../utils/objects");
const files_1 = require("../utils/files");
const sanitize_1 = require("../utils/sanitize");
const variables_1 = require("../utils/variables");
const JSON_CAPTURE_POLICIES = {
    'user-settings': {
        repositoryPath: 'ide/claude-code/native/settings.json',
        managedPaths: new Set(['$.mcpServers']),
        localPaths: new Set(),
    },
    'user-state': {
        repositoryPath: 'ide/claude-code/native/.claude.json',
        managedPaths: new Set(['$.mcpServers']),
        localPaths: new Set(['$.projects']),
    },
};
class ClaudeCodeNativeFileHandler {
    discoverDirectories(context) {
        const configRoot = path.join(context.homeDir, '.claude');
        return [
            {
                id: 'config-root',
                path: configRoot,
                exists: fs.existsSync(configRoot),
            },
        ];
    }
    async discoverFiles(context) {
        const candidates = [
            {
                id: 'user-settings',
                path: path.join(context.homeDir, '.claude', 'settings.json'),
            },
            {
                id: 'user-instructions',
                path: path.join(context.homeDir, '.claude', 'CLAUDE.md'),
            },
            {
                id: 'user-state',
                path: path.join(context.homeDir, '.claude.json'),
            },
        ];
        return candidates.map((candidate) => ({
            ...candidate,
            exists: fs.existsSync(candidate.path),
        }));
    }
    async capture(files, context) {
        const capturedFiles = [];
        const managedFiles = [];
        const managedFields = [];
        const warnings = [];
        let sensitiveFieldCount = 0;
        let parameterizedPathCount = 0;
        let excludedFileCount = 0;
        for (const file of files.filter((candidate) => candidate.exists)) {
            if ((0, sanitize_1.isSensitiveFile)(file.path)) {
                excludedFileCount += 1;
                continue;
            }
            if (file.id === 'user-instructions') {
                const sanitized = (0, sanitize_1.sanitizeConfig)(fs.readFileSync(file.path, 'utf8'), context);
                sensitiveFieldCount += sanitized.sensitiveFieldCount;
                parameterizedPathCount += sanitized.parameterizedPathCount;
                managedFiles.push({
                    id: file.id,
                    sourcePath: file.path,
                    content: sanitized.value,
                });
                continue;
            }
            const policy = JSON_CAPTURE_POLICIES[file.id];
            if (!policy)
                continue;
            const parsed = this.readJsonObject(file.path, warnings);
            if (!parsed)
                continue;
            const nativeFields = {};
            for (const [key, value] of Object.entries(parsed)) {
                const objectPath = `$.${key}`;
                if (policy.localPaths.has(objectPath))
                    continue;
                if (policy.managedPaths.has(objectPath)) {
                    const sanitized = (0, sanitize_1.sanitizeConfig)({ [key]: value }, context);
                    sensitiveFieldCount += sanitized.sensitiveFieldCount;
                    parameterizedPathCount += sanitized.parameterizedPathCount;
                    managedFields.push({
                        sourcePath: file.path,
                        path: objectPath,
                        value: sanitized.value[key],
                    });
                }
                else {
                    nativeFields[key] = value;
                }
            }
            if (Object.keys(nativeFields).length > 0) {
                const sanitized = (0, sanitize_1.sanitizeConfig)(nativeFields, context);
                sensitiveFieldCount += sanitized.sensitiveFieldCount;
                parameterizedPathCount += sanitized.parameterizedPathCount;
                capturedFiles.push({
                    sourcePath: file.path,
                    repositoryPath: policy.repositoryPath,
                    content: `${JSON.stringify(sanitized.value, null, 2)}\n`,
                    ownership: 'native',
                });
            }
        }
        return {
            files: capturedFiles,
            managedFiles,
            managedFields,
            summary: {
                fileCount: capturedFiles.length,
                sensitiveFieldCount,
                parameterizedPathCount,
                excludedFileCount,
            },
            warnings,
        };
    }
    async deploy(repositoryPath, context) {
        const nativeRoot = path.join(repositoryPath, 'ide', 'claude-code', 'native');
        const mappings = [
            {
                sourcePath: path.join(nativeRoot, 'settings.json'),
                targetPath: path.join(context.homeDir, '.claude', 'settings.json'),
            },
            {
                sourcePath: path.join(nativeRoot, '.claude.json'),
                targetPath: path.join(context.homeDir, '.claude.json'),
            },
        ];
        const files = mappings.flatMap((mapping) => {
            if (!fs.existsSync(mapping.sourcePath))
                return [];
            const parsed = JSON.parse(fs.readFileSync(mapping.sourcePath, 'utf8'));
            if (!(0, objects_1.isRecord)(parsed)) {
                throw new Error(`${mapping.sourcePath} must contain a JSON object.`);
            }
            const resolved = (0, variables_1.resolvePortableValue)(parsed, context.variables ?? {}, context.platform ?? process.platform);
            return [{
                    targetPath: mapping.targetPath,
                    content: `${JSON.stringify(resolved, null, 2)}\n`,
                }];
        });
        return {
            files,
            write: (file) => (0, files_1.atomicWriteTextFile)(file.targetPath, file.content),
        };
    }
    readJsonObject(filePath, warnings) {
        try {
            const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
            if (!(0, objects_1.isRecord)(parsed)) {
                warnings.push(`Skipped ${filePath}: expected a JSON object.`);
                return undefined;
            }
            return parsed;
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            warnings.push(`Skipped ${filePath}: ${message}`);
            return undefined;
        }
    }
}
exports.ClaudeCodeNativeFileHandler = ClaudeCodeNativeFileHandler;
