import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';
import * as yaml from 'yaml';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import type { DeviceContext } from '../adapters/types.js';
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
import {
  DeployProfilesOutputSchema,
  InspectInventoryOutputSchema,
  READ_ASSETS_MAX_RESPONSE_BYTES,
  ReadAssetsOutputSchema,
  UpdateProfilesOutputSchema,
} from './contracts.js';
import {
  emptyProfilesDocument,
  writeProfilesDocument,
} from '../profiles/store.js';
import { writeState } from '../utils/state.js';
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

  it('advertises short instructions, four tools with schemas/annotations, and the classification resource', async () => {
    const { client, close } = await connectInMemory(repositoryPath);
    try {
      expect(client.getInstructions()).toBe(MCP_SERVER_INSTRUCTIONS);
      expect(PINNED_PROTOCOL_VERSION).toBe('2025-03-26');
      expect(MCP_SERVER_INSTRUCTIONS.toLowerCase()).not.toContain('global:');
      expect(MCP_SERVER_INSTRUCTIONS).not.toMatch(/AGENTS\.md|CLAUDE\.md|GEMINI\.md/);

      const { tools } = await client.listTools();
      expect(tools.map((tool) => tool.name).sort()).toEqual([
        'deploy_profiles',
        'inspect_inventory',
        'read_assets',
        'update_profiles',
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

      const update = tools.find((entry) => entry.name === 'update_profiles');
      expect(update?.annotations).toEqual({
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
      });
      expect(update?.inputSchema).toMatchObject({ type: 'object' });
      expect(update?.outputSchema).toMatchObject({ type: 'object' });

      const deploy = tools.find((entry) => entry.name === 'deploy_profiles');
      expect(deploy?.annotations).toEqual({
        readOnlyHint: false,
        destructiveHint: true,
        openWorldHint: false,
      });
      expect(deploy?.inputSchema).toMatchObject({ type: 'object' });
      expect(deploy?.outputSchema).toMatchObject({ type: 'object' });

      const { resources } = await client.listResources();
      expect(resources.map((resource) => resource.uri)).toEqual([
        'mcv://guides/profile-classification',
      ]);
      const guide = await client.readResource({
        uri: 'mcv://guides/profile-classification',
      });
      const text = guide.contents
        .map((entry) => ('text' in entry ? entry.text : ''))
        .join('\n');
      expect(text).toContain('global');
      expect(text).toContain('Unassigned');
      expect(text.toLowerCase()).toContain('rules');
      expect(text.toLowerCase()).toContain('mcp');
    } finally {
      await close();
    }
  });

  it('update_profiles validates the whole batch then atomically upserts and deletes', async () => {
    const { client, close } = await connectInMemory(repositoryPath);
    try {
      const inventory = await callStructured(client, 'inspect_inventory', {});
      const result = await callStructured(client, 'update_profiles', {
        expectedCatalogRevision: inventory.catalogRevision,
        expectedProfilesRevision: inventory.profilesRevision,
        mutations: [
          {
            operation: 'upsert',
            id: 'global',
            description: 'Stable cross-project assets',
            assets: ['rule:canonical', 'mcp:context7'],
          },
          {
            operation: 'upsert',
            id: 'dev',
            description: 'General development assets',
            assets: ['skill:debug'],
          },
          {
            operation: 'delete',
            id: 'missing-profile',
          },
        ],
      });
      expect(result).toMatchObject({
        status: 'error',
        error: { code: 'profile.notFound' },
      });
      const afterReject = await callStructured(client, 'inspect_inventory', {});
      expect(afterReject.profilesRevision).toBe(inventory.profilesRevision);

      const applied = await callStructured(client, 'update_profiles', {
        expectedCatalogRevision: inventory.catalogRevision,
        expectedProfilesRevision: inventory.profilesRevision,
        mutations: [
          {
            operation: 'upsert',
            id: 'global',
            description: 'Stable cross-project assets',
            assets: ['rule:canonical', 'mcp:context7'],
          },
          {
            operation: 'upsert',
            id: 'dev',
            description: 'General development assets',
            assets: ['skill:debug'],
          },
        ],
      });
      expect(applied).toMatchObject({
        status: 'updated',
        created: ['dev'],
        updated: ['global'],
        deleted: [],
        diff: {
          global: { added: 1, removed: 0, total: 2 },
          dev: { added: 1, removed: 0, total: 1 },
        },
      });
      expect(applied.profilesRevision).toMatch(/^[a-f0-9]{64}$/);
      expect(applied.profilesRevision).not.toBe(inventory.profilesRevision);

      const stale = await callStructured(client, 'update_profiles', {
        expectedCatalogRevision: inventory.catalogRevision,
        expectedProfilesRevision: inventory.profilesRevision,
        mutations: [{ operation: 'upsert', id: 'dev', assets: ['skill:debug'] }],
      });
      expect(stale).toMatchObject({
        status: 'error',
        error: { code: 'profile.revisionConflict' },
        profilesRevision: applied.profilesRevision,
        catalogRevision: inventory.catalogRevision,
      });

      const refuseGlobal = await callStructured(client, 'update_profiles', {
        expectedCatalogRevision: inventory.catalogRevision,
        expectedProfilesRevision: applied.profilesRevision,
        mutations: [{ operation: 'delete', id: 'global' }],
      });
      expect(refuseGlobal).toMatchObject({
        status: 'error',
        error: { code: 'profile.globalRequired' },
      });

      const deleted = await callStructured(client, 'update_profiles', {
        expectedCatalogRevision: inventory.catalogRevision,
        expectedProfilesRevision: applied.profilesRevision,
        mutations: [{ operation: 'delete', id: 'dev' }],
      });
      expect(deleted).toMatchObject({
        status: 'updated',
        deleted: ['dev'],
        diff: { dev: { added: 0, removed: 1, total: 0 } },
      });
      expect(fs.existsSync(path.join(repositoryPath, 'common', 'skills', 'debug', 'SKILL.md'))).toBe(true);
    } finally {
      await close();
    }
  });

  it('update_profiles persists a 50-Skill multi-Profile classification in one mutation', async () => {
    const skillIds: string[] = [];
    for (let index = 1; index <= 50; index += 1) {
      const name = `skill-${String(index).padStart(2, '0')}`;
      const dir = path.join(repositoryPath, 'common', 'skills', name);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        path.join(dir, 'SKILL.md'),
        `---\nname: ${name}\ndescription: skill ${index}\n---\n`,
      );
      skillIds.push(`skill:${name}`);
    }
    const { client, close } = await connectInMemory(repositoryPath);
    try {
      const inventory = await callStructured(client, 'inspect_inventory', { limit: 200 });
      expect(inventory.assets?.filter((asset: { type: string }) => asset.type === 'skill').length)
        .toBeGreaterThanOrEqual(50);

      const firstHalf = skillIds.slice(0, 25);
      const secondHalf = skillIds.slice(25);
      const result = await callStructured(client, 'update_profiles', {
        expectedCatalogRevision: inventory.catalogRevision,
        expectedProfilesRevision: inventory.profilesRevision,
        mutations: [
          {
            operation: 'upsert',
            id: 'global',
            assets: ['rule:canonical', ...firstHalf.slice(0, 5)],
          },
          {
            operation: 'upsert',
            id: 'dev',
            description: 'Development skills',
            assets: firstHalf,
          },
          {
            operation: 'upsert',
            id: 'design',
            description: 'Design skills',
            assets: secondHalf,
          },
        ],
      });
      expect(result).toMatchObject({
        status: 'updated',
        created: expect.arrayContaining(['dev', 'design']),
        updated: ['global'],
      });
      expect(result.diff?.dev?.total).toBe(25);
      expect(result.diff?.design?.total).toBe(25);

      const after = await callStructured(client, 'inspect_inventory', { limit: 200 });
      const owned = new Set(
        (after.assets as Array<{ id: string; profileIds: string[] }>)
          .filter((asset) => asset.id.startsWith('skill:skill-'))
          .flatMap((asset) => asset.profileIds),
      );
      expect(owned.has('dev')).toBe(true);
      expect(owned.has('design')).toBe(true);
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

  it('deploy_profiles requires targetDirectory for project scope and never uses process cwd', async () => {
    const homeDir = path.join(testRoot, 'home');
    const context = deviceContextFor(testRoot, homeDir);
    enableClaudeDeployFixture(repositoryPath, context);
    const { client, close } = await connectInMemory(repositoryPath, context);
    try {
      const missing = await callStructured(client, 'deploy_profiles', {
        profiles: ['global'],
        scope: 'project',
      });
      expect(missing).toMatchObject({
        status: 'error',
        error: { code: 'deploy.targetRequired' },
      });

      const projectRoot = path.join(testRoot, 'project');
      fs.mkdirSync(projectRoot, { recursive: true });
      fs.writeFileSync(path.join(projectRoot, 'AGENTS.md'), '# Local intro\n');
      const dry = await callStructured(client, 'deploy_profiles', {
        profiles: ['global'],
        scope: 'project',
        targetDirectory: projectRoot,
        dryRun: true,
      });
      expect(dry).toMatchObject({
        status: 'ok',
        dryRun: true,
        scope: 'project',
        targetRoot: fs.realpathSync(projectRoot),
      });
      expect(dry.changes?.length).toBeGreaterThan(0);
      expect(fs.readFileSync(path.join(projectRoot, 'AGENTS.md'), 'utf8')).toBe('# Local intro\n');

      const applied = await callStructured(client, 'deploy_profiles', {
        profiles: ['global'],
        scope: 'project',
        targetDirectory: projectRoot,
        dryRun: false,
      });
      expect(applied).toMatchObject({
        status: 'ok',
        dryRun: false,
        scope: 'project',
      });
      expect(applied.writtenPaths?.length).toBeGreaterThan(0);
      expect(fs.readFileSync(path.join(projectRoot, 'AGENTS.md'), 'utf8')).toContain('# rules');
      expect(fs.existsSync(path.join(projectRoot, '.mcv', 'managed.json'))).toBe(true);
    } finally {
      await close();
    }
  });

  it('deploy_profiles returns structured Issues when non-interactive apply is blocked', async () => {
    const homeDir = path.join(testRoot, 'home');
    fs.mkdirSync(path.join(homeDir, '.claude'), { recursive: true });
    const context = deviceContextFor(testRoot, homeDir);
    enableClaudeDeployFixture(repositoryPath, context);
    const stalePath = path.join(homeDir, '.claude', 'skills', 'stale', 'SKILL.md');
    fs.mkdirSync(path.dirname(stalePath), { recursive: true });
    fs.writeFileSync(stalePath, 'stale\n');
    writeState(context, {
      schemaVersion: 2,
      defaultRepositoryId: 'repository-id',
      repositoryPath,
      managedInventory: {
        [stalePath]: {
          source: repositoryPath,
          hash: crypto.createHash('sha256').update('stale\n').digest('hex'),
        },
      },
    });

    const { client, close } = await connectInMemory(repositoryPath, context);
    try {
      const blocked = await callStructured(client, 'deploy_profiles', {
        profiles: ['global'],
        scope: 'global',
        dryRun: false,
      });
      expect(blocked).toMatchObject({
        status: 'blocked',
        error: { code: 'deploy.nonInteractiveBlocked' },
      });
      expect(blocked.issues?.length).toBeGreaterThan(0);
      expect(fs.existsSync(stalePath)).toBe(true);
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
          expect(tools.map((tool) => tool.name).sort()).toEqual([
            'deploy_profiles',
            'inspect_inventory',
            'read_assets',
            'update_profiles',
          ]);
          const inspect = tools.find((tool) => tool.name === 'inspect_inventory');
          const read = tools.find((tool) => tool.name === 'read_assets');
          const update = tools.find((tool) => tool.name === 'update_profiles');
          const deploy = tools.find((tool) => tool.name === 'deploy_profiles');
          expect(inspect?.annotations).toEqual({ readOnlyHint: true, openWorldHint: false });
          expect(read?.annotations).toEqual({ readOnlyHint: true, openWorldHint: false });
          expect(update?.annotations).toEqual({
            readOnlyHint: false,
            destructiveHint: true,
            idempotentHint: true,
          });
          expect(deploy?.annotations).toEqual({
            readOnlyHint: false,
            destructiveHint: true,
            openWorldHint: false,
          });
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
          expect(update?.outputSchema).toMatchObject({ type: 'object' });
          expect(deploy?.outputSchema).toMatchObject({ type: 'object' });
        } finally {
          await client.close();
        }
      } finally {
        fs.rmSync(testRoot, { recursive: true, force: true });
      }
    }, 30_000);
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
  }, 30_000);
});

