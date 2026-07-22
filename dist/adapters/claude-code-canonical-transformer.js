"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.ClaudeCodeCanonicalTransformer = void 0;
const path = __importStar(require("path"));
const yaml = __importStar(require("yaml"));
const objects_1 = require("../utils/objects");
const overlay_policies_1 = require("./overlay-policies");
const mcp_1 = require("../core/mcp");
class ClaudeCodeCanonicalTransformer {
    transform(capture, _context) {
        const files = [...capture.files];
        const instructions = capture.managedFiles.find((file) => file.id === 'user-instructions');
        if (instructions) {
            files.push({
                sourcePath: instructions.sourcePath,
                repositoryPath: 'common/AGENTS.md',
                content: instructions.content,
                ownership: 'managed',
            });
        }
        let mcpServers = {};
        let mcpOverrides = {};
        const mcpSources = [];
        for (const field of capture.managedFields) {
            if (field.path !== overlay_policies_1.CLAUDE_CODE_MCP_PATH || !(0, objects_1.isRecord)(field.value))
                continue;
            const normalized = (0, mcp_1.normalizeMcpServers)(field.value, 'claude-code');
            mcpServers = (0, objects_1.mergeRecords)(mcpServers, normalized.servers);
            mcpOverrides = (0, objects_1.mergeRecords)(mcpOverrides, normalized.overrides);
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
        if (source.rules !== undefined) {
            files.push({
                targetPath: path.join(context.env.CLAUDE_CONFIG_DIR || path.join(context.homeDir, '.claude'), 'CLAUDE.md'),
                content: source.rules,
            });
        }
        for (const skill of source.skills) {
            files.push({
                targetPath: path.join(context.env.CLAUDE_CONFIG_DIR || path.join(context.homeDir, '.claude'), 'skills', skill.relativePath),
                content: skill.content,
            });
        }
        if (source.mcp !== undefined) {
            if (!(0, objects_1.isRecord)(source.mcp) || !(0, objects_1.isRecord)(source.mcp.servers)) {
                throw new Error('common/mcp.yaml must contain a servers object.');
            }
            files.push({
                targetPath: path.join(context.homeDir, '.claude.json'),
                content: `${JSON.stringify({
                    mcpServers: (0, mcp_1.toNativeMcpServers)(source.mcp.servers, 'claude-code', source.mcpOverrides?.['claude-code']),
                }, null, 2)}\n`,
            });
        }
        return files;
    }
}
exports.ClaudeCodeCanonicalTransformer = ClaudeCodeCanonicalTransformer;
