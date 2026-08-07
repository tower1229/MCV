import * as path from 'path';
import { parseAssetId } from '../assets/ids.js';
import type { DeployRequest } from '../assets/deploy-request.js';
import { toCanonicalDeploySource, type SelectedRepositoryView } from '../assets/selected-repository-view.js';
import { atomicWriteFile } from '../utils/files.js';
import { mergeStructuredOverlay, parseStructuredObject, stringifyStructuredObject } from '../utils/structured-config.js';
import { hasExecutable } from './adapter-utils.js';
import { GeminiCanonicalTransformer } from './gemini-canonical-transformer.js';
import { GeminiNativeFileHandler, projectGeminiNativeAsset } from './gemini-native-file-handler.js';
import { GEMINI_MANAGED_PATHS } from './overlay-policies.js';
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

export class GeminiAdapter implements IdeAdapter {
  readonly skillSurfaces = [
    {
      id: 'gemini-cli',
      destinationRoot: (context: DeviceContext) => path.join(context.homeDir, '.gemini', 'skills'),
      supportsManagedDirectoryLinks: (platform: NodeJS.Platform) => platform === 'darwin',
    },
    {
      id: 'antigravity',
      destinationRoot: (context: DeviceContext) =>
        path.join(context.homeDir, '.gemini', 'config', 'skills'),
      supportsManagedDirectoryLinks: (_platform: NodeJS.Platform) => false,
    },
  ] as const;

  constructor(
    private readonly nativeFileHandler: NativeFileHandler = new GeminiNativeFileHandler(),
    private readonly canonicalTransformer: CanonicalTransformer = new GeminiCanonicalTransformer(),
  ) {}

  async detect(context: DeviceContext): Promise<DetectedIde> {
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

  discoverFiles(context: DeviceContext): Promise<DetectedConfigFile[]> {
    return this.nativeFileHandler.discoverFiles(context);
  }

  async capture(files: DetectedConfigFile[], context: DeviceContext): Promise<CaptureResult> {
    return this.canonicalTransformer.transform(
      await this.nativeFileHandler.capture(files, context),
      context,
    );
  }

  async project(
    source: SelectedRepositoryView,
    request: DeployRequest,
    context: DeviceContext,
  ): Promise<DeployOperation> {
    const write = (file: DeployFile) => atomicWriteFile(file.targetPath, file.content);
    if (request.scope === 'project') {
      return { files: [], write };
    }

    const canonicalSource = toCanonicalDeploySource(source);
    const [nativeFiles, canonicalFiles] = await Promise.all([
      Promise.resolve(this.projectNativeAssets(source.nativeAssets, context)),
      this.canonicalTransformer.deploy(canonicalSource, context),
    ]);
    const settingsPath = path.join(context.homeDir, '.gemini', 'settings.json');
    const antigravityMcpPath = path.join(context.homeDir, '.gemini', 'config', 'mcp_config.json');
    return {
      files: this.mergeSettings(
        this.mergeSettings(nativeFiles, canonicalFiles, settingsPath),
        [],
        antigravityMcpPath,
      ),
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
      if (parsed.type !== 'native' || parsed.target !== 'gemini') continue;
      const file = projectGeminiNativeAsset(parsed.fileId, content, context);
      if (file) files.push(file);
    }
    return files;
  }

  private mergeSettings(
    nativeFiles: DeployFile[],
    canonicalFiles: DeployFile[],
    settingsPath: string,
  ): DeployFile[] {
    const native = nativeFiles.find((file) => file.targetPath === settingsPath);
    const managed = canonicalFiles.find((file) => file.targetPath === settingsPath)
      ?? nativeFiles.slice().reverse().find((file) => file.targetPath === settingsPath);
    const other = [...nativeFiles, ...canonicalFiles].filter((file) => file.targetPath !== settingsPath);
    if (!native && !managed) return other;
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
      content: stringifyStructuredObject(
        mergeStructuredOverlay(existing, nativeValue, managedValue, GEMINI_MANAGED_PATHS),
        'json',
      ),
    }];
  }
}
