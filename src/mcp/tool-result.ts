import type { CallToolResult } from '@modelcontextprotocol/server';

export type McpToolOutput = { status: string } & Record<string, unknown>;

export type McpToolResult<T extends McpToolOutput> = CallToolResult & {
  structuredContent: T;
};

export function toolResult<T extends McpToolOutput>(
  toolName: string,
  output: T,
): McpToolResult<T> {
  return {
    content: [
      {
        type: 'text',
        text: `${toolName}: ${output.status}. See structuredContent for the complete result.`,
      },
    ],
    structuredContent: output,
  };
}

export function serializedToolResultBytes<T extends McpToolOutput>(
  toolName: string,
  output: T,
): number {
  return Buffer.byteLength(JSON.stringify(toolResult(toolName, output)), 'utf8');
}
