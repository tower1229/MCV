export const CLAUDE_CODE_MCP_PATH = '$.mcpServers';
export const CODEX_MCP_PATH = '$.mcp_servers';
export const GEMINI_MCP_PATH = '$.mcpServers';

export const CLAUDE_CODE_MANAGED_PATHS = [CLAUDE_CODE_MCP_PATH] as const;
export const CODEX_MANAGED_PATHS = [CODEX_MCP_PATH] as const;
export const GEMINI_MANAGED_PATHS = [GEMINI_MCP_PATH] as const;
