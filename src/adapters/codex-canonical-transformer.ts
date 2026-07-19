import * as path from 'path';
import * as yaml from 'yaml';
import { isRecord } from '../utils/objects';
import { stringifyStructuredObject } from '../utils/structured-config';
import { CODEX_MCP_PATH } from './overlay-policies';
import { normalizeMcpServers, toNativeMcpServers } from '../core/mcp';
import type {
  CanonicalDeploySource,
  CanonicalTransformer,
  CaptureFile,
  CaptureResult,
  DeployFile,
  DeviceContext,
  NativeCaptureResult,
} from './types';

export class CodexCanonicalTransformer implements CanonicalTransformer {
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
    const mcp = capture.managedFields.find((field) => field.path === CODEX_MCP_PATH);
    if (mcp && isRecord(mcp.value)) {
      const normalized = normalizeMcpServers(mcp.value, 'codex');
      if (normalized.excluded.length > 0) capture.warnings.push(`Excluded Codex runtime MCP: ${normalized.excluded.join(', ')}`);
      files.push({
        sourcePath: mcp.sourcePath,
        repositoryPath: 'common/mcp.yaml',
        content: yaml.stringify({ servers: normalized.servers }),
        ownership: 'managed',
      });
      if (Object.keys(normalized.overrides).length > 0) files.push({ sourcePath: mcp.sourcePath, repositoryPath: 'ide/codex/mcp-overrides.yaml', content: yaml.stringify(normalized.overrides), ownership: 'managed' });
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
        targetPath: path.join((context.env ?? process.env).CODEX_HOME || path.join(context.homeDir, '.codex'), 'AGENTS.md'),
        content: source.rules,
      });
    }
    for (const skill of source.skills) {
      files.push({
        targetPath: path.join(context.homeDir, '.agents', 'skills', skill.relativePath),
        content: skill.content,
      });
    }
    if (source.mcp !== undefined) {
      if (!isRecord(source.mcp) || !isRecord(source.mcp.servers)) {
        throw new Error('common/mcp.yaml must contain a servers object.');
      }
      files.push({
        targetPath: path.join(context.homeDir, '.codex', 'config.toml'),
        content: stringifyStructuredObject({ mcp_servers: toNativeMcpServers(source.mcp.servers, 'codex', source.mcpOverrides?.codex) }, 'toml'),
      });
    }
    return files;
  }
}
