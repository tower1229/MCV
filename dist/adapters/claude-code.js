import * as fs from 'fs';
import * as path from 'path';
import { mergeStructuredOverlay, parseStructuredObject, stringifyStructuredObject, } from '../utils/structured-config.js';
import { ClaudeCodeNativeFileHandler } from './claude-code-native-file-handler.js';
import { ClaudeCodeCanonicalTransformer } from './claude-code-canonical-transformer.js';
import { CLAUDE_CODE_MANAGED_PATHS } from './overlay-policies.js';
export class ClaudeCodeAdapter {
    nativeFileHandler;
    canonicalTransformer;
    constructor(nativeFileHandler = new ClaudeCodeNativeFileHandler(), canonicalTransformer = new ClaudeCodeCanonicalTransformer()) {
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
            path.join(context.env.CLAUDE_CONFIG_DIR || path.join(context.homeDir, '.claude'), 'settings.json'),
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
                ? parseStructuredObject(existingFile.content.toString(), 'json', targetPath)
                : {};
            const native = nativeFile
                ? parseStructuredObject(nativeFile.content.toString(), 'json', targetPath)
                : {};
            const canonical = canonicalFile
                ? parseStructuredObject(canonicalFile.content.toString(), 'json', targetPath)
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
