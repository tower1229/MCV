import * as path from 'path';
import { parseAssetId } from '../assets/ids.js';
import type { DeployRequest } from '../assets/deploy-request.js';
import { toCanonicalDeploySource, type SelectedRepositoryView } from '../assets/selected-repository-view.js';
import { atomicWriteFile } from '../utils/files.js';
import { mergeStructuredOverlay, parseStructuredObject, stringifyStructuredObject } from '../utils/structured-config.js';
import { hasExecutable } from './adapter-utils.js';
import { CodexCanonicalTransformer } from './codex-canonical-transformer.js';
import { CodexNativeFileHandler, projectCodexNativeUserSettings } from './codex-native-file-handler.js';
import { CODEX_MANAGED_PATHS } from './overlay-policies.js';
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

export class CodexAdapter implements IdeAdapter {
  readonly skillSurfaces = [{
    id: 'codex',
    destinationRoot: (context: DeviceContext) => path.join(context.homeDir, '.agents', 'skills'),
    supportsManagedDirectoryLinks: (platform: NodeJS.Platform) => platform === 'darwin',
  }] as const;

  constructor(
    private readonly nativeFileHandler: NativeFileHandler = new CodexNativeFileHandler(),
    private readonly canonicalTransformer: CanonicalTransformer = new CodexCanonicalTransformer(),
  ) {}

  async detect(context: DeviceContext): Promise<DetectedIde> {
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
    const configPath = path.join(context.env.CODEX_HOME || path.join(context.homeDir, '.codex'), 'config.toml');
    return {
      files: this.mergeConfig(nativeFiles, canonicalFiles, configPath),
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
      if (parsed.type !== 'native' || parsed.target !== 'codex') continue;
      const file = projectCodexNativeUserSettings(content, context);
      if (file) files.push(file);
    }
    return files;
  }

  private mergeConfig(
    nativeFiles: DeployFile[],
    canonicalFiles: DeployFile[],
    configPath: string,
  ): DeployFile[] {
    const native = nativeFiles.find((file) => file.targetPath === configPath);
    const managed = canonicalFiles.find((file) => file.targetPath === configPath);
    const other = [...nativeFiles, ...canonicalFiles].filter((file) => file.targetPath !== configPath);
    if (!native && !managed) return other;
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
      content: stringifyStructuredObject(
        mergeStructuredOverlay(existing, nativeValue, managedValue, CODEX_MANAGED_PATHS),
        'toml',
      ),
    }];
  }
}
