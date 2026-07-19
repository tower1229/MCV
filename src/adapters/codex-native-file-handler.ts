import * as fs from 'fs';
import * as path from 'path';
import { atomicWriteFile } from '../utils/files';
import { sanitizeConfig } from '../utils/sanitize';
import {
  parseStructuredObject,
  splitOwnedFields,
  stringifyStructuredObject,
} from '../utils/structured-config';
import { resolvePortableValue } from '../utils/variables';
import { readCanonicalSource, readDeployTarget, repositoryFileForPlatform } from './adapter-utils';
import { CODEX_MANAGED_PATHS } from './overlay-policies';
import type {
  CanonicalDeploySource,
  DetectedConfigDirectory,
  DetectedConfigFile,
  DeployFile,
  DeployOperation,
  DeviceContext,
  NativeCaptureResult,
  NativeFileHandler,
} from './types';

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
        sensitiveFieldCount: 0,
        parameterizedPathCount: 0,
        excludedFileCount: 0,
      },
      warnings: [],
    };
    for (const file of files.filter((candidate) => candidate.exists)) {
      if (file.id === 'user-instructions') {
        const sanitized = sanitizeConfig(fs.readFileSync(file.path, 'utf8'), context);
        result.summary.sensitiveFieldCount += sanitized.sensitiveFieldCount;
        result.summary.parameterizedPathCount += sanitized.parameterizedPathCount;
        result.managedFiles.push({
          id: file.id,
          sourcePath: file.path,
          content: sanitized.value,
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
        const native = sanitizeConfig(owned.native, context);
        result.summary.sensitiveFieldCount += native.sensitiveFieldCount;
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
          const sanitized = sanitizeConfig(field.value, context);
          result.summary.sensitiveFieldCount += sanitized.sensitiveFieldCount;
          result.summary.parameterizedPathCount += sanitized.parameterizedPathCount;
          result.managedFields.push({
            sourcePath: file.path,
            path: field.path,
            value: sanitized.value,
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
    const targetPath = path.join(this.root(context), 'config.toml');
    const files: DeployFile[] = [];
    if (fs.existsSync(sourcePath)) {
      const parsed = parseStructuredObject(fs.readFileSync(sourcePath, 'utf8'), 'toml', sourcePath);
      const resolved = resolvePortableValue(
        parsed,
        context.variables ?? {},
        context.platform ?? process.platform,
      ) as Record<string, unknown>;
      files.push({ targetPath, content: stringifyStructuredObject(resolved, 'toml') });
    }
    return { files, write: (file) => atomicWriteFile(file.targetPath, file.content) };
  }

  async readCanonical(
    repositoryPath: string,
    context: DeviceContext,
  ): Promise<CanonicalDeploySource> {
    return readCanonicalSource(repositoryPath, context);
  }

  readDeployTarget(targetPath: string): DeployFile | undefined {
    return readDeployTarget(targetPath);
  }
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
