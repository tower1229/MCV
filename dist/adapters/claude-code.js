import * as fs from 'fs';
import * as path from 'path';
import { parseAssetId } from '../assets/ids.js';
import { toManagedDeploySource } from '../assets/selected-repository-view.js';
import { atomicWriteFile } from '../utils/files.js';
import { mergeStructuredOverlay, parseStructuredObject, stringifyStructuredObject, } from '../utils/structured-config.js';
import { projectInstructionsManagedFile } from './adapter-utils.js';
import { ClaudeCodeNativeFileHandler, projectClaudeCodeNativeAsset } from './claude-code-native-file-handler.js';
import { ClaudeCodeManagedTransformer } from './claude-code-canonical-transformer.js';
import { CLAUDE_CODE_MANAGED_PATHS } from './overlay-policies.js';
export class ClaudeCodeAdapter {
    nativeFileHandler;
    managedTransformer;
    skillSurfaces = [{
            id: 'claude-code',
            destinationRoot: (context) => path.join(context.env.CLAUDE_CONFIG_DIR || path.join(context.homeDir, '.claude'), 'skills'),
            supportsManagedDirectoryLinks: (platform) => platform === 'darwin',
        }];
    constructor(nativeFileHandler = new ClaudeCodeNativeFileHandler(), managedTransformer = new ClaudeCodeManagedTransformer()) {
        this.nativeFileHandler = nativeFileHandler;
        this.managedTransformer = managedTransformer;
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
        return this.managedTransformer.transform(nativeCapture, context);
    }
    async project(source, request, context) {
        const write = (file) => atomicWriteFile(file.targetPath, file.content);
        if (request.scope === 'project') {
            return { files: projectInstructionsManagedFile(request.targetRoot, 'claude-code', 'CLAUDE.md', source), write };
        }
        const managedSource = toManagedDeploySource(source, 'claude-code');
        const [nativeFiles, managedFiles] = await Promise.all([
            Promise.resolve(this.projectNativeAssets(source.nativeAssets, context)),
            this.managedTransformer.deploy(managedSource, context),
        ]);
        return {
            files: this.mergeDeploymentFiles(nativeFiles, managedFiles, context),
            write,
        };
    }
    projectNativeAssets(nativeAssets, context) {
        const files = [];
        for (const [assetId, content] of nativeAssets) {
            const parsed = parseAssetId(assetId);
            if (parsed.type !== 'native' || parsed.target !== 'claude-code')
                continue;
            const file = projectClaudeCodeNativeAsset(parsed.fileId, content, context);
            if (file)
                files.push(file);
        }
        return files;
    }
    mergeDeploymentFiles(nativeFiles, managedFiles, context) {
        const mergedPaths = [
            path.join(context.env.CLAUDE_CONFIG_DIR || path.join(context.homeDir, '.claude'), 'settings.json'),
            path.join(context.homeDir, '.claude.json'),
        ];
        const otherFiles = [...nativeFiles, ...managedFiles].filter((file) => !mergedPaths.includes(file.targetPath));
        const mergedFiles = mergedPaths.flatMap((targetPath) => {
            const nativeFile = nativeFiles.find((file) => file.targetPath === targetPath);
            const managedFile = managedFiles.find((file) => file.targetPath === targetPath);
            if (!nativeFile && !managedFile)
                return [];
            const existingFile = this.nativeFileHandler.readDeployTarget(targetPath);
            const existing = existingFile
                ? parseStructuredObject(existingFile.content.toString(), 'json', targetPath)
                : {};
            const native = nativeFile
                ? parseStructuredObject(nativeFile.content.toString(), 'json', targetPath)
                : {};
            const canonical = managedFile
                ? parseStructuredObject(managedFile.content.toString(), 'json', targetPath)
                : undefined;
            return [{
                    targetPath,
                    content: stringifyStructuredObject(mergeStructuredOverlay(existing, native, canonical, CLAUDE_CODE_MANAGED_PATHS), 'json'),
                }];
        });
        return [...otherFiles, ...mergedFiles];
    }
    hasExecutable(context) {
        const platform = context.platform;
        const pathEnv = context.pathEnv ?? context.env.PATH ?? '';
        const delimiter = platform === 'win32' ? ';' : ':';
        const extensions = platform === 'win32'
            ? (context.pathExt ?? context.env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD')
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
