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

const MANAGED_PATHS = ['$.mcpServers'];

export class GeminiNativeFileHandler implements NativeFileHandler {
  discoverDirectories(context: DeviceContext): DetectedConfigDirectory[] {
    const configRoot = path.join(context.homeDir, '.gemini');
    return [{ id: 'config-root', path: configRoot, exists: fs.existsSync(configRoot) }];
  }

  async discoverFiles(context: DeviceContext): Promise<DetectedConfigFile[]> {
    return [
      { id: 'user-settings', path: path.join(context.homeDir, '.gemini', 'settings.json') },
      { id: 'user-instructions', path: path.join(context.homeDir, '.gemini', 'GEMINI.md') },
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
          'json',
          file.path,
        );
        const owned = splitOwnedFields(parsed, MANAGED_PATHS, []);
        const native = sanitizeConfig(owned.native, context);
        result.summary.sensitiveFieldCount += native.sensitiveFieldCount;
        result.summary.parameterizedPathCount += native.parameterizedPathCount;
        if (Object.keys(native.value).length > 0) {
          result.files.push({
            sourcePath: file.path,
            repositoryPath: 'ide/gemini/native/settings.json',
            content: stringifyStructuredObject(native.value, 'json'),
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
    const sourcePath = path.join(repositoryPath, 'ide', 'gemini', 'native', 'settings.json');
    const targetPath = path.join(context.homeDir, '.gemini', 'settings.json');
    const files: DeployFile[] = [];
    if (fs.existsSync(sourcePath)) {
      const parsed = parseStructuredObject(fs.readFileSync(sourcePath, 'utf8'), 'json', sourcePath);
      const resolved = resolvePortableValue(
        parsed,
        context.variables ?? {},
        context.platform ?? process.platform,
      );
      files.push({
        targetPath,
        content: stringifyStructuredObject(resolved as Record<string, unknown>, 'json'),
      });
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
