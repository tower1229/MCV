import * as fs from 'fs';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { GeminiAdapter } from './gemini';

describe('GeminiAdapter', () => {
  let homeDir: string;

  beforeEach(() => {
    homeDir = fs.mkdtempSync(path.join(process.cwd(), '.mcv-gemini-adapter-test-'));
  });

  afterEach(() => {
    fs.rmSync(homeDir, { recursive: true, force: true });
  });

  it('discovers Gemini and separates MCP servers from native settings', async () => {
    const geminiRoot = path.join(homeDir, '.gemini');
    fs.mkdirSync(geminiRoot);
    fs.writeFileSync(
      path.join(geminiRoot, 'settings.json'),
      JSON.stringify({ ui: { theme: 'dark' }, mcpServers: { local: { command: 'server' } } }),
    );
    const adapter = new GeminiAdapter();
    const context = { homeDir };

    await expect(adapter.detect(context)).resolves.toMatchObject({
      id: 'gemini',
      name: 'Gemini',
      detected: true,
    });
    const result = await adapter.capture(await adapter.discoverFiles(context), context);
    const native = result.files.find(
      (file) => file.repositoryPath === 'ide/gemini/native/settings.json',
    );
    const mcp = result.files.find((file) => file.repositoryPath === 'common/mcp.yaml');

    expect(JSON.parse(native?.content ?? '')).toEqual({ ui: { theme: 'dark' } });
    expect(parseYaml(mcp?.content ?? '')).toEqual({
      servers: { local: { command: 'server' } },
    });
  });
});
