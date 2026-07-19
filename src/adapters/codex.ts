import * as path from 'path';
import { mergeStructuredOverlay, parseStructuredObject, stringifyStructuredObject } from '../utils/structured-config';
import { hasExecutable } from './adapter-utils';
import { CodexCanonicalTransformer } from './codex-canonical-transformer';
import { CodexNativeFileHandler } from './codex-native-file-handler';
import { CODEX_MANAGED_PATHS } from './overlay-policies';
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
} from './types';

export class CodexAdapter implements IdeAdapter {
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

  async deploy(repositoryPath: string, context: DeviceContext): Promise<DeployOperation> {
    const [nativeOperation, canonicalSource] = await Promise.all([
      this.nativeFileHandler.deploy(repositoryPath, context),
      this.nativeFileHandler.readCanonical(repositoryPath, context),
    ]);
    const canonicalFiles = await this.canonicalTransformer.deploy(canonicalSource, context);
    const configPath = path.join((context.env ?? process.env).CODEX_HOME || path.join(context.homeDir, '.codex'), 'config.toml');
    return {
      files: this.mergeConfig(nativeOperation.files, canonicalFiles, configPath),
      write: nativeOperation.write,
    };
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
