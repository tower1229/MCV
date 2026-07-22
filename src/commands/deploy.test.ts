import * as fs from 'fs';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProgram } from '../index';
import { findSymbolicLinkAncestor } from '../utils/files';

describe('mcv deploy', () => {
  const originalCwd = process.cwd();
  let testRoot: string;
  let repositoryPath: string;
  let homeDir: string;
  let stateRoot: string;

  beforeEach(() => {
    testRoot = fs.mkdtempSync(path.join(originalCwd, '.mcv-deploy-test-'));
    repositoryPath = path.join(testRoot, 'repository');
    homeDir = path.join(testRoot, 'home');
    stateRoot = path.join(testRoot, 'device');
    fs.mkdirSync(
      path.join(repositoryPath, 'ide', 'claude-code', 'native'),
      { recursive: true },
    );
    fs.writeFileSync(
      path.join(repositoryPath, 'mcv.yaml'),
      [
        'schemaVersion: 2',
        'repositoryId: test',
        'initializedAt: test',
        'security: { scanSecrets: true, allowPlaintextSecrets: false }',
        'capture: { preserveUnknownNativeFields: true }',
        'targets:',
        '  claudeCode:',
        '    enabled: true',
        'variables:',
        '  TOOLS_HOME:',
        '    windows: "${HOME}\\\\Tools"',
        'deploy:',
        '  backupBeforeWrite: true',
        '  useSymlinks: false',
        '',
      ].join('\n'),
    );
    fs.writeFileSync(
      path.join(repositoryPath, 'ide', 'claude-code', 'native', 'settings.json'),
      `${JSON.stringify({
        theme: 'dark',
        command: '${TOOLS_HOME}\\tool.exe',
      }, null, 2)}\n`,
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

  const windowsHomeDir = () => homeDir.replace(/\//g, '\\');

  it('deploys repository configuration with portable paths resolved for this device', async () => {
    await createProgram(
      deviceContext('win32'),
      {},
      { confirmDeploy: async () => true },
    ).parseAsync(['node', 'mcv', 'deploy']);

    expect(
      JSON.parse(
        fs.readFileSync(path.join(homeDir, '.claude', 'settings.json'), 'utf8'),
      ),
    ).toEqual({
      theme: 'dark',
      command: `${windowsHomeDir()}\\Tools\\tool.exe`,
    });
  });

  it('prints the same grouped read-only Deploy Plan as English text or one JSON document', async () => {
    fs.mkdirSync(path.join(repositoryPath, 'common'), { recursive: true });
    fs.writeFileSync(path.join(repositoryPath, 'common', 'AGENTS.md'), '# Rules\n');

    await createProgram(deviceContext('win32')).parseAsync(['node', 'mcv', 'deploy', '--dry-run']);
    const plain = vi.mocked(console.log).mock.calls.map(([line]) => String(line)).join('\n');
    expect(plain).toContain('Deploy Plan:');
    expect(plain).toContain('Claude Code / Shared Rules');
    expect(plain).toContain('[replace entire file]');

    vi.mocked(console.log).mockClear();
    await createProgram(deviceContext('win32')).parseAsync(['node', 'mcv', 'deploy', '--dry-run', '--json']);
    expect(vi.mocked(console.log)).toHaveBeenCalledOnce();
    expect(JSON.parse(String(vi.mocked(console.log).mock.calls[0][0]))).toEqual(
      expect.objectContaining({
        schemaVersion: 1,
        operation: 'deploy',
        status: 'planned',
        repositoryPath,
        changes: expect.arrayContaining([
          expect.objectContaining({ capability: 'rules', strategy: 'replace-entire-file' }),
        ]),
      }),
    );
    expect(fs.existsSync(path.join(homeDir, '.claude', 'CLAUDE.md'))).toBe(false);
  });

  it('detects a symbolic-link ancestor before planning writes beneath it', () => {
    const target = path.join(testRoot, 'link-target');
    const link = path.join(testRoot, 'link');
    fs.mkdirSync(target);
    fs.symlinkSync(target, link, process.platform === 'win32' ? 'junction' : 'dir');
    expect(findSymbolicLinkAncestor(path.join(link, 'nested', 'file.txt'))).toBe(link);
  });

  it('deploys canonical rules as Claude Code instructions', async () => {
    const rules = '# Personal rules\n\nAlways run tests.\n';
    fs.mkdirSync(path.join(repositoryPath, 'common'), { recursive: true });
    fs.writeFileSync(path.join(repositoryPath, 'common', 'AGENTS.md'), rules);

    await createProgram(
      deviceContext('win32'),
      {},
      { confirmDeploy: async () => true },
    ).parseAsync(['node', 'mcv', 'deploy']);

    expect(
      fs.readFileSync(path.join(homeDir, '.claude', 'CLAUDE.md'), 'utf8'),
    ).toBe(rules);
  });

  it('copies canonical skill packages recursively to Claude Code', async () => {
    const skillRoot = path.join(repositoryPath, 'common', 'skills', 'review');
    const resource = Buffer.from([0, 1, 2, 255]);
    fs.mkdirSync(path.join(skillRoot, 'resources'), { recursive: true });
    fs.writeFileSync(path.join(skillRoot, 'SKILL.md'), '# Review\n');
    fs.writeFileSync(path.join(skillRoot, 'resources', 'fixture.bin'), resource);

    await createProgram(
      deviceContext('win32'),
      {},
      { confirmDeploy: async () => true },
    ).parseAsync(['node', 'mcv', 'deploy']);

    expect(
      fs.readFileSync(path.join(homeDir, '.claude', 'skills', 'review', 'SKILL.md'), 'utf8'),
    ).toBe('# Review\n');
    expect(
      fs.readFileSync(
        path.join(homeDir, '.claude', 'skills', 'review', 'resources', 'fixture.bin'),
      ),
    ).toEqual(resource);
  });

  it('prunes only exact duplicate Codex skills from the legacy directory', async () => {
    fs.writeFileSync(
      path.join(repositoryPath, 'mcv.yaml'),
      'schemaVersion: 2\nrepositoryId: test\ninitializedAt: test\nsecurity: { scanSecrets: true, allowPlaintextSecrets: false }\ncapture: { preserveUnknownNativeFields: true }\ndeploy: { backupBeforeWrite: true, useSymlinks: false }\ntargets:\n  codex:\n    enabled: true\nvariables: {}\n',
    );
    const canonicalSkill = path.join(repositoryPath, 'common', 'skills', 'grill-me');
    fs.mkdirSync(path.join(canonicalSkill, 'references'), { recursive: true });
    fs.writeFileSync(path.join(canonicalSkill, 'SKILL.md'), '# Grill Me\n');
    fs.writeFileSync(path.join(canonicalSkill, 'references', 'questions.md'), '# Questions\n');

    const duplicateLegacySkill = path.join(homeDir, '.codex', 'skills', 'grill-me');
    fs.mkdirSync(path.join(duplicateLegacySkill, 'references'), { recursive: true });
    fs.writeFileSync(path.join(duplicateLegacySkill, 'SKILL.md'), '# Grill Me\n');
    fs.writeFileSync(path.join(duplicateLegacySkill, 'references', 'questions.md'), '# Questions\n');
    const divergentLegacySkill = path.join(homeDir, '.codex', 'skills', 'tdd');
    fs.mkdirSync(divergentLegacySkill, { recursive: true });
    fs.writeFileSync(path.join(divergentLegacySkill, 'SKILL.md'), '# Legacy TDD\n');

    await createProgram(
      deviceContext('win32'),
    ).parseAsync(['node', 'mcv', 'deploy', '--dry-run']);
    expect(fs.existsSync(path.join(duplicateLegacySkill, 'SKILL.md'))).toBe(true);
    expect(vi.mocked(console.log)).toHaveBeenCalledWith(
      expect.stringContaining('[duplicate:codex-legacy] grill-me'),
    );

    await createProgram(
      deviceContext('win32'),
      {},
      { confirmDeploy: async () => true },
    ).parseAsync(['node', 'mcv', 'deploy', '--prune-managed']);

    expect(fs.existsSync(path.join(duplicateLegacySkill, 'SKILL.md'))).toBe(false);
    expect(fs.existsSync(path.join(duplicateLegacySkill, 'references', 'questions.md'))).toBe(false);
    expect(fs.readFileSync(path.join(divergentLegacySkill, 'SKILL.md'), 'utf8')).toBe('# Legacy TDD\n');
    expect(fs.readFileSync(path.join(homeDir, '.agents', 'skills', 'grill-me', 'SKILL.md'), 'utf8')).toBe('# Grill Me\n');

    await createProgram(deviceContext('win32')).parseAsync(['node', 'mcv', 'restore']);
    expect(fs.readFileSync(path.join(duplicateLegacySkill, 'SKILL.md'), 'utf8')).toBe('# Grill Me\n');
    expect(fs.readFileSync(path.join(duplicateLegacySkill, 'references', 'questions.md'), 'utf8')).toBe('# Questions\n');
  });

  it('merges the canonical MCP registry into Claude Code native state', async () => {
    fs.mkdirSync(path.join(repositoryPath, 'common'), { recursive: true });
    fs.writeFileSync(
      path.join(repositoryPath, 'common', 'mcp.yaml'),
      [
        'servers:',
        '  local-tools:',
        '    command: "${TOOLS_HOME}\\\\mcp.exe"',
        '    args:',
        '      - serve',
        '',
      ].join('\n'),
    );
    fs.writeFileSync(
      path.join(repositoryPath, 'ide', 'claude-code', 'native', '.claude.json'),
      `${JSON.stringify({ customPreference: { compactMode: true } }, null, 2)}\n`,
    );
    fs.mkdirSync(homeDir, { recursive: true });
    fs.writeFileSync(
      path.join(homeDir, '.claude.json'),
      `${JSON.stringify({
        localPreference: { theme: 'dark' },
        mcpServers: { stale: { command: 'old.exe' } },
      }, null, 2)}\n`,
    );

    await createProgram(
      deviceContext('win32'),
      {},
      { confirmDeploy: async () => true },
    ).parseAsync(['node', 'mcv', 'deploy']);

    expect(
      JSON.parse(fs.readFileSync(path.join(homeDir, '.claude.json'), 'utf8')),
    ).toEqual({
      localPreference: { theme: 'dark' },
      customPreference: { compactMode: true },
      mcpServers: {
        'local-tools': {
          command: `${windowsHomeDir()}\\Tools\\mcp.exe`,
          args: ['serve'],
        },
      },
    });
  });

  it('backs up modified native files and skips unchanged redeploys', async () => {
    fs.mkdirSync(path.join(homeDir, '.claude'), { recursive: true });
    const settingsPath = path.join(homeDir, '.claude', 'settings.json');
    const statePath = path.join(homeDir, '.claude.json');
    const originalSettings = `${JSON.stringify({ theme: 'light', localOnly: true }, null, 2)}\n`;
    const originalState = `${JSON.stringify({
      projects: { local: { trusted: true } },
      mcpServers: { stale: { command: 'old.exe' } },
    }, null, 2)}\n`;
    fs.writeFileSync(settingsPath, originalSettings);
    fs.writeFileSync(statePath, originalState);
    fs.writeFileSync(
      path.join(
        repositoryPath,
        'ide',
        'claude-code',
        'native',
        '.claude.json',
      ),
      `${JSON.stringify({
        customPreference: true,
        projects: { repositoryMustNotDeploy: true },
      }, null, 2)}\n`,
    );

    const runDeploy = () => createProgram(
      deviceContext('win32'),
      {},
      { confirmDeploy: async () => true },
    ).parseAsync(['node', 'mcv', 'deploy']);

    await runDeploy();

    expect(JSON.parse(fs.readFileSync(settingsPath, 'utf8'))).toEqual({
      localOnly: true,
      theme: 'dark',
      command: `${windowsHomeDir()}\\Tools\\tool.exe`,
    });
    expect(JSON.parse(fs.readFileSync(statePath, 'utf8'))).toEqual({
      projects: { local: { trusted: true } },
      customPreference: true,
    });

    const backupRoot = path.join(stateRoot, 'mcv', 'backups');
    const backupDirectories = fs.readdirSync(backupRoot);
    expect(backupDirectories).toHaveLength(1);
    const backupDirectory = path.join(backupRoot, backupDirectories[0]);
    const manifest = JSON.parse(
      fs.readFileSync(path.join(backupDirectory, 'manifest.json'), 'utf8'),
    ) as { files: Array<{ originalPath: string; backupPath: string }> };
    const backedUpContent = Object.fromEntries(
      manifest.files.map((file) => [
        file.originalPath,
        fs.readFileSync(path.join(backupDirectory, file.backupPath), 'utf8'),
      ]),
    );
    expect(backedUpContent).toMatchObject({
      [settingsPath]: originalSettings,
      [statePath]: originalState,
    });

    vi.mocked(console.log).mockClear();
    await runDeploy();

    expect(fs.readdirSync(backupRoot)).toEqual(backupDirectories);
    expect(vi.mocked(console.log)).toHaveBeenCalledWith(
      'Claude Code configuration is already in sync.',
    );
  });

  it('records deployed file hashes as the status baseline', async () => {
    const run = (command: 'deploy' | 'status') => createProgram(
      deviceContext('win32'),
      {},
      { confirmDeploy: async () => true },
    ).parseAsync(['node', 'mcv', command]);

    await run('deploy');
    const settingsPath = path.join(homeDir, '.claude', 'settings.json');
    const state = JSON.parse(
      fs.readFileSync(path.join(stateRoot, 'mcv', 'config.json'), 'utf8'),
    ) as { baselineSnapshot: { files: Record<string, string> } };
    expect(state.baselineSnapshot.files[settingsPath]).toMatch(/^[a-f0-9]{64}$/);

    vi.mocked(console.log).mockClear();
    await run('status');
    expect(vi.mocked(console.log)).toHaveBeenCalledWith(`[matching] ${settingsPath}`);

    fs.appendFileSync(settingsPath, '\n');
    vi.mocked(console.log).mockClear();
    await run('status');
    expect(vi.mocked(console.log)).toHaveBeenCalledWith(`[drifted] ${settingsPath}`);
  });

  it('deletes only prior managed inventory when prune is explicitly confirmed', async () => {
    fs.mkdirSync(path.join(repositoryPath, 'common'), { recursive: true });
    fs.writeFileSync(path.join(repositoryPath, 'common', 'AGENTS.md'), '# Managed rules\n');
    const run = (...args: string[]) => createProgram(
      deviceContext('win32'), {}, { confirmDeploy: async () => true },
    ).parseAsync(['node', 'mcv', 'deploy', ...args]);
    await run();
    const targetPath = path.join(homeDir, '.claude', 'CLAUDE.md');
    expect(fs.existsSync(targetPath)).toBe(true);
    fs.rmSync(path.join(repositoryPath, 'common', 'AGENTS.md'));
    await run('--prune-managed');
    expect(fs.existsSync(targetPath)).toBe(false);
    await createProgram(deviceContext('win32')).parseAsync(['node', 'mcv', 'restore']);
    expect(fs.existsSync(targetPath)).toBe(true);
  });

  it('resolves chained portable variables independent of declaration order', async () => {
    fs.writeFileSync(
      path.join(repositoryPath, 'mcv.yaml'),
      [
        'schemaVersion: 2',
        'repositoryId: test',
        'initializedAt: test',
        'security: { scanSecrets: true, allowPlaintextSecrets: false }',
        'capture: { preserveUnknownNativeFields: true }',
        'targets:',
        '  claudeCode:',
        '    enabled: true',
        'variables:',
        '  TOOLS_HOME:',
        '    macos: "${PROJECTS_HOME}/工具"',
        '  PROJECTS_HOME:',
        '    macos: "/Volumes/工作 盘/Code"',
        'deploy:',
        '  backupBeforeWrite: true',
        '  useSymlinks: false',
        '',
      ].join('\n'),
    );
    fs.writeFileSync(
      path.join(repositoryPath, 'ide', 'claude-code', 'native', 'settings.json'),
      `${JSON.stringify({ command: '${TOOLS_HOME}\\bin\\tool' }, null, 2)}\n`,
    );

    await createProgram(
      deviceContext('darwin'),
      {},
      { confirmDeploy: async () => true },
    ).parseAsync(['node', 'mcv', 'deploy']);

    expect(
      JSON.parse(
        fs.readFileSync(path.join(homeDir, '.claude', 'settings.json'), 'utf8'),
      ),
    ).toEqual({ command: '/Volumes/工作 盘/Code/工具/bin/tool' });
  });

  it('gives device variable values precedence over repository defaults', async () => {
    await createProgram(
      {
        ...deviceContext('win32'),
        variables: { TOOLS_HOME: 'D:\\本机 工具' },
      },
      {},
      { confirmDeploy: async () => true },
    ).parseAsync(['node', 'mcv', 'deploy']);

    expect(
      JSON.parse(
        fs.readFileSync(path.join(homeDir, '.claude', 'settings.json'), 'utf8'),
      ),
    ).toEqual({
      theme: 'dark',
      command: 'D:\\本机 工具\\tool.exe',
    });
  });

  it('normalizes portable paths without changing URLs in the same value', async () => {
    fs.writeFileSync(
      path.join(repositoryPath, 'ide', 'claude-code', 'native', 'settings.json'),
      `${JSON.stringify({
        command: '${TOOLS_HOME}/tool --url https://host.example/api',
      }, null, 2)}\n`,
    );

    await createProgram(
      deviceContext('win32'),
      {},
      { confirmDeploy: async () => true },
    ).parseAsync(['node', 'mcv', 'deploy']);

    expect(
      JSON.parse(
        fs.readFileSync(path.join(homeDir, '.claude', 'settings.json'), 'utf8'),
      ),
    ).toEqual({
      command: `${windowsHomeDir()}\\Tools\\tool --url https://host.example/api`,
    });
  });

  it('deploys Gemini merged settings without replacing unknown local fields', async () => {
    fs.writeFileSync(
      path.join(repositoryPath, 'mcv.yaml'),
      'schemaVersion: 2\nrepositoryId: test\ninitializedAt: test\nsecurity: { scanSecrets: true, allowPlaintextSecrets: false }\ncapture: { preserveUnknownNativeFields: true }\ndeploy: { backupBeforeWrite: true, useSymlinks: false }\ntargets:\n  gemini:\n    enabled: true\nvariables: {}\n',
    );
    const nativeRoot = path.join(repositoryPath, 'ide', 'gemini', 'native');
    fs.mkdirSync(nativeRoot, { recursive: true });
    fs.writeFileSync(
      path.join(nativeRoot, 'settings.json'),
      `${JSON.stringify({ ui: { theme: 'dark' }, installationId: 'repository-must-not-deploy' }, null, 2)}\n`,
    );
    fs.mkdirSync(path.join(repositoryPath, 'common'), { recursive: true });
    fs.writeFileSync(
      path.join(repositoryPath, 'common', 'mcp.yaml'),
      'servers:\n  shared:\n    command: shared-server\n',
    );
    const settingsPath = path.join(homeDir, '.gemini', 'settings.json');
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    fs.writeFileSync(
      settingsPath,
      `${JSON.stringify({
        ui: { density: 'compact', theme: 'light' },
        experimental: { nativeOnly: true },
        installationId: 'device-installation',
        mcpServers: { stale: { command: 'old-server' } },
      }, null, 2)}\n`,
    );

    await createProgram(
      deviceContext(),
      {},
      { confirmDeploy: async () => true },
    ).parseAsync(['node', 'mcv', 'deploy']);

    expect(JSON.parse(fs.readFileSync(settingsPath, 'utf8'))).toEqual({
      ui: { density: 'compact', theme: 'dark' },
      experimental: { nativeOnly: true },
      installationId: 'device-installation',
      mcpServers: { shared: { command: 'shared-server' } },
    });
  });

  it('deploys Codex canonical content and preserves unknown TOML fields', async () => {
    fs.writeFileSync(
      path.join(repositoryPath, 'mcv.yaml'),
      'schemaVersion: 2\nrepositoryId: test\ninitializedAt: test\nsecurity: { scanSecrets: true, allowPlaintextSecrets: false }\ncapture: { preserveUnknownNativeFields: true }\ndeploy: { backupBeforeWrite: true, useSymlinks: false }\ntargets:\n  codex:\n    enabled: true\nvariables: {}\n',
    );
    const nativeRoot = path.join(repositoryPath, 'ide', 'codex', 'native');
    fs.mkdirSync(nativeRoot, { recursive: true });
    fs.writeFileSync(path.join(nativeRoot, 'config.toml'), 'model = "gpt-5"\n');
    fs.mkdirSync(path.join(repositoryPath, 'common'), { recursive: true });
    fs.writeFileSync(path.join(repositoryPath, 'common', 'AGENTS.md'), '# Rules\n');
    fs.writeFileSync(
      path.join(repositoryPath, 'common', 'mcp.yaml'),
      'servers:\n  shared:\n    command: shared-server\n',
    );
    const configPath = path.join(homeDir, '.codex', 'config.toml');
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(
      configPath,
      'personality = "pragmatic"\n[mcp_servers.stale]\ncommand = "old-server"\n',
    );

    await createProgram(
      deviceContext(),
      {},
      { confirmDeploy: async () => true },
    ).parseAsync(['node', 'mcv', 'deploy']);

    const { parse } = await import('smol-toml');
    expect(parse(fs.readFileSync(configPath, 'utf8'))).toEqual({
      personality: 'pragmatic',
      model: 'gpt-5',
      mcp_servers: { shared: { command: 'shared-server' } },
    });
    expect(fs.readFileSync(path.join(homeDir, '.codex', 'AGENTS.md'), 'utf8')).toBe('# Rules\n');
  });
});
