import * as fs from 'fs';
import * as path from 'path';
import { ClaudeCodeNativeFileHandler } from './claude-code-native-file-handler';
import { ClaudeCodeCanonicalTransformer } from './claude-code-canonical-transformer';
import type {
  CanonicalTransformer,
  CaptureResult,
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
