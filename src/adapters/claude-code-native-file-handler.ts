import * as fs from 'fs';
import * as path from 'path';
import { isRecord } from '../utils/objects';
import { atomicWriteTextFile } from '../utils/files';
import { isSensitiveFile, sanitizeConfig } from '../utils/sanitize';
import { resolvePortableValue } from '../utils/variables';
import type {
  CaptureFile,
  CapturedManagedField,
  CapturedManagedFile,
  DetectedConfigDirectory,
  DetectedConfigFile,
  DeployOperation,
  DeviceContext,
  NativeFileHandler,
  NativeCaptureResult,
} from './types';

interface JsonCapturePolicy {
  repositoryPath: string;
  managedPaths: ReadonlySet<string>;
  localPaths: ReadonlySet<string>;
}

const JSON_CAPTURE_POLICIES: Record<string, JsonCapturePolicy> = {
  'user-settings': {
    repositoryPath: 'ide/claude-code/native/settings.json',
    managedPaths: new Set(['$.mcpServers']),
    localPaths: new Set(),
  },
  'user-state': {
    repositoryPath: 'ide/claude-code/native/.claude.json',
    managedPaths: new Set(['$.mcpServers']),
    localPaths: new Set(['$.projects']),
  },
};

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

  async capture(
    files: DetectedConfigFile[],
    context: DeviceContext,
  ): Promise<NativeCaptureResult> {
    const capturedFiles: CaptureFile[] = [];
    const managedFiles: CapturedManagedFile[] = [];
    const managedFields: CapturedManagedField[] = [];
    const warnings: string[] = [];
    let sensitiveFieldCount = 0;
    let parameterizedPathCount = 0;
    let excludedFileCount = 0;

    for (const file of files.filter((candidate) => candidate.exists)) {
      if (isSensitiveFile(file.path)) {
        excludedFileCount += 1;
        continue;
      }

      if (file.id === 'user-instructions') {
        const sanitized = sanitizeConfig(fs.readFileSync(file.path, 'utf8'), context);
        sensitiveFieldCount += sanitized.sensitiveFieldCount;
        parameterizedPathCount += sanitized.parameterizedPathCount;
        managedFiles.push({
          id: file.id,
          sourcePath: file.path,
          content: sanitized.value,
        });
        continue;
      }

      const policy = JSON_CAPTURE_POLICIES[file.id];
      if (!policy) continue;
      const parsed = this.readJsonObject(file.path, warnings);
      if (!parsed) continue;
      const nativeFields: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(parsed)) {
        const objectPath = `$.${key}`;
        if (policy.localPaths.has(objectPath)) continue;

        if (policy.managedPaths.has(objectPath)) {
          const sanitized = sanitizeConfig({ [key]: value }, context);
          sensitiveFieldCount += sanitized.sensitiveFieldCount;
          parameterizedPathCount += sanitized.parameterizedPathCount;
          managedFields.push({
            sourcePath: file.path,
            path: objectPath,
            value: sanitized.value[key],
          });
        } else {
          nativeFields[key] = value;
        }
      }

      if (Object.keys(nativeFields).length > 0) {
        const sanitized = sanitizeConfig(nativeFields, context);
        sensitiveFieldCount += sanitized.sensitiveFieldCount;
        parameterizedPathCount += sanitized.parameterizedPathCount;
        capturedFiles.push({
          sourcePath: file.path,
          repositoryPath: policy.repositoryPath,
          content: `${JSON.stringify(sanitized.value, null, 2)}\n`,
          ownership: 'native',
        });
      }
    }

    return {
      files: capturedFiles,
      managedFiles,
      managedFields,
      summary: {
        fileCount: capturedFiles.length,
        sensitiveFieldCount,
        parameterizedPathCount,
        excludedFileCount,
      },
      warnings,
    };
  }

  async deploy(
    repositoryPath: string,
    context: DeviceContext,
  ): Promise<DeployOperation> {
    const nativeRoot = path.join(repositoryPath, 'ide', 'claude-code', 'native');
    const mappings = [
      {
        sourcePath: path.join(nativeRoot, 'settings.json'),
        targetPath: path.join(context.homeDir, '.claude', 'settings.json'),
      },
      {
        sourcePath: path.join(nativeRoot, '.claude.json'),
        targetPath: path.join(context.homeDir, '.claude.json'),
      },
    ];

    const files = mappings.flatMap((mapping) => {
      if (!fs.existsSync(mapping.sourcePath)) return [];
      const parsed = JSON.parse(fs.readFileSync(mapping.sourcePath, 'utf8')) as unknown;
      if (!isRecord(parsed)) {
        throw new Error(`${mapping.sourcePath} must contain a JSON object.`);
      }
      const resolved = resolvePortableValue(
        parsed,
        context.variables ?? {},
        context.platform ?? process.platform,
      );
      return [{
        targetPath: mapping.targetPath,
        content: `${JSON.stringify(resolved, null, 2)}\n`,
      }];
    });
    return {
      files,
      write: (file) => atomicWriteTextFile(file.targetPath, file.content),
    };
  }

  private readJsonObject(
    filePath: string,
    warnings: string[],
  ): Record<string, unknown> | undefined {
    try {
      const parsed: unknown = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      if (!isRecord(parsed)) {
        warnings.push(`Skipped ${filePath}: expected a JSON object.`);
        return undefined;
      }
      return parsed;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      warnings.push(`Skipped ${filePath}: ${message}`);
      return undefined;
    }
  }

}
