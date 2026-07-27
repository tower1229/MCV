import { ClaudeCodeAdapter } from './claude-code.js';
import { CodexAdapter } from './codex.js';
import { GeminiAdapter } from './gemini.js';
import type { IdeAdapter } from './types.js';

export type TargetId = 'codex' | 'claudeCode' | 'gemini';

export interface AdapterDefinition {
  targetId: TargetId;
  name: string;
  adapter: IdeAdapter;
}

export function createAdapterDefinitions(): AdapterDefinition[] {
  return [
    { targetId: 'codex', name: 'Codex', adapter: new CodexAdapter() },
    { targetId: 'claudeCode', name: 'Claude Code', adapter: new ClaudeCodeAdapter() },
    { targetId: 'gemini', name: 'Gemini', adapter: new GeminiAdapter() },
  ];
}
