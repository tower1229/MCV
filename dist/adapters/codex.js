import * as path from 'path';
import { mergeStructuredOverlay, parseStructuredObject, stringifyStructuredObject } from '../utils/structured-config.js';
import { hasExecutable } from './adapter-utils.js';
import { CodexCanonicalTransformer } from './codex-canonical-transformer.js';
import { CodexNativeFileHandler } from './codex-native-file-handler.js';
import { CODEX_MANAGED_PATHS } from './overlay-policies.js';
export class CodexAdapter {
    nativeFileHandler;
    canonicalTransformer;
    constructor(nativeFileHandler = new CodexNativeFileHandler(), canonicalTransformer = new CodexCanonicalTransformer()) {
        this.nativeFileHandler = nativeFileHandler;
        this.canonicalTransformer = canonicalTransformer;
    }
    async detect(context) {
        const configDirectories = this.nativeFileHandler.discoverDirectories(context);
        const files = await this.nativeFileHandler.discoverFiles(context);
        return {
            id: 'codex',
            name: 'Codex',
            detected: configDirectories.some((directory) => directory.exists)
                || files.some((file) => file.exists)
                || hasExecutable('codex', context),
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
        const configPath = path.join(context.env.CODEX_HOME || path.join(context.homeDir, '.codex'), 'config.toml');
        return {
            files: this.mergeConfig(nativeOperation.files, canonicalFiles, configPath),
            write: nativeOperation.write,
        };
    }
    mergeConfig(nativeFiles, canonicalFiles, configPath) {
        const native = nativeFiles.find((file) => file.targetPath === configPath);
        const managed = canonicalFiles.find((file) => file.targetPath === configPath);
        const other = [...nativeFiles, ...canonicalFiles].filter((file) => file.targetPath !== configPath);
        if (!native && !managed)
            return other;
        const existingFile = this.nativeFileHandler.readDeployTarget(configPath);
        const existing = existingFile
            ? parseStructuredObject(existingFile.content.toString(), 'toml', configPath)
            : {};
        const nativeValue = native
            ? parseStructuredObject(native.content.toString(), 'toml', configPath)
            : {};
        const managedValue = managed
            ? parseStructuredObject(managed.content.toString(), 'toml', configPath)
            : undefined;
        return [...other, {
                targetPath: configPath,
                content: stringifyStructuredObject(mergeStructuredOverlay(existing, nativeValue, managedValue, CODEX_MANAGED_PATHS), 'toml'),
            }];
    }
}
