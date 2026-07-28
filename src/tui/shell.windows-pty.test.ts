import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import * as pty from 'node-pty';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';

const cliPath = path.join(process.cwd(), 'dist', 'index.js');

describe.skipIf(process.platform !== 'win32')('packaged TUI Shell in Windows ConPTY', () => {
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
    fs.rmSync(modeProbeRoot, { recursive: true, force: true });
  });

  beforeEach(() => {
    testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mcv-tui-conpty-'));
    wrapperPath = path.join(testRoot, 'invoke-mcv.ps1');
    fs.writeFileSync(wrapperPath, [
      'param([string]$Node, [string]$Cli, [string]$Route, [string]$ModeProbe)',
      'Add-Type -Path $ModeProbe',
      '$inputHandle = [McvTest.ConsoleMode]::GetStdHandle(-10)',
      '[uint32]$before = 0',
      'if (-not [McvTest.ConsoleMode]::GetConsoleMode($inputHandle, [ref]$before)) { throw "GetConsoleMode before TUI failed" }',
      'if ($Route) { & $Node $Cli $Route } else { & $Node $Cli }',
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
    fs.rmSync(testRoot, { recursive: true, force: true });
  });

  it('deep-links discover, handles Escape and q, and restores ConPTY', async () => {
    const outcome = await runConPty('discover', [
      { pattern: 'Gemini:', input: '\u001b' },
      { pattern: '● Loading: Overview...', input: 'q' },
    ]);

    expect(outcome.code).toBe(0);
    expectRestoredTerminal(outcome.output);
    expect(outcome.output).toContain('INPUT_MODE:restored');
    expect(outcome.output).not.toContain('INPUT_MODE:changed');
  }, 45_000);

  it('returns 130 on Ctrl+C and restores ConPTY input mode', async () => {
    const outcome = await runConPty('status', [{
      pattern: 'Repository',
      input: '\u0003',
      delay: 200,
    }]);

    expect(outcome.code).toBe(130);
    expectRestoredTerminal(outcome.output);
    expect(outcome.output).toContain('INPUT_MODE:restored');
    expect(outcome.output).not.toContain('INPUT_MODE:changed');
  }, 45_000);

  it('pages through the packaged Deploy tree inside a bounded viewport', async () => {
    createDeployTreeRepository(testRoot);
    const outcome = await runConPty('deploy', [
      { pattern: 'Codex / Skills', input: '\u001b[C' },
      { pattern: 'hatch-pet · 20 files', input: '\u001b[C' },
      { pattern: '> [x] ▶ hatch-pet', input: '\u001b[C' },
      { pattern: '> [x] ▼ hatch-pet', input: '\u001b[B' },
      { pattern: 'file-0.md', input: '\u001b[6~' },
      { pattern: 'file-4.md', resize: { cols: 60, rows: 10 } },
      { pattern: '↑↓/Pg Move', input: 'q' },
    ]);

    expect(outcome.code).toBe(0);
    expect(outcome.output).toContain('… 6 earlier');
    expect(outcome.output).toContain('Deploy closed without applying changes.');
    expectRestoredTerminal(outcome.output);
    expect(outcome.output).toContain('INPUT_MODE:restored');
  }, 45_000);

  function runConPty(
    route: 'discover' | 'status' | 'deploy',
    steps: Array<{
      pattern: string;
      input?: string;
      delay?: number;
      resize?: { cols: number; rows: number };
    }>,
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
        '-Route',
        route,
        '-ModeProbe',
        modeProbePath,
      ];
      const terminal = pty.spawn('powershell.exe', arguments_, {
        cols: 100,
        rows: route === 'deploy' ? 16 : 30,
        cwd: process.cwd(),
        env: {
          ...process.env,
          HOME: testRoot,
          USERPROFILE: testRoot,
          APPDATA: testRoot,
        },
      });
      let output = '';
      let nextStep = 0;
      const timeout = setTimeout(() => {
        terminal.kill();
        reject(new Error(`Timed out waiting for Windows TUI. Output: ${output}`));
      }, 30_000);

      terminal.onData((data) => {
        output += data;
        const step = steps[nextStep];
        if (!step || !output.includes(step.pattern)) return;
        nextStep += 1;
        setTimeout(() => {
          if (step.resize) {
            terminal.resize(step.resize.cols, step.resize.rows);
          }
          if (step.input) terminal.write(step.input);
        }, step.delay ?? 0);
      });
      terminal.onExit(({ exitCode }) => {
        clearTimeout(timeout);
        resolve({ code: exitCode, output });
      });
    });
  }
});

function quotePowerShell(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function createDeployTreeRepository(testRoot: string): void {
  const repositoryPath = path.join(testRoot, 'deploy-tree-repository');
  const skillPath = path.join(
    repositoryPath,
    'common',
    'skills',
    'hatch-pet',
  );
  fs.mkdirSync(skillPath, { recursive: true });
  fs.writeFileSync(path.join(repositoryPath, 'mcv.yaml'), [
    'schemaVersion: 2',
    'repositoryId: deploy-tree-conpty',
    'initializedAt: 2026-07-27T00:00:00.000Z',
    'security: { scanSecrets: true, allowPlaintextSecrets: false }',
    'capture: { preserveUnknownNativeFields: true }',
    'deploy: { backupBeforeWrite: true, useSymlinks: false }',
    'targets:',
    '  codex:',
    '    enabled: true',
    'variables: {}',
    '',
  ].join('\n'));
  fs.writeFileSync(path.join(skillPath, 'SKILL.md'), '# Hatch Pet\n');
  for (let index = 0; index < 19; index += 1) {
    fs.writeFileSync(
      path.join(skillPath, `file-${index}.md`),
      `# File ${index}\n`,
    );
  }
  const statePath = path.join(testRoot, 'mcv', 'config.json');
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, `${JSON.stringify({
    schemaVersion: 2,
    defaultRepositoryId: 'deploy-tree-conpty',
    repositoryPath,
  }, null, 2)}\n`);
}

function expectRestoredTerminal(output: string): void {
  expect(output).toContain('\u001b[?1049h');
  expect(output).toContain('\u001b[?1049l');
  expect(output).toContain('\u001b[?25h');
}
