import * as fs from 'fs';
import * as path from 'path';
import { atomicWriteFile } from '../utils/files.js';
import { parameterizeConfig } from '../utils/parameterize.js';
import {
  deleteObjectPath,
  parseStructuredObject,
  splitOwnedFields,
  stringifyStructuredObject,
} from '../utils/structured-config.js';
import { resolvePortableValue } from '../utils/variables.js';
import { readDeployTarget, repositoryFileForPlatform } from './adapter-utils.js';
import { CODEX_MANAGED_PATHS } from './overlay-policies.js';
import type {
  DetectedConfigDirectory,
  DetectedConfigFile,
  DeployFile,
  DeployOperation,
  DeviceContext,
  NativeCaptureResult,
  NativeFileHandler,
} from './types.js';

const LOCAL_PATHS = [
  '$.projects', '$.notify', '$.marketplaces',
  '$.shell_environment_policy.set.NODE_REPL_TRUSTED_BROWSER_CLIENT_SHA256S',
  '$.shell_environment_policy.set.NODE_REPL_TRUSTED_CODE_PATHS',
];

export class CodexNativeFileHandler implements NativeFileHandler {
  private root(context: DeviceContext): string {
    return context.env?.CODEX_HOME || path.join(context.homeDir, '.codex');
  }
  discoverDirectories(context: DeviceContext): DetectedConfigDirectory[] {
    const configRoot = this.root(context);
    return [{ id: 'config-root', path: configRoot, exists: fs.existsSync(configRoot) }];
  }

  async discoverFiles(context: DeviceContext): Promise<DetectedConfigFile[]> {
    return [
      { id: 'user-settings', path: path.join(this.root(context), 'config.toml') },
      { id: 'user-instructions', path: path.join(this.root(context), 'AGENTS.md') },
    ].map((file) => ({ ...file, exists: fs.existsSync(file.path) }));
  }

  async capture(
    files: DetectedConfigFile[],
    context: DeviceContext,
  ): Promise<NativeCaptureResult> {
    const result: NativeCaptureResult = {
      files: [],
      managedFiles: [],
      managedFields: [],
      summary: {
        fileCount: 0,
        parameterizedPathCount: 0,
        excludedFileCount: 0,
      },
      warnings: [],
    };
    for (const file of files.filter((candidate) => candidate.exists)) {
      if (file.id === 'user-instructions') {
        const parameterized = parameterizeConfig(fs.readFileSync(file.path, 'utf8'), context);
        result.summary.parameterizedPathCount += parameterized.parameterizedPathCount;
        result.managedFiles.push({
          id: file.id,
          sourcePath: file.path,
          content: parameterized.value,
        });
        continue;
      }
      if (file.id !== 'user-settings') continue;
      try {
        const parsed = parseStructuredObject(
          fs.readFileSync(file.path, 'utf8'),
          'toml',
          file.path,
        );
        const owned = splitOwnedFields(parsed, CODEX_MANAGED_PATHS, LOCAL_PATHS);
        removeCodexRuntimeFields(owned.native);
        const native = parameterizeConfig(owned.native, context);
        result.summary.parameterizedPathCount += native.parameterizedPathCount;
        if (Object.keys(native.value).length > 0) {
          result.files.push({
            sourcePath: file.path,
            repositoryPath: 'ide/codex/native/config.toml',
            content: stringifyStructuredObject(native.value, 'toml'),
            ownership: 'native',
            localPaths: LOCAL_PATHS,
          });
        }
        for (const field of owned.managed) {
          const parameterized = parameterizeConfig(field.value, context);
          result.summary.parameterizedPathCount += parameterized.parameterizedPathCount;
          result.managedFields.push({
            sourcePath: file.path,
            path: field.path,
            value: parameterized.value,
          });
        }
      } catch (error) {
        result.warnings.push(
          `Skipped ${file.path}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    return result;
  }

  async deploy(
    repositoryPath: string,
    context: DeviceContext,
  ): Promise<DeployOperation> {
    const sourcePath = repositoryFileForPlatform(repositoryPath, 'ide/codex/native/config.toml', context);
    const files: DeployFile[] = [];
    if (fs.existsSync(sourcePath)) {
      const file = projectCodexNativeUserSettings(fs.readFileSync(sourcePath), context);
      if (file) files.push(file);
    }
    return { files, write: (file) => atomicWriteFile(file.targetPath, file.content) };
  }

  readDeployTarget(targetPath: string): DeployFile | undefined {
    return readDeployTarget(targetPath);
  }
}

export function projectCodexNativeUserSettings(
  content: Buffer,
  context: DeviceContext,
): DeployFile | undefined {
  const targetPath = path.join(
    context.env?.CODEX_HOME || path.join(context.homeDir, '.codex'),
    'config.toml',
  );
  const parsed = parseStructuredObject(content.toString('utf8'), 'toml', 'native:codex/user-settings');
  const resolved = resolvePortableValue(
    parsed,
    context.variables ?? {},
    context.platform,
  ) as Record<string, unknown>;
  for (const localPath of LOCAL_PATHS) deleteObjectPath(resolved, localPath);
  removeCodexRuntimeFields(resolved);
  return { targetPath, content: stringifyStructuredObject(resolved, 'toml') };
}

function removeCodexRuntimeFields(value: Record<string, unknown>): void {
  const policy = value.shell_environment_policy;
  if (!policy || typeof policy !== 'object' || Array.isArray(policy)) return;
  const set = (policy as Record<string, unknown>).set;
  if (!set || typeof set !== 'object' || Array.isArray(set)) return;
  for (const key of Object.keys(set as Record<string, unknown>)) {
    if (/^(NODE_REPL|CODEX_|OPENAI_CODEX_)/i.test(key)) delete (set as Record<string, unknown>)[key];
  }
  if (Object.keys(set as Record<string, unknown>).length === 0) delete (policy as Record<string, unknown>).set;
}
