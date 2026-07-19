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
import { readCanonicalSource, readDeployTarget } from './adapter-utils';
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

const LOCAL_PATHS = ['$.projects'];

export class CodexNativeFileHandler implements NativeFileHandler {
  discoverDirectories(context: DeviceContext): DetectedConfigDirectory[] {
    const configRoot = path.join(context.homeDir, '.codex');
    return [{ id: 'config-root', path: configRoot, exists: fs.existsSync(configRoot) }];
  }

  async discoverFiles(context: DeviceContext): Promise<DetectedConfigFile[]> {
    return [
      { id: 'user-settings', path: path.join(context.homeDir, '.codex', 'config.toml') },
      { id: 'user-instructions', path: path.join(context.homeDir, '.codex', 'AGENTS.md') },
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
        const native = sanitizeConfig(owned.native, context);
        result.summary.sensitiveFieldCount += native.sensitiveFieldCount;
        result.summary.parameterizedPathCount += native.parameterizedPathCount;
        if (Object.keys(native.value).length > 0) {
          result.files.push({
            sourcePath: file.path,
            repositoryPath: 'ide/codex/native/config.toml',
            content: stringifyStructuredObject(native.value, 'toml'),
            ownership: 'native',
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
    const sourcePath = path.join(repositoryPath, 'ide', 'codex', 'native', 'config.toml');
    const targetPath = path.join(context.homeDir, '.codex', 'config.toml');
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
