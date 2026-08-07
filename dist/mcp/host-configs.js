/**
 * Canonical stdio launch configs for Agent hosts that speak MCP.
 * Contract tests assert discovery against these shapes.
 */
export function mcvMcpHostConfig(_host, command = 'mcv') {
    return {
        command,
        args: ['mcp'],
    };
}
export function codexMcpServersConfig(command = 'mcv') {
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
export function claudeCodeMcpServersConfig(command = 'mcv') {
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
export function geminiCliMcpServersConfig(command = 'mcv') {
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
