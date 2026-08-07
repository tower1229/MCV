import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as yaml from 'yaml';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import {
  createMcvMcpServer,
  MCP_SERVER_INSTRUCTIONS,
  PINNED_PROTOCOL_VERSION,
} from './server.js';
import {
  claudeCodeMcpServersConfig,
  codexMcpServersConfig,
  geminiCliMcpServersConfig,
  mcvMcpHostConfig,
} from './host-configs.js';
import { READ_ASSETS_MAX_RESPONSE_BYTES } from './contracts.js';
import {
  emptyProfilesDocument,
  writeProfilesDocument,
} from '../profiles/store.js';

describe('MCV MCP server', () => {
  let testRoot: string;
  let repositoryPath: string;

  beforeEach(() => {
    testRoot = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'mcv-mcp-'));
    repositoryPath = path.join(testRoot, 'repository');
    seedRepository(repositoryPath);
  });

  afterEach(() => {
    fs.rmSync(testRoot, { recursive: true, force: true });
  });

  it('advertises short instructions and the two read-only tools with schemas and annotations', async () => {
    const { client, close } = await connectInMemory(repositoryPath);
    try {
      expect(client.getInstructions()).toBe(MCP_SERVER_INSTRUCTIONS);
      expect(PINNED_PROTOCOL_VERSION).toBe('2025-03-26');

      const { tools } = await client.listTools();
      expect(tools.map((tool) => tool.name).sort()).toEqual([
        'inspect_inventory',
        'read_assets',
      ]);

      for (const name of ['inspect_inventory', 'read_assets'] as const) {
        const tool = tools.find((entry) => entry.name === name);
        expect(tool?.annotations).toEqual({
          readOnlyHint: true,
          openWorldHint: false,
        });
        expect(tool?.inputSchema).toMatchObject({ type: 'object' });
        expect(tool?.outputSchema).toMatchObject({ type: 'object' });
      }
    } finally {
      await close();
    }
  });

  it('inspect_inventory returns summaries with revisions and paginates', async () => {
    const { client, close } = await connectInMemory(repositoryPath);
    try {
      const first = await callStructured(client, 'inspect_inventory', { limit: 1 });
      expect(first).toMatchObject({
        status: 'ok',
        assets: [
          {
            id: 'mcp:context7',
            type: 'mcp',
            displayName: 'context7',
            activation: 'tool-surface',
            unassigned: true,
            profileIds: [],
          },
        ],
      });
      expect(first.catalogRevision).toMatch(/^[a-f0-9]{64}$/);
      expect(first.profilesRevision).toMatch(/^[a-f0-9]{64}$/);
      expect(first.nextCursor).toEqual(expect.any(String));
      expect(JSON.stringify(first)).not.toContain('plaintext-token');
      expect(JSON.stringify(first)).not.toContain('# Debug');

      const second = await callStructured(client, 'inspect_inventory', {
        cursor: first.nextCursor,
        limit: 10,
      });
      expect(second.status).toBe('ok');
      expect(second.assets?.map((asset: { id: string }) => asset.id)).toEqual([
        'rule:canonical',
        'skill:debug',
      ]);
      expect(second.assets?.find((asset: { id: string }) => asset.id === 'rule:canonical'))
        .toMatchObject({
          profileIds: ['global'],
          unassigned: false,
        });
      expect(second.nextCursor).toBeUndefined();
    } finally {
      await close();
    }
  });

  it('read_assets returns faithful content, size-caps responses, and continues', async () => {
    const largeSkillDir = path.join(repositoryPath, 'common', 'skills', 'bulk');
    fs.mkdirSync(largeSkillDir, { recursive: true });
    fs.writeFileSync(
      path.join(largeSkillDir, 'SKILL.md'),
      '---\nname: bulk\ndescription: large\n---\n',
    );
    const chunk = 'x'.repeat(40 * 1024);
    fs.writeFileSync(path.join(largeSkillDir, 'part-a.txt'), `${chunk}\nsecret=alpha\n`);
    fs.writeFileSync(path.join(largeSkillDir, 'part-b.txt'), `${chunk}\nsecret=beta\n`);

    const { client, close } = await connectInMemory(repositoryPath);
    try {
      const first = await callStructured(client, 'read_assets', {
        assetIds: ['skill:debug', 'skill:bulk', 'mcp:context7'],
        includeFiles: true,
      });
      expect(first.status).toBe('ok');
      expect(first.truncated).toBe(true);
      expect(first.nextCursor).toEqual(expect.any(String));
      expect(first.responseBytes).toBeLessThanOrEqual(READ_ASSETS_MAX_RESPONSE_BYTES);
      expect(JSON.stringify(first)).toContain('plaintext-token');
      expect(JSON.stringify(first)).not.toContain('secret=beta');

      const second = await callStructured(client, 'read_assets', {
        cursor: first.nextCursor,
      });
      expect(second.status).toBe('ok');
      expect(second.responseBytes).toBeLessThanOrEqual(READ_ASSETS_MAX_RESPONSE_BYTES);
      const allContent = `${JSON.stringify(first)}${JSON.stringify(second)}`;
      expect(allContent).toContain('secret=alpha');
      expect(allContent).toContain('secret=beta');
      expect(allContent).toContain('context7');
    } finally {
      await close();
    }
  });

  it('read_assets slices an oversized first file under the response size cap', async () => {
    const hugeDir = path.join(repositoryPath, 'common', 'skills', 'huge');
    fs.mkdirSync(hugeDir, { recursive: true });
    fs.writeFileSync(
      path.join(hugeDir, 'SKILL.md'),
      '---\nname: huge\ndescription: oversized\n---\n',
    );
    fs.writeFileSync(
      path.join(hugeDir, 'blob.txt'),
      `${'A'.repeat(READ_ASSETS_MAX_RESPONSE_BYTES + 8_192)}\nTAIL=end\n`,
    );

    const { client, close } = await connectInMemory(repositoryPath);
    try {
      const first = await callStructured(client, 'read_assets', {
        assetIds: ['skill:huge'],
        includeFiles: true,
      });
      expect(first).toMatchObject({
        status: 'ok',
        truncated: true,
      });
      expect(first.responseBytes).toBeLessThanOrEqual(READ_ASSETS_MAX_RESPONSE_BYTES);
      expect(first.nextCursor).toEqual(expect.any(String));
      expect(JSON.stringify(first)).not.toContain('TAIL=end');

      const second = await callStructured(client, 'read_assets', {
        cursor: first.nextCursor,
      });
      expect(second.status).toBe('ok');
      expect(JSON.stringify(second)).toContain('TAIL=end');
    } finally {
      await close();
    }
  });

  it('returns business errors inside tool results for unknown assets', async () => {
    const { client, close } = await connectInMemory(repositoryPath);
    try {
      const result = await client.callTool({
        name: 'read_assets',
        arguments: { assetIds: ['skill:missing'] },
      });
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toMatchObject({
        status: 'error',
        error: { code: 'mcp.unknownAssets' },
      });
    } finally {
      await close();
    }
  });
});

