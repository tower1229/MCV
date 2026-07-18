import * as fs from 'fs';
import * as path from 'path';
import type {
  DetectedConfigDirectory,
  DetectedConfigFile,
  DeviceContext,
  NativeFileHandler,
} from './types';

export class ClaudeCodeNativeFileHandler implements NativeFileHandler {
  discoverDirectories(context: DeviceContext): DetectedConfigDirectory[] {
    const configRoot = path.join(context.homeDir, '.claude');

    return [
      {
        id: 'config-root',
        path: configRoot,
        exists: fs.existsSync(configRoot),
      },
    ];
  }

  async discoverFiles(context: DeviceContext): Promise<DetectedConfigFile[]> {
    const candidates = [
      {
        id: 'user-settings',
        path: path.join(context.homeDir, '.claude', 'settings.json'),
      },
      {
        id: 'user-instructions',
        path: path.join(context.homeDir, '.claude', 'CLAUDE.md'),
      },
      {
        id: 'user-state',
        path: path.join(context.homeDir, '.claude.json'),
      },
    ] satisfies Omit<DetectedConfigFile, 'exists'>[];

    return candidates.map((candidate) => ({
      ...candidate,
      exists: fs.existsSync(candidate.path),
    }));
  }
}
