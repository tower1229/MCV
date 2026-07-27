import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as pty from 'node-pty';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const cliPath = path.join(process.cwd(), 'dist', 'index.js');

describe.skipIf(process.platform !== 'win32')('packaged TUI Shell in Windows ConPTY', () => {
  let testRoot: string;
  let wrapperPath: string;

  beforeEach(() => {
    testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mcv-tui-conpty-'));
    wrapperPath = path.join(testRoot, 'invoke-mcv.ps1');
    fs.writeFileSync(wrapperPath, [
      'param([string]$Node, [string]$Cli, [string]$Route)',
      '$signature = @"',
      '[DllImport("kernel32.dll", SetLastError = true)]',
      'public static extern IntPtr GetStdHandle(int nStdHandle);',
      '[DllImport("kernel32.dll", SetLastError = true)]',
      'public static extern bool GetConsoleMode(IntPtr hConsoleHandle, out uint lpMode);',
      '"@',
      'Add-Type -MemberDefinition $signature -Name ConsoleMode -Namespace McvTest',
      '$inputHandle = [McvTest.ConsoleMode]::GetStdHandle(-10)',
      '[uint32]$before = 0',
      '[void][McvTest.ConsoleMode]::GetConsoleMode($inputHandle, [ref]$before)',
      'if ($Route) { & $Node $Cli $Route } else { & $Node $Cli }',
      '$code = $LASTEXITCODE',
      '[uint32]$after = 0',
      '[void][McvTest.ConsoleMode]::GetConsoleMode($inputHandle, [ref]$after)',
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
      { pattern: 'Loading Overview...', input: 'q' },
    ]);

    expect(outcome.code).toBe(0);
    expectRestoredTerminal(outcome.output);
    expect(outcome.output).toContain('INPUT_MODE:restored');
    expect(outcome.output).not.toContain('INPUT_MODE:changed');
  }, 45_000);

  it('returns 130 on Ctrl+C and restores ConPTY input mode', async () => {
    const outcome = await runConPty('status', [{
      pattern: 'Overview',
      input: '\u0003',
      delay: 200,
    }]);

    expect(outcome.code).toBe(130);
    expectRestoredTerminal(outcome.output);
    expect(outcome.output).toContain('INPUT_MODE:restored');
    expect(outcome.output).not.toContain('INPUT_MODE:changed');
  }, 45_000);

  function runConPty(
    route: 'discover' | 'status',
    steps: Array<{ pattern: string; input: string; delay?: number }>,
  ): Promise<{ code: number; output: string }> {
    return new Promise((resolve, reject) => {
      const terminal = pty.spawn('powershell.exe', [
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
      ], {
        cols: 100,
        rows: 30,
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
        setTimeout(() => terminal.write(step.input), step.delay ?? 0);
      });
      terminal.onExit(({ exitCode }) => {
        clearTimeout(timeout);
        resolve({ code: exitCode, output });
      });
    });
  }
});

function expectRestoredTerminal(output: string): void {
  expect(output).toContain('\u001b[?1049h');
  expect(output).toContain('\u001b[?1049l');
  expect(output).toContain('\u001b[?25h');
}
