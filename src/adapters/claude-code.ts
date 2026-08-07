import * as fs from 'fs';
import * as path from 'path';
import { parseAssetId } from '../assets/ids.js';
import type { DeployRequest } from '../assets/deploy-request.js';
import { toCanonicalDeploySource, type SelectedRepositoryView } from '../assets/selected-repository-view.js';
import { atomicWriteFile } from '../utils/files.js';
import {
  mergeStructuredOverlay,
  parseStructuredObject,
  stringifyStructuredObject,
} from '../utils/structured-config.js';
import { projectRulesManagedFile } from './adapter-utils.js';
import { ClaudeCodeNativeFileHandler, projectClaudeCodeNativeAsset } from './claude-code-native-file-handler.js';
import { ClaudeCodeCanonicalTransformer } from './claude-code-canonical-transformer.js';
import type {
  CanonicalTransformer,
  CaptureResult,
  DeployFile,
  DeployOperation,
  DetectedConfigFile,
  DetectedIde,
  DeviceContext,
  IdeAdapter,
  NativeFileHandler,
} from './types.js';
import { CLAUDE_CODE_MANAGED_PATHS } from './overlay-policies.js';

export class ClaudeCodeAdapter implements IdeAdapter {
  readonly skillSurfaces = [{
    id: 'claude-code',
    destinationRoot: (context: DeviceContext) => path.join(
      context.env.CLAUDE_CONFIG_DIR || path.join(context.homeDir, '.claude'),
      'skills',
    ),
    supportsManagedDirectoryLinks: (platform: NodeJS.Platform) => platform === 'darwin',
  }] as const;

  constructor(
    private readonly nativeFileHandler: NativeFileHandler = new ClaudeCodeNativeFileHandler(),
    private readonly canonicalTransformer: CanonicalTransformer = new ClaudeCodeCanonicalTransformer(),
  ) {}

  async detect(context: DeviceContext): Promise<DetectedIde> {
    const configDirectories = this.nativeFileHandler.discoverDirectories(context);
    const files = await this.nativeFileHandler.discoverFiles(context);

    return {
      id: 'claude-code',
      name: 'Claude Code',
      detected:
        configDirectories.some((directory) => directory.exists)
        || files.some((file) => file.exists)
        || this.hasExecutable(context),
      configDirectories,
    };
  }

  async discoverFiles(context: DeviceContext): Promise<DetectedConfigFile[]> {
    return this.nativeFileHandler.discoverFiles(context);
  }

  async capture(
    files: DetectedConfigFile[],
    context: DeviceContext,
  ): Promise<CaptureResult> {
    const nativeCapture = await this.nativeFileHandler.capture(files, context);
    return this.canonicalTransformer.transform(nativeCapture, context);
  }

  async project(
    source: SelectedRepositoryView,
    request: DeployRequest,
    context: DeviceContext,
  ): Promise<DeployOperation> {
    const write = (file: DeployFile) => atomicWriteFile(file.targetPath, file.content);
    if (request.scope === 'project') {
      return { files: projectRulesManagedFile(request.targetRoot, 'CLAUDE.md', source), write };
    }

    const canonicalSource = toCanonicalDeploySource(source);
    const [nativeFiles, canonicalFiles] = await Promise.all([
      Promise.resolve(this.projectNativeAssets(source.nativeAssets, context)),
      this.canonicalTransformer.deploy(canonicalSource, context),
    ]);
    return {
      files: this.mergeDeploymentFiles(nativeFiles, canonicalFiles, context),
      write,
    };
  }

  private projectNativeAssets(
    nativeAssets: Map<string, Buffer>,
    context: DeviceContext,
  ): DeployFile[] {
    const files: DeployFile[] = [];
    for (const [assetId, content] of nativeAssets) {
      const parsed = parseAssetId(assetId);
      if (parsed.type !== 'native' || parsed.target !== 'claude-code') continue;
      const file = projectClaudeCodeNativeAsset(parsed.fileId, content, context);
      if (file) files.push(file);
    }
    return files;
  }

  private mergeDeploymentFiles(
    nativeFiles: DeployOperation['files'],
    canonicalFiles: DeployOperation['files'],
    context: DeviceContext,
  ): DeployOperation['files'] {
    const mergedPaths = [
      path.join(context.env.CLAUDE_CONFIG_DIR || path.join(context.homeDir, '.claude'), 'settings.json'),
      path.join(context.homeDir, '.claude.json'),
    ];
    const otherFiles = [...nativeFiles, ...canonicalFiles].filter(
      (file) => !mergedPaths.includes(file.targetPath),
    );
    const mergedFiles = mergedPaths.flatMap((targetPath) => {
      const nativeFile = nativeFiles.find((file) => file.targetPath === targetPath);
      const canonicalFile = canonicalFiles.find((file) => file.targetPath === targetPath);
      if (!nativeFile && !canonicalFile) return [];
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
        content: stringifyStructuredObject(
          mergeStructuredOverlay(existing, native, canonical, CLAUDE_CODE_MANAGED_PATHS),
          'json',
        ),
      }];
    });
    return [...otherFiles, ...mergedFiles];
  }

  private hasExecutable(context: DeviceContext): boolean {
    const platform = context.platform;
    const pathEnv = context.pathEnv ?? context.env.PATH ?? '';
    const delimiter = platform === 'win32' ? ';' : ':';
    const extensions =
      platform === 'win32'
        ? (context.pathExt ?? context.env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD')
            .split(';')
            .filter(Boolean)
            .map((extension) => extension.toLowerCase())
        : [''];

    return pathEnv
      .split(delimiter)
      .filter(Boolean)
      .some((directory) =>
        extensions.some((extension) =>
          this.isExecutableFile(
            path.join(directory, `claude${extension}`),
            platform,
          ),
        ),
      );
  }

  private isExecutableFile(filePath: string, platform: NodeJS.Platform): boolean {
    try {
      if (!fs.statSync(filePath).isFile()) {
        return false;
      }
      if (platform !== 'win32') {
        fs.accessSync(filePath, fs.constants.X_OK);
      }
      return true;
    } catch {
      return false;
    }
  }
}
