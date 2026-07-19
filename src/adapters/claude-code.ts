import * as fs from 'fs';
import * as path from 'path';
import { isRecord, mergeRecords } from '../utils/objects';
import { ClaudeCodeNativeFileHandler } from './claude-code-native-file-handler';
import { ClaudeCodeCanonicalTransformer } from './claude-code-canonical-transformer';
import type {
  CanonicalTransformer,
  CaptureResult,
  DeployOperation,
  DetectedConfigFile,
  DetectedIde,
  DeviceContext,
  IdeAdapter,
  NativeFileHandler,
} from './types';

export class ClaudeCodeAdapter implements IdeAdapter {
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

  async deploy(
    repositoryPath: string,
    context: DeviceContext,
  ): Promise<DeployOperation> {
    const [nativeOperation, canonicalSource] = await Promise.all([
      this.nativeFileHandler.deploy(repositoryPath, context),
      this.nativeFileHandler.readCanonical(repositoryPath, context),
    ]);
    const canonicalFiles = await this.canonicalTransformer.deploy(
      canonicalSource,
      context,
    );
    const statePath = path.join(context.homeDir, '.claude.json');
    return {
      files: this.mergeDeploymentFiles(
        nativeOperation.files,
        canonicalFiles,
        statePath,
        this.nativeFileHandler.readDeployTarget(statePath),
      ),
      write: nativeOperation.write,
    };
  }

  private mergeDeploymentFiles(
    nativeFiles: DeployOperation['files'],
    canonicalFiles: DeployOperation['files'],
    statePath: string,
    existingState: DeployOperation['files'][number] | undefined,
  ): DeployOperation['files'] {
    const nativeState = nativeFiles.find((file) => file.targetPath === statePath);
    const canonicalState = canonicalFiles.find((file) => file.targetPath === statePath);
    const otherFiles = [...nativeFiles, ...canonicalFiles].filter(
      (file) => file.targetPath !== statePath,
    );
    if (!canonicalState) {
      return [...otherFiles, ...(nativeState ? [nativeState] : [])];
    }

    const existingValue = existingState
      ? JSON.parse(existingState.content.toString()) as unknown
      : {};
    const canonicalValue = JSON.parse(canonicalState.content.toString()) as unknown;
    const nativeValue = nativeState
      ? JSON.parse(nativeState.content.toString()) as unknown
      : {};
    if (
      !isRecord(existingValue)
      || !isRecord(nativeValue)
      || !isRecord(canonicalValue)
    ) {
      throw new Error('Claude Code state deployment inputs must be JSON objects.');
    }
    return [
      ...otherFiles,
      {
        targetPath: statePath,
        content: `${JSON.stringify(
          {
            ...mergeRecords(existingValue, nativeValue),
            ...canonicalValue,
          },
          null,
          2,
        )}\n`,
      },
    ];
  }

  private hasExecutable(context: DeviceContext): boolean {
    const platform = context.platform ?? process.platform;
    const pathEnv = context.pathEnv ?? process.env.PATH ?? '';
    const delimiter = platform === 'win32' ? ';' : ':';
    const extensions =
      platform === 'win32'
        ? (context.pathExt ?? process.env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD')
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