async function connectInMemory(
  repositoryPath: string,
  context: DeviceContext = {
    homeDir: os.tmpdir(),
    platform: process.platform,
    env: {},
  },
): Promise<{
  client: Client;
  close: () => Promise<void>;
}> {
  const server = createMcvMcpServer(repositoryPath, context);
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

const structuredOutputSchemas = {
  inspect_inventory: InspectInventoryOutputSchema,
  read_assets: ReadAssetsOutputSchema,
  update_profiles: UpdateProfilesOutputSchema,
  deploy_profiles: DeployProfilesOutputSchema,
};

type StructuredToolName = keyof typeof structuredOutputSchemas;
type StructuredToolOutput<Name extends StructuredToolName> =
  ReturnType<(typeof structuredOutputSchemas)[Name]['parse']>;

async function callStructured<Name extends StructuredToolName>(
  client: Client,
  name: Name,
  args: Record<string, unknown>,
): Promise<StructuredToolOutput<Name>> {
  const result = await client.callTool({ name, arguments: args });
  expect(result.structuredContent).toEqual(expect.any(Object));
  return structuredOutputSchemas[name].parse(result.structuredContent) as StructuredToolOutput<Name>;
}

function deviceContextFor(testRoot: string, homeDir: string): DeviceContext {
  return {
    homeDir,
    platform: process.platform === 'win32' ? 'win32' : 'darwin',
    env: { APPDATA: path.join(testRoot, 'state') },
  };
}

function enableClaudeDeployFixture(repositoryPath: string, context: DeviceContext): void {
  fs.mkdirSync(path.join(context.homeDir, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(repositoryPath, 'mcv.yaml'), [
    'schemaVersion: 4',
    'repositoryId: repository-id',
    'initializedAt: 2026-07-19T00:00:00.000Z',
    'targets:',
    '  codex: { enabled: true }',
    '  claudeCode: { enabled: true }',
    '  gemini:',
    '    enabled: true',
    '    surfaces: { geminiCli: true, antigravity: false }',
    'variables: {}',
    'capture:',
    '  preserveUnknownNativeFields: true',
    'deploy:',
    '  backupBeforeWrite: true',
    '  useSymlinks: false',
    '',
  ].join('\n'));
  fs.mkdirSync(path.join(repositoryPath, 'ide', 'claude-code', 'native'), { recursive: true });
  fs.writeFileSync(
    path.join(repositoryPath, 'ide', 'claude-code', 'native', 'settings.json'),
    `${JSON.stringify({ theme: 'dark' }, null, 2)}\n`,
  );
  writeProfilesDocument(repositoryPath, {
    ...emptyProfilesDocument(),
    profiles: {
      global: { title: 'Global', assets: ['rule:canonical'] },
    },
  });
  writeState(context, {
    schemaVersion: 2,
    defaultRepositoryId: 'repository-id',
    repositoryPath,
  });
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
