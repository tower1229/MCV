import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'yaml';
import type { SelectedRepositoryView } from '../assets/selected-repository-view.js';
import type { DeployFile, DeviceContext } from './types.js';
import { resolvePortableValue } from '../utils/variables.js';

export function hasExecutable(
  executable: string,
  context: DeviceContext,
): boolean {
  const platform = context.platform;
  const pathEnv = context.pathEnv ?? context.env.PATH ?? '';
  const delimiter = platform === 'win32' ? ';' : ':';
  const extensions = platform === 'win32'
    ? (context.pathExt ?? context.env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD')
        .split(';')
        .filter(Boolean)
        .map((extension) => extension.toLowerCase())
    : [''];
  return pathEnv.split(delimiter).filter(Boolean).some((directory) =>
    extensions.some((extension) => {
      const candidate = path.join(directory, `${executable}${extension}`);
      try {
        if (!fs.statSync(candidate).isFile()) return false;
        if (platform !== 'win32') fs.accessSync(candidate, fs.constants.X_OK);
        return true;
      } catch {
        return false;
      }
    }),
  );
}

export function readDeployTarget(targetPath: string): DeployFile | undefined {
  if (!fs.existsSync(targetPath)) return undefined;
  return { targetPath, content: fs.readFileSync(targetPath) };
}

export function repositoryFileForPlatform(
  repositoryPath: string,
  relativePath: string,
  context: DeviceContext,
): string {
  const platformDirectory = context.platform === 'win32' ? 'windows' : 'macos';
  const override = path.join(repositoryPath, 'overrides', platformDirectory, ...relativePath.split('/'));
  return fs.existsSync(override) ? override : path.join(repositoryPath, ...relativePath.split('/'));
}

export function projectInstructionsManagedFile(
  targetRoot: string,
  target: import('./types.js').IdeId,
  relativePath: 'AGENTS.md' | 'CLAUDE.md' | 'GEMINI.md',
  source: SelectedRepositoryView,
): DeployFile[] {
  const instructions = source.instructions[target];
  if (!instructions) return [];
  // Deploy rebuilds Managed Block content (and Drift checks) in the operation module.
  return [{
    targetPath: path.join(targetRoot, relativePath),
    content: instructions.content,
  }];
}
