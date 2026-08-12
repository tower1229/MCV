import * as path from 'path';
import * as yaml from 'yaml';
import { mergeRecords, isRecord } from '../utils/objects.js';
import { CLAUDE_CODE_MCP_PATH } from './overlay-policies.js';
import { normalizeMcpServers, toNativeMcpServers } from '../core/mcp.js';
import { instructionDefinition } from '../core/ide-instructions.js';
export class ClaudeCodeManagedTransformer {
    transform(capture, _context) {
        const files = [...capture.files];
        const instructions = capture.managedFiles.find((file) => file.id === 'user-instructions');
        if (instructions) {
            files.push({
                sourcePath: instructions.sourcePath,
                repositoryPath: instructionDefinition('claude-code').repositoryPath,
                content: instructions.content,
                ownership: 'managed',
            });
        }
        let mcpServers = {};
        let mcpOverrides = {};
        const mcpSources = [];
        for (const field of capture.managedFields) {
            if (field.path !== CLAUDE_CODE_MCP_PATH || !isRecord(field.value))
                continue;
            const normalized = normalizeMcpServers(field.value, 'claude-code');
            mcpServers = mergeRecords(mcpServers, normalized.servers);
            mcpOverrides = mergeRecords(mcpOverrides, normalized.overrides);
            mcpSources.push(field.sourcePath);
        }
        if (Object.keys(mcpOverrides).length > 0)
            files.push({ sourcePath: mcpSources.join(', '), repositoryPath: 'ide/claude-code/mcp-overrides.yaml', content: yaml.stringify(mcpOverrides), ownership: 'managed' });
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
    async deploy(source, context) {
        const files = [];
        if (source.instructions !== undefined) {
            files.push({
                targetPath: instructionDefinition('claude-code').globalTargetPath(context),
                content: source.instructions.content,
            });
        }
        for (const skill of source.skills) {
            files.push({
                targetPath: path.join(context.env.CLAUDE_CONFIG_DIR || path.join(context.homeDir, '.claude'), 'skills', skill.relativePath),
                content: skill.content,
            });
        }
        if (source.mcp !== undefined) {
            if (!isRecord(source.mcp) || !isRecord(source.mcp.servers)) {
                throw new Error('common/mcp.yaml must contain a servers object.');
            }
            files.push({
                targetPath: path.join(context.homeDir, '.claude.json'),
                content: `${JSON.stringify({
                    mcpServers: toNativeMcpServers(source.mcp.servers, 'claude-code', source.mcpOverrides?.['claude-code']),
                }, null, 2)}\n`,
            });
        }
        return files;
    }
}
