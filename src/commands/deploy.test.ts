import * as fs from 'fs';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProgram } from '../index';

describe('mcv deploy', () => {
  const originalCwd = process.cwd();
  const originalEnv = { ...process.env };
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
        'schemaVersion: 1',
        'targets:',
        '  claudeCode:',
        '    enabled: true',
        'variables:',
        '  TOOLS_HOME:',
        '    windows: "${HOME}\\\\Tools"',
        'deploy:',
        '  backupBeforeWrite: true',
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
    process.env.APPDATA = stateRoot;
    process.env.HOME = stateRoot;
    process.env.USERPROFILE = stateRoot;
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    process.chdir(originalCwd);
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
    fs.rmSync(testRoot, { recursive: true, force: true });
  });

  it('deploys repository configuration with portable paths resolved for this device', async () => {
    await createProgram(
      { homeDir, platform: 'win32' },
      {},
      { confirmDeploy: async () => true },
    ).parseAsync(['node', 'mcv', 'deploy']);

    expect(
      JSON.parse(
        fs.readFileSync(path.join(homeDir, '.claude', 'settings.json'), 'utf8'),
      ),
    ).toEqual({
      theme: 'dark',
      command: path.join(homeDir, 'Tools', 'tool.exe'),
    });
  });

  it('backs up modified native files and skips unchanged redeploys', async () => {
    const manifestPath = path.join(repositoryPath, 'mcv.yaml');
    fs.writeFileSync(
      manifestPath,
      fs.readFileSync(manifestPath, 'utf8').replace(
        'backupBeforeWrite: true',
        'backupBeforeWrite: false',
      ),
    );
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
      `${JSON.stringify({ customPreference: true }, null, 2)}\n`,
    );

    const runDeploy = () => createProgram(
      { homeDir, platform: 'win32' },
      {},
      { confirmDeploy: async () => true },
    ).parseAsync(['node', 'mcv', 'deploy']);

    await runDeploy();

    expect(JSON.parse(fs.readFileSync(settingsPath, 'utf8'))).toEqual({
      theme: 'dark',
      command: path.join(homeDir, 'Tools', 'tool.exe'),
    });
    expect(JSON.parse(fs.readFileSync(statePath, 'utf8'))).toEqual({
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

  it('resolves chained portable variables independent of declaration order', async () => {
    fs.writeFileSync(
      path.join(repositoryPath, 'mcv.yaml'),
      [
        'schemaVersion: 1',
        'targets:',
        '  claudeCode:',
        '    enabled: true',
        'variables:',
        '  TOOLS_HOME:',
        '    macos: "${PROJECTS_HOME}/工具"',
        '  PROJECTS_HOME:',
        '    macos: "/Volumes/工作 盘/Code"',
        '',
      ].join('\n'),
    );
    fs.writeFileSync(
      path.join(repositoryPath, 'ide', 'claude-code', 'native', 'settings.json'),
      `${JSON.stringify({ command: '${TOOLS_HOME}\\bin\\tool' }, null, 2)}\n`,
    );

    await createProgram(
      { homeDir, platform: 'darwin' },
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
        homeDir,
        platform: 'win32',
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
      { homeDir, platform: 'win32' },
      {},
      { confirmDeploy: async () => true },
    ).parseAsync(['node', 'mcv', 'deploy']);

    expect(
      JSON.parse(
        fs.readFileSync(path.join(homeDir, '.claude', 'settings.json'), 'utf8'),
      ),
    ).toEqual({
      command: `${path.join(homeDir, 'Tools', 'tool')} --url https://host.example/api`,
    });
  });
});