describe('MCV MCP host client configurations', () => {
  const hosts = [
    { id: 'codex' as const, config: codexMcpServersConfig },
    { id: 'claude-code' as const, config: claudeCodeMcpServersConfig },
    { id: 'gemini-cli' as const, config: geminiCliMcpServersConfig },
  ];

  for (const host of hosts) {
    it(`discovers tools through the ${host.id} MCP client configuration shape`, async () => {
      const testRoot = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'mcv-mcp-host-'));
      const repositoryPath = path.join(testRoot, 'repository');
      const homeDir = path.join(testRoot, 'home');
      try {
        seedRepository(repositoryPath);
        fs.mkdirSync(homeDir, { recursive: true });
        writeDeviceState(homeDir, repositoryPath);

        const distEntry = path.join(process.cwd(), 'dist', 'index.js');
        expect(fs.existsSync(distEntry)).toBe(true);
        const launch = mcvMcpHostConfig(host.id, process.execPath);
        const hostConfig = host.config(process.execPath);
        const serverEntry = Object.values(
          (hostConfig.mcp_servers ?? hostConfig.mcpServers) as Record<string, { command: string; args: string[] }>,
        )[0];
        expect(serverEntry).toMatchObject({
          command: process.execPath,
          args: ['mcp'],
        });

        const transport = new StdioClientTransport({
          command: launch.command,
          args: [distEntry, ...launch.args],
          env: {
            ...process.env,
            HOME: homeDir,
            USERPROFILE: homeDir,
            APPDATA: homeDir,
          },
          cwd: repositoryPath,
        });
        const client = new Client({ name: `${host.id}-contract`, version: '0.0.0' });
        await client.connect(transport);
        try {
          expect(client.getInstructions()).toBe(MCP_SERVER_INSTRUCTIONS);
          const { tools } = await client.listTools();
          const inspect = tools.find((tool) => tool.name === 'inspect_inventory');
          const read = tools.find((tool) => tool.name === 'read_assets');
          expect(inspect?.annotations).toEqual({ readOnlyHint: true, openWorldHint: false });
          expect(read?.annotations).toEqual({ readOnlyHint: true, openWorldHint: false });
          expect(inspect?.inputSchema).toMatchObject({
            type: 'object',
            properties: {
              cursor: expect.any(Object),
              limit: expect.any(Object),
            },
          });
          expect(inspect?.outputSchema).toMatchObject({
            type: 'object',
            properties: {
              status: expect.any(Object),
              catalogRevision: expect.any(Object),
              profilesRevision: expect.any(Object),
              assets: expect.any(Object),
            },
          });
          expect(read?.inputSchema).toMatchObject({
            type: 'object',
            properties: {
              assetIds: expect.any(Object),
              includeFiles: expect.any(Object),
              cursor: expect.any(Object),
            },
          });
          expect(read?.outputSchema).toMatchObject({
            type: 'object',
            properties: {
              status: expect.any(Object),
              assets: expect.any(Object),
              nextCursor: expect.any(Object),
            },
          });
        } finally {
          await client.close();
        }
      } finally {
        fs.rmSync(testRoot, { recursive: true, force: true });
      }
    });
  }
});

