import * as yaml from 'yaml';
import { mergeRecords, isRecord } from '../utils/objects';
import type {
  CanonicalTransformer,
  CaptureFile,
  CaptureResult,
  DeviceContext,
  NativeCaptureResult,
} from './types';

export class ClaudeCodeCanonicalTransformer implements CanonicalTransformer {
  transform(
    capture: NativeCaptureResult,
    _context: DeviceContext,
  ): CaptureResult {
    const files: CaptureFile[] = [...capture.files];
    const instructions = capture.managedFiles.find(
      (file) => file.id === 'user-instructions',
    );
    if (instructions) {
      files.push({
        sourcePath: instructions.sourcePath,
        repositoryPath: 'common/AGENTS.md',
        content: instructions.content,
        ownership: 'managed',
      });
    }

    let mcpServers: Record<string, unknown> = {};
    const mcpSources: string[] = [];
    for (const field of capture.managedFields) {
      if (field.path !== '$.mcpServers' || !isRecord(field.value)) continue;
      mcpServers = mergeRecords(mcpServers, field.value);
      mcpSources.push(field.sourcePath);
    }
    if (Object.keys(mcpServers).length > 0) {
      files.push({
        sourcePath: mcpSources.join(', '),
        repositoryPath: 'common/mcp.yaml',
        content: yaml.stringify({ servers: mcpServers }),
        ownership: 'managed',
      });
    }

    return {
      files,
      summary: { ...capture.summary, fileCount: files.length },
      warnings: capture.warnings,
    };
  }
}
