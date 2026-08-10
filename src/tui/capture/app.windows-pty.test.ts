import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import * as pty from 'node-pty';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { writeProfilesDocument } from '../../profiles/store.js';

const cliPath = path.join(process.cwd(), 'dist', 'index.js');

describe.skipIf(process.platform !== 'win32')('packaged Capture TUI in Windows ConPTY', () => {
  let testRoot: string;
  let wrapperPath: string;
  let modeProbeRoot: string;
  let modeProbePath: string;

  beforeAll(() => {
    modeProbeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mcv-capture-console-mode-'));
    modeProbePath = path.join(modeProbeRoot, 'McvCaptureConsoleMode.dll');
    const source = [
      'using System;',
      'using System.Runtime.InteropServices;',
      'namespace McvCaptureTest {',
      '  public static class ConsoleMode {',
      '    [DllImport("kernel32.dll", SetLastError = true)]',
      '    public static extern IntPtr GetStdHandle(int nStdHandle);',
      '    [DllImport("kernel32.dll", SetLastError = true)]',
      '    public static extern bool GetConsoleMode(IntPtr hConsoleHandle, out uint lpMode);',
      '  }',
      '}',
    ].join('\n');
    const compile = spawnSync('powershell.exe', [
      '-NoLogo', '-NoProfile', '-Command',
      `Add-Type -TypeDefinition ${quotePowerShell(source)} -OutputAssembly ${quotePowerShell(modeProbePath)}`,
    ], { encoding: 'utf8', timeout: 30_000 });
    if (compile.status !== 0) {
      throw new Error(`Could not compile the Windows console mode probe: ${compile.stderr}`);
    }
  }, 45_000);

  afterAll(() => {
    fs.rmSync(modeProbeRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  beforeEach(() => {
    testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mcv-capture-conpty-'));
    wrapperPath = path.join(testRoot, 'invoke-capture.ps1');
    fs.writeFileSync(wrapperPath, [
      'param([string]$Node, [string]$Cli, [string]$ModeProbe, [string]$Repo)',
      'Add-Type -Path $ModeProbe',
      '$inputHandle = [McvCaptureTest.ConsoleMode]::GetStdHandle(-10)',
      '[uint32]$before = 0',
      'if (-not [McvCaptureTest.ConsoleMode]::GetConsoleMode($inputHandle, [ref]$before)) { throw "GetConsoleMode before TUI failed" }',
      'Set-Location $Repo',
      '& $Node $Cli capture --tui',
      '$code = $LASTEXITCODE',
      '[uint32]$after = 0',
      'if (-not [McvCaptureTest.ConsoleMode]::GetConsoleMode($inputHandle, [ref]$after)) { throw "GetConsoleMode after TUI failed" }',
      'if ($before -eq $after) { Write-Output "INPUT_MODE:restored" } else { Write-Output "INPUT_MODE:changed" }',
      'Write-Output "EXIT_CODE:$code"',
      'exit $code',
      '',
    ].join('\r\n'));
  });

  afterEach(() => {
    fs.rmSync(testRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  it('cancels without writing and restores ConPTY input mode', async () => {
    const repositoryPath = createFixture(testRoot, 'capture-conpty');
    writeBinding(testRoot, repositoryPath, 'capture-conpty');
    const outcome = await runConPty(repositoryPath, [
      { pattern: 'MCV Capture Review', input: 'q', delay: 100 },
    ]);

    expect(outcome.code).toBe(0);
    expectRestoredTerminal(outcome.output);
    expect(outcome.output).toContain('INPUT_MODE:restored');
    expect(outcome.output).toContain('Capture cancelled; repository was not changed.');
    expect(fs.existsSync(path.join(repositoryPath, 'common', 'AGENTS.md'))).toBe(true);
  }, 45_000);

  it('returns 130 on Ctrl+C and restores ConPTY input mode', async () => {
    const repositoryPath = createFixture(testRoot, 'capture-conpty-interrupt');
    writeBinding(testRoot, repositoryPath, 'capture-conpty-interrupt');
    const outcome = await runConPty(repositoryPath, [
      { pattern: 'MCV Capture Review', input: '\u0003', delay: 100 },
    ]);

    expect(outcome.code).toBe(130);
    expectRestoredTerminal(outcome.output);
    expect(outcome.output).toContain('INPUT_MODE:restored');
  }, 45_000);

  function runConPty(
    repositoryPath: string,
    steps: Array<{ pattern: string; input?: string; delay?: number }>,
  ): Promise<{ code: number; output: string }> {
    return new Promise((resolve, reject) => {
      const terminal = pty.spawn('powershell.exe', [
        '-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', wrapperPath,
        '-Node', process.execPath, '-Cli', cliPath, '-ModeProbe', modeProbePath,
        '-Repo', repositoryPath,
      ], {
        cols: 120,
        rows: 30,
        cwd: process.cwd(),
        env: {
          ...process.env,
          HOME: testRoot,
          USERPROFILE: testRoot,
          APPDATA: testRoot,
          LOCALAPPDATA: testRoot,
        },
      });
      let output = '';
      let nextStep = 0;
      let searchStart = 0;
      let timeoutError: Error | undefined;
      const timeout = setTimeout(() => {
        timeoutError = new Error(`Timed out waiting for Capture TUI. Output: ${output}`);
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
        if (nextStep !== steps.length) {
          return reject(new Error(`Capture TUI exited before step ${nextStep + 1}/${steps.length}. Output: ${output}`));
        }
        resolve({ code: exitCode, output });
      });
    });
  }
});

function createFixture(root: string, repositoryId: string): string {
  const repositoryPath = path.join(root, 'repository');
  fs.mkdirSync(path.join(repositoryPath, 'common'), { recursive: true });
  fs.mkdirSync(path.join(root, '.codex'), { recursive: true });
  fs.writeFileSync(path.join(root, '.codex', 'config.toml'), 'invalid = [\n');
  fs.writeFileSync(path.join(repositoryPath, 'common', 'AGENTS.md'), '# keep until reviewed\n');
  fs.writeFileSync(path.join(repositoryPath, 'mcv.yaml'), [
    'schemaVersion: 4',
    `repositoryId: ${repositoryId}`,
    'initializedAt: 2026-08-10T00:00:00.000Z',
    'targets:',
    '  codex:',
    '    enabled: true',
    '  claudeCode:',
    '    enabled: false',
    '  gemini:',
    '    enabled: false',
    'variables: {}',
    'capture: { preserveUnknownNativeFields: true }',
    'deploy: { backupBeforeWrite: true, useSymlinks: false }',
    '',
  ].join('\n'));
  writeProfilesDocument(repositoryPath, {
    schemaVersion: 1,
    profiles: { global: { assets: [] } },
  });
  return repositoryPath;
}

function writeBinding(root: string, repositoryPath: string, repositoryId: string): void {
  const statePath = path.join(root, 'mcv', 'config.json');
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, `${JSON.stringify({
    schemaVersion: 3,
    repositoryPath,
    defaultRepositoryId: repositoryId,
  }, null, 2)}\n`);
}

function quotePowerShell(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function expectRestoredTerminal(output: string): void {
  expect(output).toContain('\u001b[?1049h');
  expect(output).toContain('\u001b[?1049l');
  expect(output).toContain('\u001b[?25h');
}
