import * as path from 'path';
import * as yaml from 'yaml';
import { isRecord } from '../utils/objects';
import type {
  CanonicalDeploySource,
  CanonicalTransformer,
  CaptureFile,
  CaptureResult,
  DeployFile,
  DeviceContext,
  NativeCaptureResult,
} from './types';

export class GeminiCanonicalTransformer implements CanonicalTransformer {
  transform(capture: NativeCaptureResult, _context: DeviceContext): CaptureResult {
    const files: CaptureFile[] = [...capture.files];
    const instructions = capture.managedFiles.find((file) => file.id === 'user-instructions');
    if (instructions) {
      files.push({
        sourcePath: instructions.sourcePath,
        repositoryPath: 'common/AGENTS.md',
        content: instructions.content,
        ownership: 'managed',
      });
    }
    const mcp = capture.managedFields.find((field) => field.path === '$.mcpServers');
    if (mcp && isRecord(mcp.value)) {
      files.push({
        sourcePath: mcp.sourcePath,
        repositoryPath: 'common/mcp.yaml',
        content: yaml.stringify({ servers: mcp.value }),
        ownership: 'managed',
      });
    }
    return {
      files,
      summary: { ...capture.summary, fileCount: files.length },
      warnings: capture.warnings,
    };
  }

  async deploy(
    source: CanonicalDeploySource,
    context: DeviceContext,
  ): Promise<DeployFile[]> {
    const files: DeployFile[] = [];
    if (source.rules !== undefined) {
      files.push({
        targetPath: path.join(context.homeDir, '.gemini', 'GEMINI.md'),
        content: source.rules,
      });
    }
    for (const skill of source.skills) {
      files.push({
        targetPath: path.join(context.homeDir, '.gemini', 'skills', skill.relativePath),
        content: skill.content,
      });
    }
    if (source.mcp !== undefined) {
      if (!isRecord(source.mcp) || !isRecord(source.mcp.servers)) {
        throw new Error('common/mcp.yaml must contain a servers object.');
      }
      files.push({
        targetPath: path.join(context.homeDir, '.gemini', 'settings.json'),
        content: `${JSON.stringify({ mcpServers: source.mcp.servers }, null, 2)}\n`,
      });
    }
    return files;
  }
}
