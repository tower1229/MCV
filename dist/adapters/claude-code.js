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
exports.ClaudeCodeAdapter = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const structured_config_1 = require("../utils/structured-config");
const claude_code_native_file_handler_1 = require("./claude-code-native-file-handler");
const claude_code_canonical_transformer_1 = require("./claude-code-canonical-transformer");
const overlay_policies_1 = require("./overlay-policies");
class ClaudeCodeAdapter {
    nativeFileHandler;
    canonicalTransformer;
    constructor(nativeFileHandler = new claude_code_native_file_handler_1.ClaudeCodeNativeFileHandler(), canonicalTransformer = new claude_code_canonical_transformer_1.ClaudeCodeCanonicalTransformer()) {
        this.nativeFileHandler = nativeFileHandler;
        this.canonicalTransformer = canonicalTransformer;
    }
    async detect(context) {
        const configDirectories = this.nativeFileHandler.discoverDirectories(context);
        const files = await this.nativeFileHandler.discoverFiles(context);
        return {
            id: 'claude-code',
            name: 'Claude Code',
            detected: configDirectories.some((directory) => directory.exists)
                || files.some((file) => file.exists)
                || this.hasExecutable(context),
            configDirectories,
        };
    }
    async discoverFiles(context) {
        return this.nativeFileHandler.discoverFiles(context);
    }
    async capture(files, context) {
        const nativeCapture = await this.nativeFileHandler.capture(files, context);
        return this.canonicalTransformer.transform(nativeCapture, context);
    }
    async deploy(repositoryPath, context) {
        const [nativeOperation, canonicalSource] = await Promise.all([
            this.nativeFileHandler.deploy(repositoryPath, context),
            this.nativeFileHandler.readCanonical(repositoryPath, context),
        ]);
        const canonicalFiles = await this.canonicalTransformer.deploy(canonicalSource, context);
        return {
            files: this.mergeDeploymentFiles(nativeOperation.files, canonicalFiles, context),
            write: nativeOperation.write,
        };
    }
    mergeDeploymentFiles(nativeFiles, canonicalFiles, context) {
        const mergedPaths = [
            path.join((context.env ?? process.env).CLAUDE_CONFIG_DIR || path.join(context.homeDir, '.claude'), 'settings.json'),
            path.join(context.homeDir, '.claude.json'),
        ];
        const otherFiles = [...nativeFiles, ...canonicalFiles].filter((file) => !mergedPaths.includes(file.targetPath));
        const mergedFiles = mergedPaths.flatMap((targetPath) => {
            const nativeFile = nativeFiles.find((file) => file.targetPath === targetPath);
            const canonicalFile = canonicalFiles.find((file) => file.targetPath === targetPath);
            if (!nativeFile && !canonicalFile)
                return [];
            const existingFile = this.nativeFileHandler.readDeployTarget(targetPath);
            const existing = existingFile
                ? (0, structured_config_1.parseStructuredObject)(existingFile.content.toString(), 'json', targetPath)
                : {};
            const native = nativeFile
                ? (0, structured_config_1.parseStructuredObject)(nativeFile.content.toString(), 'json', targetPath)
                : {};
            const canonical = canonicalFile
                ? (0, structured_config_1.parseStructuredObject)(canonicalFile.content.toString(), 'json', targetPath)
                : undefined;
            return [{
                    targetPath,
                    content: (0, structured_config_1.stringifyStructuredObject)((0, structured_config_1.mergeStructuredOverlay)(existing, native, canonical, overlay_policies_1.CLAUDE_CODE_MANAGED_PATHS), 'json'),
                }];
        });
        return [...otherFiles, ...mergedFiles];
    }
    hasExecutable(context) {
        const platform = context.platform ?? process.platform;
        const pathEnv = context.pathEnv ?? process.env.PATH ?? '';
        const delimiter = platform === 'win32' ? ';' : ':';
        const extensions = platform === 'win32'
            ? (context.pathExt ?? process.env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD')
                .split(';')
                .filter(Boolean)
                .map((extension) => extension.toLowerCase())
            : [''];
        return pathEnv
            .split(delimiter)
            .filter(Boolean)
            .some((directory) => extensions.some((extension) => this.isExecutableFile(path.join(directory, `claude${extension}`), platform)));
    }
    isExecutableFile(filePath, platform) {
        try {
            if (!fs.statSync(filePath).isFile()) {
                return false;
            }
            if (platform !== 'win32') {
                fs.accessSync(filePath, fs.constants.X_OK);
            }
            return true;
        }
        catch {
            return false;
        }
    }
}
exports.ClaudeCodeAdapter = ClaudeCodeAdapter;
