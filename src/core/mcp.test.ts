import { describe, expect, it } from 'vitest';
import { normalizeMcpServers, toNativeMcpServers } from './mcp';

describe('Canonical MCP conversion', () => {
  it('normalizes transports, secret references, overrides, and runtime exclusions', () => {
    const result = normalizeMcpServers({
      node_repl: { command: 'runtime/node_repl.exe' },
      local: { command: 'server', env: { TOKEN: '$TOKEN' }, timeout: 30 },
      remote: { httpUrl: 'https://example.test/mcp' },
    }, 'codex');
    expect(result.excluded).toEqual(['node_repl']);
    expect(result.servers).toEqual({
      local: { command: 'server', env: { TOKEN: '${env:TOKEN}' }, transport: 'stdio' },
      remote: { url: 'https://example.test/mcp', transport: 'http' },
    });
    expect(result.overrides).toEqual({ local: { timeout: 30 } });
    expect(toNativeMcpServers(result.servers, 'codex', result.overrides)).toEqual({
      local: { command: 'server', env_vars: ['TOKEN'], timeout: 30 },
      remote: { url: 'https://example.test/mcp' },
    });
  });

  it('converts typed secret references inside surface overrides', () => {
    expect(toNativeMcpServers({ remote: { url: 'https://example.test/mcp' } }, 'antigravity', {
      remote: { headers: { Authorization: '${env:REMOTE_TOKEN}' } },
    })).toEqual({ remote: { serverUrl: 'https://example.test/mcp', headers: { Authorization: '${REMOTE_TOKEN}' } } });
  });
});
