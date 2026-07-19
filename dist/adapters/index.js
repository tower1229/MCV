"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createAdapterDefinitions = createAdapterDefinitions;
const claude_code_1 = require("./claude-code");
const codex_1 = require("./codex");
const gemini_1 = require("./gemini");
function createAdapterDefinitions() {
    return [
        { targetId: 'codex', name: 'Codex', adapter: new codex_1.CodexAdapter() },
        { targetId: 'claudeCode', name: 'Claude Code', adapter: new claude_code_1.ClaudeCodeAdapter() },
        { targetId: 'gemini', name: 'Gemini', adapter: new gemini_1.GeminiAdapter() },
    ];
}
