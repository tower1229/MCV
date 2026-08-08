import type { DeviceContext } from '../adapters/types.js';
import { createMcvMcpServer } from '../mcp/server.js';
import { resolveBoundRepository } from '../utils/repository.js';
import { serveStdio } from '@modelcontextprotocol/server/stdio';

export async function startMcpServer(context: DeviceContext): Promise<void> {
  const repositoryPath = resolveBoundRepository(context);
  await serveStdio(() => createMcvMcpServer(repositoryPath, context));
}
