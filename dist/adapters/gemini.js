import * as path from 'path';
import { mergeStructuredOverlay, parseStructuredObject, stringifyStructuredObject } from '../utils/structured-config.js';
import { hasExecutable } from './adapter-utils.js';
import { GeminiCanonicalTransformer } from './gemini-canonical-transformer.js';
import { GeminiNativeFileHandler } from './gemini-native-file-handler.js';
import { GEMINI_MANAGED_PATHS } from './overlay-policies.js';
export class GeminiAdapter {
    nativeFileHandler;
    canonicalTransformer;
    constructor(nativeFileHandler = new GeminiNativeFileHandler(), canonicalTransformer = new GeminiCanonicalTransformer()) {
        this.nativeFileHandler = nativeFileHandler;
        this.canonicalTransformer = canonicalTransformer;
    }
    async detect(context) {
        const configDirectories = this.nativeFileHandler.discoverDirectories(context);
        const files = await this.nativeFileHandler.discoverFiles(context);
        return {
            id: 'gemini',
            name: 'Gemini',
            detected: files.some((file) => file.exists)
                || hasExecutable('gemini', context),
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
        const antigravityMcpPath = path.join(context.homeDir, '.gemini', 'config', 'mcp_config.json');
        return {
            files: this.mergeSettings(this.mergeSettings(nativeOperation.files, canonicalFiles, settingsPath), [], antigravityMcpPath),
            write: nativeOperation.write,
        };
    }
    mergeSettings(nativeFiles, canonicalFiles, settingsPath) {
        const native = nativeFiles.find((file) => file.targetPath === settingsPath);
        const managed = canonicalFiles.find((file) => file.targetPath === settingsPath)
            ?? nativeFiles.slice().reverse().find((file) => file.targetPath === settingsPath);
        const other = [...nativeFiles, ...canonicalFiles].filter((file) => file.targetPath !== settingsPath);
        if (!native && !managed)
            return other;
        const existingFile = this.nativeFileHandler.readDeployTarget(settingsPath);
        const existing = existingFile
            ? parseStructuredObject(existingFile.content.toString(), 'json', settingsPath)
            : {};
        const nativeValue = native
            ? parseStructuredObject(native.content.toString(), 'json', settingsPath)
            : {};
        const managedValue = managed
            ? parseStructuredObject(managed.content.toString(), 'json', settingsPath)
            : undefined;
        return [...other, {
                targetPath: settingsPath,
                content: stringifyStructuredObject(mergeStructuredOverlay(existing, nativeValue, managedValue, GEMINI_MANAGED_PATHS), 'json'),
            }];
    }
}
