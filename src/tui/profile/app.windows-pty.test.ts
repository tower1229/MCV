import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { pathToFileURL } from 'url';
import { spawnSync } from 'child_process';
import * as pty from 'node-pty';
import * as yaml from 'yaml';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';
import { writeProfilesDocument } from '../../profiles/store.js';

const cliPath = path.join(process.cwd(), 'dist', 'index.js');

describe.skipIf(process.platform !== 'win32')('packaged Profile TUI in Windows ConPTY', () => {
  let testRoot: string;
  let wrapperPath: string;
  let modeProbeRoot: string;
  let modeProbePath: string;

  beforeAll(() => {
    modeProbeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mcv-console-mode-'));
    modeProbePath = path.join(modeProbeRoot, 'McvConsoleMode.dll');
    const source = [
      'using System;',
      'using System.Runtime.InteropServices;',
      'namespace McvTest {',
      '  public static class ConsoleMode {',
      '    [DllImport("kernel32.dll", SetLastError = true)]',
      '    public static extern IntPtr GetStdHandle(int nStdHandle);',
      '    [DllImport("kernel32.dll", SetLastError = true)]',
      '    public static extern bool GetConsoleMode(IntPtr hConsoleHandle, out uint lpMode);',
      '  }',
      '}',
    ].join('\n');
    const compile = spawnSync('powershell.exe', [
      '-NoLogo',
      '-NoProfile',
      '-Command',
      `Add-Type -TypeDefinition ${quotePowerShell(source)} -OutputAssembly ${quotePowerShell(modeProbePath)}`,
    ], {
      encoding: 'utf8',
      timeout: 30_000,
    });
    if (compile.status !== 0) {
      throw new Error(
        `Could not compile the Windows console mode probe: ${compile.stderr}`,
      );
    }
  }, 45_000);

  afterAll(() => {
    fs.rmSync(modeProbeRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  beforeEach(() => {
    testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mcv-profile-conpty-'));
    wrapperPath = path.join(testRoot, 'invoke-mcv.ps1');
    fs.writeFileSync(wrapperPath, [
      'param([string]$Node, [string]$Cli, [string]$Args, [string]$ModeProbe, [string]$Repo)',
      'Add-Type -Path $ModeProbe',
      '$inputHandle = [McvTest.ConsoleMode]::GetStdHandle(-10)',
      '[uint32]$before = 0',
      'if (-not [McvTest.ConsoleMode]::GetConsoleMode($inputHandle, [ref]$before)) { throw "GetConsoleMode before TUI failed" }',
      'Set-Location $Repo',
      'if ($Args -eq "__render-failure") { & $Node (Join-Path $Repo "render-failure.mjs") } elseif ([string]::IsNullOrWhiteSpace($Args)) { & $Node $Cli profile } else { & $Node $Cli profile ($Args -split " ") }',
      '$code = $LASTEXITCODE',
      '[uint32]$after = 0',
      'if (-not [McvTest.ConsoleMode]::GetConsoleMode($inputHandle, [ref]$after)) { throw "GetConsoleMode after TUI failed" }',
      'if ($before -eq $after) { Write-Output "INPUT_MODE:restored" } else { Write-Output "INPUT_MODE:changed" }',
      'Write-Output "EXIT_CODE:$code"',
      'exit $code',
      '',
    ].join('\r\n'));
  });

  afterEach(() => {
    fs.rmSync(testRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  it('opens Profile maintenance, navigates through search, and restores ConPTY', async () => {
    const repositoryPath = createRepository(testRoot, 'profile-conpty');
    writeBinding(repositoryPath, 'profile-conpty');
    const outcome = await runConPty('', [
      { pattern: 'Status: ready · profile global', input: '/' },
      { pattern: 'Search:', input: '调', delay: 50 },
      { pattern: 'Search: 调', input: '\u001b' },
      { pattern: 'Status: ready · profile global', input: ' ', delay: 50 },
      { pattern: 'Status: dirty', input: '\u001b' },
    ], { repositoryPath });

    expect(outcome.code).toBe(0);
    expect(outcome.output).toContain('\u001b[?1049l');
    expect(outcome.output).toContain('\u001b[?25h');
    expect(outcome.output).toContain('INPUT_MODE:restored');
    expect(outcome.output).toContain('Profile edits discarded.');
    expect(outcome.output).toMatch(/\u001b\[[0-9;]*m/u);
  }, 45_000);

  it('keeps Profile semantics visible without SGR under NO_COLOR and restores ConPTY', async () => {
    const repositoryPath = createRepository(testRoot, 'profile-conpty-no-color');
    writeBinding(repositoryPath, 'profile-conpty-no-color');
    const outcome = await runConPty('edit global', [
      { pattern: 'MCV Profile Editor', input: '\u001b', delay: 100 },
    ], { repositoryPath, environment: { NO_COLOR: '1' } });

    expect(outcome.code).toBe(0);
    expectRestoredTerminal(outcome.output);
    expect(outcome.output).not.toMatch(/\u001b\[[0-9;]*m/u);
    expect(outcome.output).toContain('Status: ready');
  }, 45_000);

  it('returns 130 on Ctrl+C and restores ConPTY input mode', async () => {
    const repositoryPath = createRepository(testRoot, 'profile-conpty-interrupt');
    writeBinding(repositoryPath, 'profile-conpty-interrupt');
    const outcome = await runConPty('edit global', [
      { pattern: 'MCV Profile Editor', input: '\u0003', delay: 200 },
    ], { repositoryPath });

    expect(outcome.code).toBe(130);
    expectRestoredTerminal(outcome.output);
    expect(outcome.output).toContain('INPUT_MODE:restored');
  }, 45_000);

  it('restores ConPTY input mode, cursor, and alternate screen after an Ink render failure', async () => {
    const repositoryPath = createRepository(testRoot, 'profile-conpty-render-failure');
    fs.writeFileSync(path.join(repositoryPath, 'render-failure.mjs'), [
      'const { runProfileEditor } = await import(process.env.MCV_PROFILE_APP_URL);',
      'try {',
      '  await runProfileEditor({ homeDir: process.env.USERPROFILE, platform: "win32", env: process.env }, {}, {}, { render: () => { throw new Error("forced render failure"); } });',
      '} catch (error) {',
      '  console.log(`RENDER_FAILURE:handled:${error.message}`);',
      '}',
      '',
    ].join('\n'));
    const outcome = await runConPty('__render-failure', [
      { pattern: 'RENDER_FAILURE:handled:forced render failure' },
    ], { repositoryPath });

    expect(outcome.code).toBe(0);
    expect(outcome.output).toContain('\u001b[?1049l');
    expect(outcome.output).toContain('\u001b[?25h');
    expect(outcome.output).toContain('INPUT_MODE:restored');
  }, 45_000);

  function runConPty(
    args: string,
    steps: Array<{ pattern: string; input?: string; delay?: number }>,
    options: { repositoryPath: string; environment?: NodeJS.ProcessEnv },
  ): Promise<{ code: number; output: string }> {
    return new Promise((resolve, reject) => {
      const arguments_ = [
        '-NoLogo',
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        wrapperPath,
        '-Node',
        process.execPath,
        '-Cli',
        cliPath,
        '-Args',
        args,
        '-ModeProbe',
        modeProbePath,
        '-Repo',
        options.repositoryPath,
      ];
      const { NO_COLOR: _noColor, ...baseEnvironment } = process.env;
      const terminal = pty.spawn('powershell.exe', arguments_, {
        cols: 120,
        rows: 30,
        cwd: process.cwd(),
        env: {
          ...baseEnvironment,
          FORCE_COLOR: '1',
          HOME: testRoot,
          USERPROFILE: testRoot,
          APPDATA: testRoot,
          MCV_PROFILE_APP_URL: pathToFileURL(path.join(process.cwd(), 'dist', 'tui', 'profile', 'app.js')).href,
          ...options.environment,
        },
      });
      let output = '';
      let nextStep = 0;
      let searchStart = 0;
      let timeoutError: Error | undefined;
      const timeout = setTimeout(() => {
        timeoutError = new Error(`Timed out waiting for Profile TUI. Output: ${output}`);
        terminal.kill();
      }, 30_000);

      terminal.onData((data) => {
        output += data;
        const step = steps[nextStep];
        if (!step || !output.slice(searchStart).includes(step.pattern)) return;
        nextStep += 1;
        searchStart = output.length;
        setTimeout(() => {
          if (step.input) terminal.write(step.input);
        }, step.delay ?? 0);
      });
      terminal.onExit(({ exitCode }) => {
        clearTimeout(timeout);
        if (timeoutError) {
          reject(timeoutError);
          return;
        }
        if (nextStep !== steps.length) {
          reject(new Error(
            `Profile TUI exited before step ${nextStep + 1}/${steps.length}. Output: ${output}`,
          ));
          return;
        }
        resolve({ code: exitCode, output });
      });
    });
  }

  function writeBinding(repositoryPath: string, repositoryId: string): void {
    const statePath = path.join(testRoot, 'mcv', 'config.json');
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    fs.writeFileSync(statePath, `${JSON.stringify({
      schemaVersion: 4,
      repositoryPath,
      defaultRepositoryId: repositoryId,
    }, null, 2)}\n`);
  }
});

function quotePowerShell(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function expectRestoredTerminal(output: string): void {
  expect(output).toContain('\u001b[?1049h');
  expect(output).toContain('\u001b[?1049l');
  expect(output).toContain('\u001b[?25h');
}

function createRepository(testRoot: string, repositoryId: string): string {
  const repositoryPath = path.join(testRoot, 'repository');
  fs.mkdirSync(path.join(repositoryPath, 'common', 'skills', 'debug'), { recursive: true });
  fs.writeFileSync(path.join(repositoryPath, 'mcv.yaml'), [
    'schemaVersion: 5',
    `repositoryId: ${repositoryId}`,
    'initializedAt: 2026-07-19T00:00:00.000Z',
    'targets:',
    '  codex:',
    '    enabled: true',
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
    '---\nname: debug\ndescription: 调试助手\n---\n',
  );
  fs.writeFileSync(
    path.join(repositoryPath, 'common', 'mcp.yaml'),
    yaml.stringify({ servers: { context7: { command: 'npx', transport: 'stdio' } } }),
  );
  writeProfilesDocument(repositoryPath, {
    schemaVersion: 1,
    profiles: {
      global: { title: 'Global', assets: ['instruction:codex'] },
      dev: { title: 'Dev', assets: ['skill:debug'] },
    },
  });
  return repositoryPath;
}
