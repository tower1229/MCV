import * as fs from 'fs';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProgram } from '../index';

describe('mcv capture', () => {
  const originalCwd = process.cwd();
  let testRoot: string;
  let repositoryPath: string;
  let homeDir: string;

  beforeEach(() => {
    testRoot = fs.mkdtempSync(path.join(originalCwd, '.mcv-capture-test-'));
    repositoryPath = path.join(testRoot, 'repository');
    homeDir = path.join(testRoot, 'home');
    fs.mkdirSync(repositoryPath);
    fs.mkdirSync(path.join(homeDir, '.claude'), { recursive: true });
    fs.writeFileSync(
      path.join(repositoryPath, 'mcv.yaml'),
      'schemaVersion: 1\ntargets:\n  claudeCode:\n    enabled: true\n',
    );
    fs.writeFileSync(
      path.join(homeDir, '.claude', 'settings.json'),
      JSON.stringify({ theme: 'dark', apiToken: 'must-not-leak' }),
    );
    process.chdir(repositoryPath);
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    process.chdir(originalCwd);
    vi.restoreAllMocks();
    fs.rmSync(testRoot, { recursive: true, force: true });
  });

  it('previews only sanitized content and does not write when the user declines', async () => {
    const confirmCapture = vi.fn().mockResolvedValue(false);

    await createProgram(
      { homeDir, platform: 'win32' },
      { confirmCapture },
    ).parseAsync(['node', 'mcv', 'capture']);

    const preview = vi.mocked(console.log).mock.calls.flat().join('\n');
    expect(preview).toContain('${env:API_TOKEN}');
    expect(preview).not.toContain('must-not-leak');
    expect(confirmCapture).toHaveBeenCalledOnce();
    expect(fs.existsSync(path.join(repositoryPath, 'ide'))).toBe(false);
  });

  it('writes the confirmed processed files to the local repository', async () => {
    fs.writeFileSync(
      path.join(homeDir, '.claude', 'CLAUDE.md'),
      '# Personal instructions\n',
    );
    fs.writeFileSync(
      path.join(homeDir, '.claude.json'),
      JSON.stringify({
        mcpServers: {
          local: {
            command: path.join(homeDir, 'bin', 'server.exe'),
            env: { apiKey: 'must-not-leak' },
          },
        },
        projects: { [homeDir]: { hasTrustDialogAccepted: true } },
      }),
    );

    await createProgram(
      { homeDir, platform: 'win32' },
      { confirmCapture: async () => true },
    ).parseAsync(['node', 'mcv', 'capture']);

    expect(
      fs.readFileSync(path.join(repositoryPath, 'common', 'AGENTS.md'), 'utf8'),
    ).toBe('# Personal instructions\n');
    expect(
      fs.readFileSync(
        path.join(repositoryPath, 'ide', 'claude-code', 'native', 'settings.json'),
        'utf8',
      ),
    ).toContain('${env:API_TOKEN}');
    const mcpRegistry = fs.readFileSync(
      path.join(repositoryPath, 'common', 'mcp.yaml'),
      'utf8',
    );
    expect(mcpRegistry).toContain('${HOME}\\bin\\server.exe');
    expect(mcpRegistry).toContain('${env:API_KEY}');
    expect(mcpRegistry).not.toContain('must-not-leak');
    expect(mcpRegistry).not.toContain('projects:');
  });

  it('preserves repository-only native fields and MCP servers when applying capture', async () => {
    const nativeDirectory = path.join(
      repositoryPath,
      'ide',
      'claude-code',
      'native',
    );
    fs.mkdirSync(nativeDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(nativeDirectory, 'settings.json'),
      JSON.stringify({ repositoryOnly: true, theme: 'light' }, null, 2) + '\n',
    );
    fs.mkdirSync(path.join(repositoryPath, 'common'));
    fs.writeFileSync(
      path.join(repositoryPath, 'common', 'mcp.yaml'),
      'servers:\n  other-ide:\n    command: remote-server\n',
    );
    fs.writeFileSync(
      path.join(homeDir, '.claude.json'),
      JSON.stringify({
        mcpServers: { claude: { command: 'claude-server' } },
      }),
    );

    await createProgram(
      { homeDir },
      { confirmCapture: async () => true },
    ).parseAsync(['node', 'mcv', 'capture']);

    expect(
      JSON.parse(fs.readFileSync(path.join(nativeDirectory, 'settings.json'), 'utf8')),
    ).toEqual({ repositoryOnly: true, theme: 'dark', apiToken: '${env:API_TOKEN}' });
    const mcpRegistry = fs.readFileSync(
      path.join(repositoryPath, 'common', 'mcp.yaml'),
      'utf8',
    );
    expect(mcpRegistry).toContain('other-ide:');
    expect(mcpRegistry).toContain('claude:');
  });
});
