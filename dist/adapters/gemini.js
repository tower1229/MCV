import * as path from 'path';
import { parseAssetId } from '../assets/ids.js';
import { toCanonicalDeploySource } from '../assets/selected-repository-view.js';
import { atomicWriteFile } from '../utils/files.js';
import { mergeStructuredOverlay, parseStructuredObject, stringifyStructuredObject } from '../utils/structured-config.js';
import { hasExecutable, projectRulesManagedFile } from './adapter-utils.js';
import { GeminiCanonicalTransformer } from './gemini-canonical-transformer.js';
import { GeminiNativeFileHandler, projectGeminiNativeAsset } from './gemini-native-file-handler.js';
import { GEMINI_MANAGED_PATHS } from './overlay-policies.js';
export class GeminiAdapter {
    nativeFileHandler;
    canonicalTransformer;
    skillSurfaces = [
        {
            id: 'gemini-cli',
            destinationRoot: (context) => path.join(context.homeDir, '.gemini', 'skills'),
            supportsManagedDirectoryLinks: (platform) => platform === 'darwin',
        },
        {
            id: 'antigravity',
            destinationRoot: (context) => path.join(context.homeDir, '.gemini', 'config', 'skills'),
            supportsManagedDirectoryLinks: (_platform) => false,
        },
    ];
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
    async project(source, request, context) {
        const write = (file) => atomicWriteFile(file.targetPath, file.content);
        if (request.scope === 'project') {
            return { files: projectRulesManagedFile(request.targetRoot, 'GEMINI.md', source), write };
        }
        const canonicalSource = toCanonicalDeploySource(source);
        const [nativeFiles, canonicalFiles] = await Promise.all([
            Promise.resolve(this.projectNativeAssets(source.nativeAssets, context)),
            this.canonicalTransformer.deploy(canonicalSource, context),
        ]);
        const settingsPath = path.join(context.homeDir, '.gemini', 'settings.json');
        const antigravityMcpPath = path.join(context.homeDir, '.gemini', 'config', 'mcp_config.json');
        return {
            files: this.mergeSettings(this.mergeSettings(nativeFiles, canonicalFiles, settingsPath), [], antigravityMcpPath),
            write,
        };
    }
    projectNativeAssets(nativeAssets, context) {
        const files = [];
        for (const [assetId, content] of nativeAssets) {
            const parsed = parseAssetId(assetId);
            if (parsed.type !== 'native' || parsed.target !== 'gemini')
                continue;
            const file = projectGeminiNativeAsset(parsed.fileId, content, context);
            if (file)
                files.push(file);
        }
        return files;
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
