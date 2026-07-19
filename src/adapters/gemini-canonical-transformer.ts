import * as path from 'path';
import * as yaml from 'yaml';
import { isRecord } from '../utils/objects';
import { GEMINI_MCP_PATH } from './overlay-policies';
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
    for (const mcp of capture.managedFields.filter((field) => field.path === GEMINI_MCP_PATH)) {
      if (!isRecord(mcp.value)) continue;
      const surface = mcp.sourcePath.includes(`${path.sep}config${path.sep}`) ? 'antigravity' : 'gemini-cli';
      const normalized = normalizeMcpServers(mcp.value, surface);
      files.push({
        sourcePath: mcp.sourcePath,
        repositoryPath: 'common/mcp.yaml',
        content: yaml.stringify({ servers: normalized.servers }),
        ownership: 'managed',
      });
      if (Object.keys(normalized.overrides).length > 0) files.push({ sourcePath: mcp.sourcePath, repositoryPath: `ide/gemini/${surface}/mcp-overrides.yaml`, content: yaml.stringify(normalized.overrides), ownership: 'managed' });
      capture.warnings.push(...normalized.excluded.map((name) => `Excluded runtime MCP ${name} from ${surface}.`));
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
        content: `${JSON.stringify({ mcpServers: toNativeMcpServers(source.mcp.servers, 'gemini-cli', source.mcpOverrides?.['gemini-cli']) }, null, 2)}\n`,
      });
      files.push({
        targetPath: path.join(context.homeDir, '.gemini', 'config', 'mcp_config.json'),
        content: `${JSON.stringify({ mcpServers: toNativeMcpServers(source.mcp.servers, 'antigravity', source.mcpOverrides?.antigravity) }, null, 2)}\n`,
      });
    }
    return files;
  }
}
