import * as fs from 'fs';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProgram } from '../index';
import { parse as parseToml } from 'smol-toml';

describe('mcv capture', () => {
  const originalCwd = process.cwd();
  let testRoot: string;
  let repositoryPath: string;
  let homeDir: string;
  let stateRoot: string;

  beforeEach(() => {
    testRoot = fs.mkdtempSync(path.join(originalCwd, '.mcv-capture-test-'));
    repositoryPath = path.join(testRoot, 'repository');
    homeDir = path.join(testRoot, 'home');
    stateRoot = path.join(testRoot, 'device');
    fs.mkdirSync(repositoryPath);
    fs.mkdirSync(path.join(homeDir, '.claude'), { recursive: true });
    fs.writeFileSync(
      path.join(repositoryPath, 'mcv.yaml'),
      'schemaVersion: 2\nrepositoryId: test\ninitializedAt: test\nsecurity: { scanSecrets: true, allowPlaintextSecrets: false }\ncapture: { preserveUnknownNativeFields: true }\ndeploy: { backupBeforeWrite: true, useSymlinks: false }\ntargets:\n  claudeCode:\n    enabled: true\nvariables: {}\n',
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

  const deviceContext = (platform: NodeJS.Platform = 'darwin') => ({
    homeDir,
    platform,
    env: { APPDATA: stateRoot },
  });

  it('prints one safe Capture Plan JSON document without writing', async () => {
    await createProgram(deviceContext('win32')).parseAsync([
      'node',
      'mcv',
      'capture',
      '--dry-run',
      '--json',
    ]);

    expect(console.log).toHaveBeenCalledOnce();
    const plan = JSON.parse(String(vi.mocked(console.log).mock.calls[0]?.[0]));
    expect(plan).toMatchObject({
      schemaVersion: 1,
      operation: 'capture',
      status: 'planned',
      readyToApply: true,
      repositoryPath,
      changes: [expect.objectContaining({
        id: expect.any(String),
        ide: 'claude-code',
        itemType: 'file',
        defaultSelected: true,
      })],
    });
    expect(JSON.stringify(plan)).toContain('${env:API_TOKEN}');
    expect(JSON.stringify(plan)).not.toContain('must-not-leak');
    expect(fs.existsSync(path.join(repositoryPath, 'ide'))).toBe(false);
    expect(readFileIfPresent(path.join(stateRoot, 'mcv', 'config.json'))).toBeUndefined();
  });

  it('prints an English grouped Capture Plan without writing', async () => {
    await createProgram(deviceContext('win32')).parseAsync([
      'node',
      'mcv',
      'capture',
      '--dry-run',
    ]);

    const output = vi.mocked(console.log).mock.calls.flat().join('\n');
    expect(output).toContain(`Capture Plan: ${repositoryPath}`);
    expect(output).toContain('Claude Code / File');
    expect(output).toContain('[add] settings.json');
    expect(output).toContain('${env:API_TOKEN}');
    expect(output).not.toContain('must-not-leak');
    expect(fs.existsSync(path.join(repositoryPath, 'ide'))).toBe(false);
  });

  it('previews only sanitized content and does not write when the user declines', async () => {
    const confirmCapture = vi.fn().mockResolvedValue(false);

    await createProgram(
      deviceContext('win32'),
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
      deviceContext('win32'),
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
      deviceContext(),
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

  it('captures Gemini merged settings while preserving repository-only fields', async () => {
    fs.writeFileSync(
      path.join(repositoryPath, 'mcv.yaml'),
      'schemaVersion: 2\nrepositoryId: test\ninitializedAt: test\nsecurity: { scanSecrets: true, allowPlaintextSecrets: false }\ncapture: { preserveUnknownNativeFields: true }\ndeploy: { backupBeforeWrite: true, useSymlinks: false }\ntargets:\n  gemini:\n    enabled: true\nvariables: {}\n',
    );
    const geminiRoot = path.join(homeDir, '.gemini');
    fs.mkdirSync(geminiRoot, { recursive: true });
    fs.writeFileSync(
      path.join(geminiRoot, 'settings.json'),
      JSON.stringify({
        ui: { theme: 'dark' },
        mcpServers: { gemini: { command: 'gemini-server' } },
      }),
    );
    const nativeRoot = path.join(repositoryPath, 'ide', 'gemini', 'native', 'gemini-cli');
    fs.mkdirSync(nativeRoot, { recursive: true });
    fs.writeFileSync(
      path.join(nativeRoot, 'settings.json'),
      `${JSON.stringify({ repositoryOnly: true, ui: { density: 'compact' } }, null, 2)}\n`,
    );
    fs.mkdirSync(path.join(repositoryPath, 'common'), { recursive: true });
    fs.writeFileSync(
      path.join(repositoryPath, 'common', 'mcp.yaml'),
      'servers:\n  existing:\n    command: existing-server\n',
    );

    await createProgram(
      deviceContext(),
      { confirmCapture: async () => true },
    ).parseAsync(['node', 'mcv', 'capture']);

    expect(
      JSON.parse(fs.readFileSync(path.join(nativeRoot, 'settings.json'), 'utf8')),
    ).toEqual({
      repositoryOnly: true,
      ui: { density: 'compact', theme: 'dark' },
    });
    const mcpRegistry = fs.readFileSync(
      path.join(repositoryPath, 'common', 'mcp.yaml'),
      'utf8',
    );
    expect(mcpRegistry).toContain('existing:');
    expect(mcpRegistry).toContain('gemini:');
  });

  it('structurally merges captured Codex TOML with repository-native fields', async () => {
    fs.writeFileSync(
      path.join(repositoryPath, 'mcv.yaml'),
      'schemaVersion: 2\nrepositoryId: test\ninitializedAt: test\nsecurity: { scanSecrets: true, allowPlaintextSecrets: false }\ncapture: { preserveUnknownNativeFields: true }\ndeploy: { backupBeforeWrite: true, useSymlinks: false }\ntargets:\n  codex:\n    enabled: true\nvariables: {}\n',
    );
    const codexRoot = path.join(homeDir, '.codex');
    fs.mkdirSync(codexRoot, { recursive: true });
    fs.writeFileSync(path.join(codexRoot, 'config.toml'), 'model = "gpt-5"\n');
    const nativeRoot = path.join(repositoryPath, 'ide', 'codex', 'native');
    fs.mkdirSync(nativeRoot, { recursive: true });
    fs.writeFileSync(
      path.join(nativeRoot, 'config.toml'),
      'personality = "pragmatic"\nmodel = "gpt-4"\n',
    );

    await createProgram(
      deviceContext(),
      { confirmCapture: async () => true },
    ).parseAsync(['node', 'mcv', 'capture']);

    expect(parseToml(fs.readFileSync(path.join(nativeRoot, 'config.toml'), 'utf8'))).toEqual({
      personality: 'pragmatic',
      model: 'gpt-5',
    });
  });

  it('automatically captures the newest complete copy of a conflicting Skill', async () => {
    fs.writeFileSync(
      path.join(repositoryPath, 'mcv.yaml'),
      [
        'schemaVersion: 2',
        'repositoryId: test',
        'initializedAt: test',
        'security: { scanSecrets: true, allowPlaintextSecrets: false }',
        'capture: { preserveUnknownNativeFields: true }',
        'deploy: { backupBeforeWrite: true, useSymlinks: false }',
        'targets:',
        '  codex:',
        '    enabled: true',
        '  gemini:',
        '    enabled: true',
        'variables: {}',
        '',
      ].join('\n'),
    );
    const oldSkill = path.join(homeDir, '.codex', 'skills', 'review');
    const newSkill = path.join(homeDir, '.gemini', 'config', 'skills', 'review');
    fs.mkdirSync(oldSkill, { recursive: true });
    fs.mkdirSync(newSkill, { recursive: true });
    const oldFile = path.join(oldSkill, 'SKILL.md');
    const newFile = path.join(newSkill, 'SKILL.md');
    fs.writeFileSync(oldFile, '---\nname: review\n---\n# Old review\n');
    fs.writeFileSync(newFile, '---\nname: review\n---\n# New review\n');
    fs.utimesSync(oldFile, new Date('2026-01-01T00:00:00Z'), new Date('2026-01-01T00:00:00Z'));
    fs.utimesSync(newFile, new Date('2026-07-01T00:00:00Z'), new Date('2026-07-01T00:00:00Z'));
    const selectConflict = vi.fn();

    await createProgram(
      { ...deviceContext(), pathEnv: '' },
      { confirmCapture: async () => true, selectConflict },
    ).parseAsync(['node', 'mcv', 'capture']);

    expect(selectConflict).not.toHaveBeenCalled();
    expect(
      fs.readFileSync(path.join(repositoryPath, 'common', 'skills', 'review', 'SKILL.md'), 'utf8'),
    ).toContain('# New review');
  });

  it('automatically merges distinct canonical rules from multiple enabled IDEs', async () => {
    fs.writeFileSync(
      path.join(repositoryPath, 'mcv.yaml'),
      [
        'schemaVersion: 2',
        'repositoryId: test',
        'initializedAt: test',
        'security: { scanSecrets: true, allowPlaintextSecrets: false }',
        'capture: { preserveUnknownNativeFields: true }',
        'deploy: { backupBeforeWrite: true, useSymlinks: false }',
        'targets:',
        '  codex:',
        '    enabled: true',
        '  claudeCode:',
        '    enabled: true',
        '  gemini:',
        '    enabled: true',
        'variables: {}',
        '',
      ].join('\n'),
    );
    fs.mkdirSync(path.join(homeDir, '.codex'), { recursive: true });
    fs.mkdirSync(path.join(homeDir, '.gemini'), { recursive: true });
    fs.writeFileSync(
      path.join(homeDir, '.codex', 'AGENTS.md'),
      '# Personal rules\n\nAlways run tests.\n\nUse TypeScript.\n',
    );
    fs.writeFileSync(
      path.join(homeDir, '.claude', 'CLAUDE.md'),
      '# Personal rules\n\nAlways run tests.\n\nPrefer clear names.\n',
    );
    fs.writeFileSync(
      path.join(homeDir, '.gemini', 'GEMINI.md'),
      '# Personal rules\n\nUse TypeScript.\n\nDocument risks.\n',
    );
    fs.mkdirSync(path.join(repositoryPath, 'common'), { recursive: true });
    fs.writeFileSync(
      path.join(repositoryPath, 'common', 'AGENTS.md'),
      '# Personal rules\n\nPreserve repository knowledge.\n',
    );
    const selectConflict = vi.fn();

    await createProgram(
      { ...deviceContext(), pathEnv: '' },
      { confirmCapture: async () => true, selectConflict },
    ).parseAsync(['node', 'mcv', 'capture']);

    expect(selectConflict).not.toHaveBeenCalled();
    expect(
      fs.readFileSync(path.join(repositoryPath, 'common', 'AGENTS.md'), 'utf8'),
    ).toBe(
      '# Personal rules\n\nPreserve repository knowledge.\n\nAlways run tests.\n\nUse TypeScript.\n\nPrefer clear names.\n\nDocument risks.\n',
    );
  });

  it('preserves Repository rules when capturing from a single enabled IDE', async () => {
    fs.mkdirSync(path.join(repositoryPath, 'common'), { recursive: true });
    fs.writeFileSync(
      path.join(repositoryPath, 'common', 'AGENTS.md'),
      '# Personal rules\n\nPreserve repository knowledge.\n',
    );
    fs.writeFileSync(
      path.join(homeDir, '.claude', 'CLAUDE.md'),
      '# Personal rules\n\nCapture local knowledge.\n',
    );

    await createProgram(
      deviceContext(),
      { confirmCapture: async () => true },
    ).parseAsync(['node', 'mcv', 'capture']);

    expect(
      fs.readFileSync(path.join(repositoryPath, 'common', 'AGENTS.md'), 'utf8'),
    ).toBe(
      '# Personal rules\n\nPreserve repository knowledge.\n\nCapture local knowledge.\n',
    );
  });
});

function readFileIfPresent(filePath: string): string | undefined {
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : undefined;
}
