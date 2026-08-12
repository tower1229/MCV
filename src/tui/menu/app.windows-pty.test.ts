import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { pathToFileURL } from 'url';
import { spawnSync } from 'child_process';
import * as pty from 'node-pty';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const cliPath = path.join(process.cwd(), 'dist', 'index.js');

describe.skipIf(process.platform !== 'win32')('packaged MCV task launcher in Windows ConPTY', () => {
  let testRoot: string;
  let wrapperPath: string;
  let modeProbeRoot: string;
  let modeProbePath: string;

  beforeAll(() => {
    modeProbeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mcv-menu-console-mode-'));
    modeProbePath = path.join(modeProbeRoot, 'McvConsoleMode.dll');
    const source = [
      'using System;',
      'using System.Runtime.InteropServices;',
      'namespace McvMenuTest {',
      '  public static class ConsoleMode {',
      '    [DllImport("kernel32.dll", SetLastError = true)] public static extern IntPtr GetStdHandle(int nStdHandle);',
      '    [DllImport("kernel32.dll", SetLastError = true)] public static extern bool GetConsoleMode(IntPtr handle, out uint mode);',
      '  }',
      '}',
    ].join('\n');
    const compile = spawnSync('powershell.exe', [
      '-NoLogo', '-NoProfile', '-Command',
      `Add-Type -TypeDefinition ${quotePowerShell(source)} -OutputAssembly ${quotePowerShell(modeProbePath)}`,
    ], { encoding: 'utf8', timeout: 30_000 });
    if (compile.status !== 0) throw new Error(`Could not compile console mode probe: ${compile.stderr}`);
  }, 45_000);

  afterAll(() => {
    fs.rmSync(modeProbeRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  beforeEach(() => {
    testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mcv-menu-conpty-'));
    wrapperPath = path.join(testRoot, 'invoke-mcv.ps1');
    fs.writeFileSync(wrapperPath, [
      'param([string]$Node, [string]$Cli, [string]$ModeProbe, [string]$Root, [string]$Scenario)',
      'Add-Type -Path $ModeProbe',
      '$inputHandle = [McvMenuTest.ConsoleMode]::GetStdHandle(-10)',
      '[uint32]$before = 0',
      'if (-not [McvMenuTest.ConsoleMode]::GetConsoleMode($inputHandle, [ref]$before)) { throw "GetConsoleMode before failed" }',
      'Set-Location $Root',
      'if ($Scenario -eq "render-failure") { & $Node (Join-Path $Root "render-failure.mjs") } else { & $Node $Cli }',
      '$code = $LASTEXITCODE',
      '[uint32]$after = 0',
      'if (-not [McvMenuTest.ConsoleMode]::GetConsoleMode($inputHandle, [ref]$after)) { throw "GetConsoleMode after failed" }',
      'if ($before -eq $after) { Write-Output "INPUT_MODE:restored" } else { Write-Output "INPUT_MODE:changed" }',
      'Write-Output "EXIT_CODE:$code"',
      'exit $code',
      '',
    ].join('\r\n'));
  });

  afterEach(() => {
    fs.rmSync(testRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  it('quits without writes under NO_COLOR and restores ConPTY', async () => {
    const before = fs.readdirSync(testRoot, { recursive: true, encoding: 'utf8' }).sort();
    const outcome = await runConPty('', [
      { pattern: 'MCV · Mobile Configuration Vehicle', input: 'q' },
      { pattern: 'INPUT_MODE:restored' },
    ], { NO_COLOR: '1' });

    expect(outcome.code).toBe(0);
    expectRestoredTerminal(outcome.output);
    expect(outcome.output).not.toMatch(/\u001b\[[0-9;]*m/u);
    expect(fs.readdirSync(testRoot, { recursive: true, encoding: 'utf8' }).sort()).toEqual(before);
  }, 45_000);

  it('returns 130 on Ctrl+C and restores ConPTY input mode', async () => {
    const outcome = await runConPty('', [
      { pattern: 'MCV · Mobile Configuration Vehicle', input: '\u0003', delay: 100 },
      { pattern: 'INPUT_MODE:restored' },
    ]);

    expect(outcome.code).toBe(130);
    expectRestoredTerminal(outcome.output);
  }, 45_000);

  it('restores cursor and input mode after an Ink render failure', async () => {
    fs.writeFileSync(path.join(testRoot, 'render-failure.mjs'), [
      'const { runMainMenu } = await import(process.env.MCV_MENU_APP_URL);',
      'try {',
      '  await runMainMenu({ homeDir: process.env.USERPROFILE, platform: "win32", env: process.env }, process.cwd(), {}, { render: () => { throw new Error("forced render failure"); } });',
      '} catch (error) { console.log(`RENDER_FAILURE:handled:${error.message}`); }',
      '',
    ].join('\n'));
    const outcome = await runConPty('render-failure', [
      { pattern: 'RENDER_FAILURE:handled:forced render failure' },
      { pattern: 'INPUT_MODE:restored' },
    ]);

    expect(outcome.code).toBe(0);
    expect(outcome.output).toContain('\u001b[?1049l');
    expect(outcome.output).toContain('\u001b[?25h');
  }, 45_000);

  function runConPty(
    scenario: string,
    steps: Array<{ pattern: string; input?: string; delay?: number }>,
    environment: NodeJS.ProcessEnv = {},
  ): Promise<{ code: number; output: string }> {
    return new Promise((resolve, reject) => {
      const terminal = pty.spawn('powershell.exe', [
        '-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', wrapperPath,
        '-Node', process.execPath, '-Cli', cliPath, '-ModeProbe', modeProbePath,
        '-Root', testRoot, '-Scenario', scenario,
      ], {
        cols: 80,
        rows: 24,
        cwd: process.cwd(),
        env: {
          ...process.env,
          HOME: testRoot,
          USERPROFILE: testRoot,
          APPDATA: testRoot,
          TERM: 'xterm-256color',
          LC_ALL: 'en_US.UTF-8',
          MCV_MENU_APP_URL: pathToFileURL(path.join(process.cwd(), 'dist', 'tui', 'menu', 'app.js')).href,
          ...environment,
        },
      });
      let output = '';
      let nextStep = 0;
      let searchStart = 0;
      let timeoutError: Error | undefined;
      const timeout = setTimeout(() => {
        timeoutError = new Error(`Timed out waiting for task launcher. Output: ${output}`);
        terminal.kill();
      }, 30_000);
      terminal.onData((data) => {
        output += data;
        const step = steps[nextStep];
        if (!step || !output.slice(searchStart).includes(step.pattern)) return;
        nextStep += 1;
        searchStart = output.length;
        setTimeout(() => { if (step.input) terminal.write(step.input); }, step.delay ?? 0);
      });
      terminal.onExit(({ exitCode }) => {
        clearTimeout(timeout);
        if (timeoutError) return reject(timeoutError);
        if (nextStep !== steps.length) return reject(new Error(`ConPTY exited before step ${nextStep + 1}. Output: ${output}`));
        resolve({ code: exitCode, output });
      });
    });
  }
});

function quotePowerShell(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function expectRestoredTerminal(output: string): void {
  expect(output).toContain('\u001b[?1049h');
  expect(output).toContain('\u001b[?1049l');
  expect(output).toContain('\u001b[?25h');
  expect(output).toContain('INPUT_MODE:restored');
}
