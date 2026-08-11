import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { pathToFileURL } from 'url';
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
      'if ($env:MCV_CAPTURE_RENDER_FAILURE -eq "1") { & $Node (Join-Path $Repo "render-failure.mjs") } else { & $Node $Cli capture --tui }',
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
    expect(outcome.output).toContain('\u001b[?1049l');
    expect(outcome.output).toContain('\u001b[?25h');
    expect(outcome.output).toContain('INPUT_MODE:restored');
    expect(outcome.output).toContain('Capture cancelled; repository was not changed.');
    expect(fs.existsSync(path.join(repositoryPath, 'common', 'AGENTS.md'))).toBe(true);
  }, 45_000);

  it('keeps Capture semantics visible without SGR under NO_COLOR and restores ConPTY', async () => {
    const repositoryPath = createFixture(testRoot, 'capture-conpty-no-color');
    writeBinding(testRoot, repositoryPath, 'capture-conpty-no-color');
    const outcome = await runConPty(repositoryPath, [
      { pattern: 'MCV Capture Review', input: 'q', delay: 100 },
    ], { NO_COLOR: '1' });

    expect(outcome.code).toBe(0);
    expectRestoredTerminal(outcome.output);
    expect(outcome.output).not.toMatch(/\u001b\[[0-9;]*m/u);
    expect(outcome.output).toContain('× Destructive');
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

  it('completes a reviewed Capture and restores ConPTY input mode', async () => {
    const repositoryPath = createFixture(testRoot, 'capture-conpty-complete');
    writeBinding(testRoot, repositoryPath, 'capture-conpty-complete');
    const outcome = await runConPty(repositoryPath, [
      { pattern: 'MCV Capture Review', input: ' ', delay: 100 },
      { pattern: '[x] × Destructive', input: 'n', delay: 100 },
      { pattern: 'Warnings · explicit confirmation required', input: ' ', delay: 100 },
      { pattern: '[x] A source item was skipped', input: '\r', delay: 100 },
      { pattern: 'Final confirmation', input: '\r', delay: 100 },
      { pattern: 'Succeeded: captured', input: '\r', delay: 100 },
    ]);

    expect(outcome.code).toBe(0);
    expectRestoredTerminal(outcome.output);
    expect(outcome.output).toContain('INPUT_MODE:restored');
    expect(outcome.output).toMatch(/[✓!×?]/u);
    expect(outcome.output).toMatch(/\u001b\[[0-9;]*m/u);
  }, 45_000);

  it('restores ConPTY input mode, cursor, and alternate screen after a Capture render failure', async () => {
    const repositoryPath = createFixture(testRoot, 'capture-conpty-render-failure');
    fs.writeFileSync(path.join(repositoryPath, 'render-failure.mjs'), [
      'const { runCaptureReviewTui } = await import(process.env.MCV_CAPTURE_APP_URL);',
      'const plan = { schemaVersion: 3, operation: "capture", status: "planned", readyToApply: true, operationId: "failure", preconditions: {}, repositoryPath: process.cwd(), changes: [], issues: [], nextActions: [], summary: { parameterizedPathCount: 0, excludedFileCount: 0 } };',
      'try {',
      '  await runCaptureReviewTui({ homeDir: process.env.USERPROFILE, platform: "win32", env: process.env }, plan, {}, { render: () => { throw new Error("forced render failure"); } });',
      '} catch (error) {',
      '  console.log(`RENDER_FAILURE:handled:${error.message}`);',
      '}',
      '',
    ].join('\n'));
    const outcome = await runConPty(repositoryPath, [
      { pattern: 'RENDER_FAILURE:handled:forced render failure' },
    ], { MCV_CAPTURE_RENDER_FAILURE: '1' });

    expect(outcome.code).toBe(0);
    expect(outcome.output).toContain('\u001b[?1049l');
    expect(outcome.output).toContain('\u001b[?25h');
    expect(outcome.output).toContain('INPUT_MODE:restored');
  }, 45_000);

  function runConPty(
    repositoryPath: string,
    steps: Array<{ pattern: string; input?: string; delay?: number }>,
    environment: NodeJS.ProcessEnv = {},
  ): Promise<{ code: number; output: string }> {
    return new Promise((resolve, reject) => {
      const { NO_COLOR: _noColor, ...baseEnvironment } = process.env;
      const terminal = pty.spawn('powershell.exe', [
        '-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', wrapperPath,
        '-Node', process.execPath, '-Cli', cliPath, '-ModeProbe', modeProbePath,
        '-Repo', repositoryPath,
      ], {
        cols: 120,
        rows: 30,
        cwd: process.cwd(),
        env: {
          ...baseEnvironment,
          FORCE_COLOR: '1',
          HOME: testRoot,
          USERPROFILE: testRoot,
          APPDATA: testRoot,
          LOCALAPPDATA: testRoot,
          MCV_CAPTURE_APP_URL: pathToFileURL(path.join(process.cwd(), 'dist', 'tui', 'capture', 'app.js')).href,
          ...environment,
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
