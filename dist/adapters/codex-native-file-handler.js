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
exports.CodexNativeFileHandler = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const files_1 = require("../utils/files");
const sanitize_1 = require("../utils/sanitize");
const structured_config_1 = require("../utils/structured-config");
const variables_1 = require("../utils/variables");
const adapter_utils_1 = require("./adapter-utils");
const MANAGED_PATHS = ['$.mcp_servers'];
const LOCAL_PATHS = ['$.projects'];
class CodexNativeFileHandler {
    discoverDirectories(context) {
        const configRoot = path.join(context.homeDir, '.codex');
        return [{ id: 'config-root', path: configRoot, exists: fs.existsSync(configRoot) }];
    }
    async discoverFiles(context) {
        return [
            { id: 'user-settings', path: path.join(context.homeDir, '.codex', 'config.toml') },
            { id: 'user-instructions', path: path.join(context.homeDir, '.codex', 'AGENTS.md') },
        ].map((file) => ({ ...file, exists: fs.existsSync(file.path) }));
    }
    async capture(files, context) {
        const result = {
            files: [],
            managedFiles: [],
            managedFields: [],
            summary: {
                fileCount: 0,
                sensitiveFieldCount: 0,
                parameterizedPathCount: 0,
                excludedFileCount: 0,
            },
            warnings: [],
        };
        for (const file of files.filter((candidate) => candidate.exists)) {
            if (file.id === 'user-instructions') {
                const sanitized = (0, sanitize_1.sanitizeConfig)(fs.readFileSync(file.path, 'utf8'), context);
                result.summary.sensitiveFieldCount += sanitized.sensitiveFieldCount;
                result.summary.parameterizedPathCount += sanitized.parameterizedPathCount;
                result.managedFiles.push({
                    id: file.id,
                    sourcePath: file.path,
                    content: sanitized.value,
                });
                continue;
            }
            if (file.id !== 'user-settings')
                continue;
            try {
                const parsed = (0, structured_config_1.parseStructuredObject)(fs.readFileSync(file.path, 'utf8'), 'toml', file.path);
                const owned = (0, structured_config_1.splitOwnedFields)(parsed, MANAGED_PATHS, LOCAL_PATHS);
                const native = (0, sanitize_1.sanitizeConfig)(owned.native, context);
                result.summary.sensitiveFieldCount += native.sensitiveFieldCount;
                result.summary.parameterizedPathCount += native.parameterizedPathCount;
                if (Object.keys(native.value).length > 0) {
                    result.files.push({
                        sourcePath: file.path,
                        repositoryPath: 'ide/codex/native/config.toml',
                        content: (0, structured_config_1.stringifyStructuredObject)(native.value, 'toml'),
                        ownership: 'native',
                    });
                }
                for (const field of owned.managed) {
                    const sanitized = (0, sanitize_1.sanitizeConfig)(field.value, context);
                    result.summary.sensitiveFieldCount += sanitized.sensitiveFieldCount;
                    result.summary.parameterizedPathCount += sanitized.parameterizedPathCount;
                    result.managedFields.push({
                        sourcePath: file.path,
                        path: field.path,
                        value: sanitized.value,
                    });
                }
            }
            catch (error) {
                result.warnings.push(`Skipped ${file.path}: ${error instanceof Error ? error.message : String(error)}`);
            }
        }
        return result;
    }
    async deploy(repositoryPath, context) {
        const sourcePath = path.join(repositoryPath, 'ide', 'codex', 'native', 'config.toml');
        const targetPath = path.join(context.homeDir, '.codex', 'config.toml');
        const files = [];
        if (fs.existsSync(sourcePath)) {
            const parsed = (0, structured_config_1.parseStructuredObject)(fs.readFileSync(sourcePath, 'utf8'), 'toml', sourcePath);
            const resolved = (0, variables_1.resolvePortableValue)(parsed, context.variables ?? {}, context.platform ?? process.platform);
            files.push({ targetPath, content: (0, structured_config_1.stringifyStructuredObject)(resolved, 'toml') });
        }
        return { files, write: (file) => (0, files_1.atomicWriteFile)(file.targetPath, file.content) };
    }
    async readCanonical(repositoryPath, context) {
        return (0, adapter_utils_1.readCanonicalSource)(repositoryPath, context);
    }
    readDeployTarget(targetPath) {
        return (0, adapter_utils_1.readDeployTarget)(targetPath);
    }
}
exports.CodexNativeFileHandler = CodexNativeFileHandler;
