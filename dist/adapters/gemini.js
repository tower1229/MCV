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
exports.GeminiAdapter = void 0;
const path = __importStar(require("path"));
const structured_config_1 = require("../utils/structured-config");
const adapter_utils_1 = require("./adapter-utils");
const gemini_canonical_transformer_1 = require("./gemini-canonical-transformer");
const gemini_native_file_handler_1 = require("./gemini-native-file-handler");
class GeminiAdapter {
    nativeFileHandler;
    canonicalTransformer;
    constructor(nativeFileHandler = new gemini_native_file_handler_1.GeminiNativeFileHandler(), canonicalTransformer = new gemini_canonical_transformer_1.GeminiCanonicalTransformer()) {
        this.nativeFileHandler = nativeFileHandler;
        this.canonicalTransformer = canonicalTransformer;
    }
    async detect(context) {
        const configDirectories = this.nativeFileHandler.discoverDirectories(context);
        const files = await this.nativeFileHandler.discoverFiles(context);
        return {
            id: 'gemini',
            name: 'Gemini',
            detected: configDirectories.some((directory) => directory.exists)
                || files.some((file) => file.exists)
                || (0, adapter_utils_1.hasExecutable)('gemini', context),
            configDirectories,
        };
    }
    discoverFiles(context) {
        return this.nativeFileHandler.discoverFiles(context);
    }
    async capture(files, context) {
        return this.canonicalTransformer.transform(await this.nativeFileHandler.capture(files, context), context);
    }
    async deploy(repositoryPath, context) {
        const [nativeOperation, canonicalSource] = await Promise.all([
            this.nativeFileHandler.deploy(repositoryPath, context),
            this.nativeFileHandler.readCanonical(repositoryPath, context),
        ]);
        const canonicalFiles = await this.canonicalTransformer.deploy(canonicalSource, context);
        const settingsPath = path.join(context.homeDir, '.gemini', 'settings.json');
        return {
            files: this.mergeSettings(nativeOperation.files, canonicalFiles, settingsPath),
            write: nativeOperation.write,
        };
    }
    mergeSettings(nativeFiles, canonicalFiles, settingsPath) {
        const native = nativeFiles.find((file) => file.targetPath === settingsPath);
        const managed = canonicalFiles.find((file) => file.targetPath === settingsPath);
        const other = [...nativeFiles, ...canonicalFiles].filter((file) => file.targetPath !== settingsPath);
        if (!native && !managed)
            return other;
        const existingFile = this.nativeFileHandler.readDeployTarget(settingsPath);
        const existing = existingFile
            ? (0, structured_config_1.parseStructuredObject)(existingFile.content.toString(), 'json', settingsPath)
            : {};
        const nativeValue = native
            ? (0, structured_config_1.parseStructuredObject)(native.content.toString(), 'json', settingsPath)
            : {};
        const managedValue = managed
            ? (0, structured_config_1.parseStructuredObject)(managed.content.toString(), 'json', settingsPath)
            : undefined;
        return [...other, {
                targetPath: settingsPath,
                content: (0, structured_config_1.stringifyStructuredObject)((0, structured_config_1.mergeStructuredOverlay)(existing, nativeValue, managedValue, ['$.mcpServers']), 'json'),
            }];
    }
}
exports.GeminiAdapter = GeminiAdapter;