describe('mcv mcp CLI registration', () => {
  it('registers mcp as a hidden integration command', async () => {
    const { createProgram } = await import('../index.js');
    const program = createProgram({
      homeDir: os.tmpdir(),
      platform: process.platform,
      env: {},
    });
    const help = program.helpInformation();
    expect(help).not.toMatch(/\bmcp\b/);
    expect(program.commands.some((command) => command.name() === 'mcp')).toBe(true);
  });
});

async function connectInMemory(repositoryPath: string): Promise<{
  client: Client;
  close: () => Promise<void>;
}> {
  const server = createMcvMcpServer(repositoryPath);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'mcv-test', version: '0.0.0' });
  await client.connect(clientTransport);
  return {
    client,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}

async function callStructured(
  client: Client,
  name: string,
  args: Record<string, unknown>,
): Promise<Record<string, any>> {
  const result = await client.callTool({ name, arguments: args });
  expect(result.structuredContent).toEqual(expect.any(Object));
  return result.structuredContent as Record<string, any>;
}

function seedRepository(repositoryPath: string): void {
  fs.mkdirSync(path.join(repositoryPath, 'common', 'skills', 'debug'), { recursive: true });
  fs.writeFileSync(path.join(repositoryPath, 'mcv.yaml'), [
    'schemaVersion: 4',
    'repositoryId: repository-id',
    'initializedAt: 2026-07-19T00:00:00.000Z',
    'targets:',
    '  codex:',
    '    enabled: false',
    '  claudeCode:',
    '    enabled: false',
    '  gemini:',
    '    enabled: false',
    '    surfaces:',
    '      geminiCli: auto',
    '      antigravity: auto',
    'variables: {}',
    'capture:',
    '  preserveUnknownNativeFields: true',
    'deploy:',
    '  backupBeforeWrite: true',
    '  useSymlinks: false',
    '',
  ].join('\n'));
  fs.writeFileSync(path.join(repositoryPath, 'common', 'AGENTS.md'), '# rules\n');
  fs.writeFileSync(
    path.join(repositoryPath, 'common', 'skills', 'debug', 'SKILL.md'),
    '---\nname: debug\ndescription: Debug helper\n---\n# Debug\nsecret=plaintext-token\n',
  );
  fs.writeFileSync(
    path.join(repositoryPath, 'common', 'mcp.yaml'),
    yaml.stringify({
      servers: {
        context7: { command: 'npx', args: ['-y', '@upstash/context7-mcp'], transport: 'stdio' },
      },
    }),
  );
  writeProfilesDocument(repositoryPath, {
    ...emptyProfilesDocument(),
    profiles: {
      global: { title: 'Global', assets: ['rule:canonical'] },
    },
  });
}

function writeDeviceState(homeDir: string, repositoryPath: string): void {
  const stateDir = path.join(homeDir, '.mcv');
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(
    path.join(stateDir, 'state.yaml'),
    yaml.stringify({
      schemaVersion: 1,
      defaultRepositoryId: 'repository-id',
      repositoryPath,
    }),
  );
}
