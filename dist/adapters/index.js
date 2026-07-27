import { ClaudeCodeAdapter } from './claude-code.js';
import { CodexAdapter } from './codex.js';
import { GeminiAdapter } from './gemini.js';
export function createAdapterDefinitions() {
    return [
        { targetId: 'codex', name: 'Codex', adapter: new CodexAdapter() },
        { targetId: 'claudeCode', name: 'Claude Code', adapter: new ClaudeCodeAdapter() },
        { targetId: 'gemini', name: 'Gemini', adapter: new GeminiAdapter() },
    ];
}
