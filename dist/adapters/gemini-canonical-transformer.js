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
exports.GeminiCanonicalTransformer = void 0;
const path = __importStar(require("path"));
const yaml = __importStar(require("yaml"));
const objects_1 = require("../utils/objects");
class GeminiCanonicalTransformer {
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
        const mcp = capture.managedFields.find((field) => field.path === '$.mcpServers');
        if (mcp && (0, objects_1.isRecord)(mcp.value)) {
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
    async deploy(source, context) {
        const files = [];
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
            if (!(0, objects_1.isRecord)(source.mcp) || !(0, objects_1.isRecord)(source.mcp.servers)) {
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
exports.GeminiCanonicalTransformer = GeminiCanonicalTransformer;
