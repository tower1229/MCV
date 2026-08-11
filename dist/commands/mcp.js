import { createMcvMcpServer } from '../mcp/server.js';
import { resolveBoundRepository } from '../utils/repository.js';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
export async function startMcpServer(context) {
    const repositoryPath = resolveBoundRepository(context);
    await serveStdio(() => createMcvMcpServer(repositoryPath, context), { legacy: 'reject' });
}
