import { ClaudeCodeAdapter } from './claude-code';
import { CodexAdapter } from './codex';
import { GeminiAdapter } from './gemini';
import type { IdeAdapter } from './types';

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
