import { readFileSync } from 'fs';
import {
  DEFAULT_NEGOTIATED_PROTOCOL_VERSION,
  McpServer,
} from '@modelcontextprotocol/server';
import {
  InspectInventoryInputSchema,
  InspectInventoryOutputSchema,
  ReadAssetsInputSchema,
  ReadAssetsOutputSchema,
} from './contracts.js';
import { inspectInventory } from './inventory.js';
import { readAssets } from './read-assets.js';

export const PINNED_PROTOCOL_VERSION = DEFAULT_NEGOTIATED_PROTOCOL_VERSION;

export const MCP_SERVER_INSTRUCTIONS = [
  'MCV exposes read-only Profile and Asset inventory for the bound Repository.',
  'Call inspect_inventory for summaries, then read_assets only for Assets you need.',
  'read_assets returns faithful plaintext content; do not assume values are masked.',
  'Prefer Unassigned for uncertain classification; writes are out of scope for these tools.',
].join(' ');

const packageVersion = (
  JSON.parse(
    readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
  ) as { version: string }
).version;

export function createMcvMcpServer(repositoryPath: string): McpServer {
  const server = new McpServer(
    {
      name: 'mcv',
      version: packageVersion,
    },
    {
      instructions: MCP_SERVER_INSTRUCTIONS,
      supportedProtocolVersions: [PINNED_PROTOCOL_VERSION],
      capabilities: {
        tools: {},
      },
    },
  );

  server.registerTool(
    'inspect_inventory',
    {
      title: 'Inspect inventory',
      description:
        'Return Asset summaries (description, size, activation, owning Profiles) plus Catalog and Profiles Revisions. Supports cursor/limit pagination. Does not return full file bodies.',
      inputSchema: InspectInventoryInputSchema,
      outputSchema: InspectInventoryOutputSchema,
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
      },
    },
    async (args) => toolResult(inspectInventory(repositoryPath, args)),
  );

  server.registerTool(
    'read_assets',
    {
      title: 'Read assets',
      description:
        'Return faithful Asset content for the selected Asset IDs. Responses are size-capped; use nextCursor to continue. Plaintext values are unmasked.',
      inputSchema: ReadAssetsInputSchema,
      outputSchema: ReadAssetsOutputSchema,
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
      },
    },
    async (args) => toolResult(readAssets(repositoryPath, args)),
  );

  return server;
}

function toolResult<T extends { status: 'ok' | 'error' }>(output: T): {
  content: Array<{ type: 'text'; text: string }>;
  structuredContent: T;
} {
  return {
    content: [{ type: 'text', text: JSON.stringify(output) }],
    structuredContent: output,
  };
}
