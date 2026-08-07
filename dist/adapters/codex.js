import * as path from 'path';
import { parseAssetId } from '../assets/ids.js';
import { toCanonicalDeploySource } from '../assets/selected-repository-view.js';
import { atomicWriteFile } from '../utils/files.js';
import { mergeStructuredOverlay, parseStructuredObject, stringifyStructuredObject } from '../utils/structured-config.js';
import { hasExecutable, projectRulesManagedFile } from './adapter-utils.js';
import { CodexCanonicalTransformer } from './codex-canonical-transformer.js';
import { CodexNativeFileHandler, projectCodexNativeUserSettings } from './codex-native-file-handler.js';
import { CODEX_MANAGED_PATHS } from './overlay-policies.js';
export class CodexAdapter {
    nativeFileHandler;
    canonicalTransformer;
    skillSurfaces = [{
            id: 'codex',
            destinationRoot: (context) => path.join(context.homeDir, '.agents', 'skills'),
            supportsManagedDirectoryLinks: (platform) => platform === 'darwin',
        }];
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
    async project(source, request, context) {
        const write = (file) => atomicWriteFile(file.targetPath, file.content);
        if (request.scope === 'project') {
            return { files: projectRulesManagedFile(request.targetRoot, 'AGENTS.md', source), write };
        }
        const canonicalSource = toCanonicalDeploySource(source);
        const [nativeFiles, canonicalFiles] = await Promise.all([
            Promise.resolve(this.projectNativeAssets(source.nativeAssets, context)),
            this.canonicalTransformer.deploy(canonicalSource, context),
        ]);
        const configPath = path.join(context.env.CODEX_HOME || path.join(context.homeDir, '.codex'), 'config.toml');
        return {
            files: this.mergeConfig(nativeFiles, canonicalFiles, configPath),
            write,
        };
    }
    projectNativeAssets(nativeAssets, context) {
        const files = [];
        for (const [assetId, content] of nativeAssets) {
            const parsed = parseAssetId(assetId);
            if (parsed.type !== 'native' || parsed.target !== 'codex')
                continue;
            const file = projectCodexNativeUserSettings(content, context);
            if (file)
                files.push(file);
        }
        return files;
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
