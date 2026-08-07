export type McpHostId = 'codex' | 'claude-code' | 'gemini-cli';

export interface McpHostCommandConfig {
  command: string;
  args: string[];
}

/**
 * Canonical stdio launch configs for Agent hosts that speak MCP.
 * Contract tests assert discovery against these shapes.
 */
export function mcvMcpHostConfig(
  _host: McpHostId,
  command = 'mcv',
): McpHostCommandConfig {
  return {
    command,
    args: ['mcp'],
  };
}

export function codexMcpServersConfig(command = 'mcv'): Record<string, unknown> {
  const launch = mcvMcpHostConfig('codex', command);
  return {
    mcp_servers: {
      mcv: {
        command: launch.command,
        args: launch.args,
      },
    },
  };
}

export function claudeCodeMcpServersConfig(command = 'mcv'): Record<string, unknown> {
  const launch = mcvMcpHostConfig('claude-code', command);
  return {
    mcpServers: {
      mcv: {
        command: launch.command,
        args: launch.args,
      },
    },
  };
}

export function geminiCliMcpServersConfig(command = 'mcv'): Record<string, unknown> {
  const launch = mcvMcpHostConfig('gemini-cli', command);
  return {
    mcpServers: {
      mcv: {
        command: launch.command,
        args: launch.args,
      },
    },
  };
}
