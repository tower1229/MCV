import * as path from 'path';
import { mergeStructuredOverlay, parseStructuredObject, stringifyStructuredObject } from '../utils/structured-config.js';
import { hasExecutable } from './adapter-utils.js';
import { GeminiCanonicalTransformer } from './gemini-canonical-transformer.js';
import { GeminiNativeFileHandler } from './gemini-native-file-handler.js';
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
  readonly skillSurface = {
    destinationRoot: (context: DeviceContext) => path.join(context.homeDir, '.gemini', 'skills'),
    supportsManagedDirectoryLinks: (_platform: NodeJS.Platform) => false,
  };

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

  async deploy(repositoryPath: string, context: DeviceContext): Promise<DeployOperation> {
    const [nativeOperation, canonicalSource] = await Promise.all([
      this.nativeFileHandler.deploy(repositoryPath, context),
      this.nativeFileHandler.readCanonical(repositoryPath, context),
    ]);
    const canonicalFiles = await this.canonicalTransformer.deploy(canonicalSource, context);
    const settingsPath = path.join(context.homeDir, '.gemini', 'settings.json');
    const antigravityMcpPath = path.join(context.homeDir, '.gemini', 'config', 'mcp_config.json');
    return {
      files: this.mergeSettings(
        this.mergeSettings(nativeOperation.files, canonicalFiles, settingsPath),
        [],
        antigravityMcpPath,
      ),
      write: nativeOperation.write,
    };
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
