import * as fs from 'fs';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parse as parseToml } from 'smol-toml';
import { parse as parseYaml } from 'yaml';
import { CodexAdapter } from './codex';

describe('CodexAdapter', () => {
  let homeDir: string;

  beforeEach(() => {
    homeDir = fs.mkdtempSync(path.join(process.cwd(), '.mcv-codex-adapter-test-'));
  });

  afterEach(() => {
    fs.rmSync(homeDir, { recursive: true, force: true });
  });

  it('discovers and separates Codex managed, native, and local configuration', async () => {
    const codexRoot = path.join(homeDir, '.codex');
    fs.mkdirSync(codexRoot);
    fs.writeFileSync(
      path.join(codexRoot, 'config.toml'),
      [
        'model = "gpt-5"',
        '[projects."C:/local/project"]',
        'trust_level = "trusted"',
        '[mcp_servers.local]',
        `command = "${path.join(homeDir, 'bin', 'server.exe').replace(/\\/g, '\\\\')}"`,
        '[mcp_servers.local.env]',
        'API_TOKEN = "real-token"',
        '',
      ].join('\n'),
    );
    fs.writeFileSync(path.join(codexRoot, 'AGENTS.md'), '# Rules\n');
    const adapter = new CodexAdapter();
    const context = { homeDir, platform: 'win32' as const, env: {} };

    await expect(adapter.detect(context)).resolves.toMatchObject({
      id: 'codex',
      name: 'Codex',
      detected: true,
    });
    const result = await adapter.capture(await adapter.discoverFiles(context), context);
    const native = result.files.find(
      (file) => file.repositoryPath === 'ide/codex/native/config.toml',
    );
    const mcp = result.files.find((file) => file.repositoryPath === 'common/mcp.yaml');

    expect(parseToml(native?.content.toString() ?? '')).toEqual({ model: 'gpt-5' });
    expect(parseYaml(mcp?.content.toString() ?? '')).toEqual({
      servers: {
        local: {
          command: '${HOME}\\bin\\server.exe',
          env: { API_TOKEN: '${env:API_TOKEN}' },
          transport: 'stdio',
        },
      },
    });
    expect(result.files).toContainEqual(expect.objectContaining({
      repositoryPath: 'common/AGENTS.md',
      content: '# Rules\n',
    }));
  });
});
