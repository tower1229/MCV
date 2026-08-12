import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawn } from 'child_process';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { writeProfilesDocument } from '../../profiles/store.js';

const expectPath = '/usr/bin/expect';
const cliPath = path.join(process.cwd(), 'dist', 'index.js');

describe.skipIf(!fs.existsSync(expectPath))('packaged Capture TUI in a real PTY', () => {
  let testRoot: string;

  beforeEach(() => {
    testRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mcv-capture-pty-')));
  });

  afterEach(() => {
    fs.rmSync(testRoot, { recursive: true, force: true });
  });

  it('automatically opens for two review items and restores the terminal on cancel', async () => {
    const repositoryPath = createComplexCaptureFixture(testRoot, 'capture-pty');
    writeBinding(testRoot, repositoryPath, 'capture-pty');
    const outcome = await runExpect(testRoot, repositoryPath, [
      'set timeout 10',
      'log_user 1',
      'spawn /bin/zsh -f -c {trap : INT; stty rows 24 columns 100; cd "$MCV_TEST_REPO"; NO_COLOR=1 TERM=xterm-256color "$MCV_TEST_NODE" "$MCV_TEST_CLI" capture; code=$?; print -r -- EXIT_CODE:$code; exit $code}',
      expectExact('MCV Capture Review', 'Capture title'),
      expectExact('2 review items', 'review item count'),
      expectExact('× Destructive', 'destructive marker without color'),
      'send "q"',
      expectExact('Capture cancelled; repository was not changed.', 'cancel summary'),
      expectExact('EXIT_CODE:0', 'exit marker'),
      expectEof(),
      'exit 0',
    ]);

    expect(outcome.code, outcome.output).toBe(0);
    expectRestoredTerminal(outcome.output);
    expect(fs.existsSync(path.join(repositoryPath, 'ide', 'codex', 'instructions.md'))).toBe(true);
  }, 25_000);

  it('returns 130 on Ctrl+C and restores the alternate screen', async () => {
    const repositoryPath = createComplexCaptureFixture(testRoot, 'capture-interrupt');
    writeBinding(testRoot, repositoryPath, 'capture-interrupt');
    const outcome = await runExpect(testRoot, repositoryPath, [
      'set timeout 10',
      'log_user 1',
      'spawn /bin/zsh -f -c {trap : INT; stty rows 24 columns 100; cd "$MCV_TEST_REPO"; TERM=xterm-256color "$MCV_TEST_NODE" "$MCV_TEST_CLI" capture --tui; code=$?; print -r -- EXIT_CODE:$code; exit $code}',
      expectExact('MCV Capture Review', 'Capture title'),
      'send "\\003"',
      expectExact('EXIT_CODE:130', 'interrupt exit marker'),
      expectEof(),
      'exit 130',
    ]);

    expect(outcome.code, outcome.output).toBe(130);
    expectRestoredTerminal(outcome.output);
  }, 25_000);

  it('reviews warnings and deletion selection before applying through packaged CLI', async () => {
    const repositoryPath = createComplexCaptureFixture(testRoot, 'capture-apply');
    writeBinding(testRoot, repositoryPath, 'capture-apply');
    const outcome = await runExpect(testRoot, repositoryPath, [
      'set timeout 12',
      'log_user 1',
      'spawn /bin/zsh -f -c {trap : INT; stty rows 24 columns 100; cd "$MCV_TEST_REPO"; unset NO_COLOR; FORCE_COLOR=1 TERM=xterm-256color "$MCV_TEST_NODE" "$MCV_TEST_CLI" capture; code=$?; print -r -- EXIT_CODE:$code; exit $code}',
      expectExact('MCV Capture Review', 'Capture title'),
      expectExact('Ctrl+C Interrupt', 'Capture footer'),
      'after 1000',
      'send " "',
      expectExact('[x] × Destructive', 'selected deletion'),
      'send "n"',
      expectExact('Warnings · explicit confirmation required', 'warning review'),
      'send " "',
      expectExact('[x] A source item was skipped', 'confirmed warning'),
      'send "\\r"',
      expectExact('Final confirmation', 'final confirmation'),
      'send "\\r"',
      expectExact('Succeeded: captured 1 repository change(s).', 'success result'),
      'send "\\r"',
      expectExact('EXIT_CODE:0', 'exit marker'),
      expectEof(),
      'exit 0',
    ]);

    expect(outcome.code, outcome.output).toBe(0);
    expectRestoredTerminal(outcome.output);
    expect(outcome.output).toMatch(/\u001b\[[0-9;]*m/u);
    expect(outcome.output).toMatch(/[✓!×?]/u);
    expect(fs.existsSync(path.join(repositoryPath, 'ide', 'codex', 'instructions.md'))).toBe(false);
  }, 30_000);

  it('--no-tui keeps the same complex Plan out of alternate screen', async () => {
    const repositoryPath = createComplexCaptureFixture(testRoot, 'capture-plain');
    writeBinding(testRoot, repositoryPath, 'capture-plain');
    const outcome = await runExpect(testRoot, repositoryPath, [
      'set timeout 10',
      'log_user 1',
      'spawn /bin/zsh -f -c {trap : INT; stty rows 24 columns 100; cd "$MCV_TEST_REPO"; TERM=xterm-256color "$MCV_TEST_NODE" "$MCV_TEST_CLI" capture --no-tui; code=$?; print -r -- EXIT_CODE:$code; exit $code}',
      expectExact('? Include this deletion? [y/N]', 'deletion prompt'),
      'send "n\\r"',
      expectExact('? Acknowledge this warning and continue? [y/N]', 'warning prompt'),
      'send "n\\r"',
      expectExact('EXIT_CODE:0', 'exit marker'),
      expectEof(),
      'exit 0',
    ]);

    expect(outcome.code, outcome.output).toBe(0);
    expect(outcome.output).not.toContain('\u001b[?1049h');
  }, 25_000);

  function runExpect(
    homeDir: string,
    repositoryPath: string,
    lines: string[],
  ): Promise<{ code: number | null; output: string }> {
    return new Promise((resolve, reject) => {
      const child = spawn(expectPath, ['-c', lines.join('\n')], {
        env: {
          ...process.env,
          HOME: homeDir,
          USERPROFILE: homeDir,
          APPDATA: homeDir,
          MCV_TEST_REPO: repositoryPath,
          MCV_TEST_NODE: process.execPath,
          MCV_TEST_CLI: cliPath,
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      let output = '';
      const timeout = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new Error(`Timed out waiting for Capture TUI. Output: ${output}`));
      }, 20_000);
      const collect = (chunk: Buffer): void => { output += chunk.toString('utf8'); };
      child.stdout.on('data', collect);
      child.stderr.on('data', collect);
      child.once('error', (error) => { clearTimeout(timeout); reject(error); });
      child.once('exit', (code) => { clearTimeout(timeout); resolve({ code, output }); });
    });
  }
});

function createComplexCaptureFixture(root: string, repositoryId: string): string {
  const repositoryPath = path.join(root, 'repository');
  fs.mkdirSync(path.join(repositoryPath, 'ide', 'codex'), { recursive: true });
  fs.mkdirSync(path.join(root, '.codex'), { recursive: true });
  fs.writeFileSync(path.join(root, '.codex', 'config.toml'), 'invalid = [\n');
  fs.writeFileSync(
    path.join(repositoryPath, 'ide', 'codex', 'instructions.md'),
    '# keep until reviewed\n',
  );
  fs.writeFileSync(path.join(repositoryPath, 'mcv.yaml'), [
    'schemaVersion: 5',
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
    'capture:',
    '  preserveUnknownNativeFields: true',
    'deploy:',
    '  backupBeforeWrite: true',
    '  useSymlinks: false',
    '',
  ].join('\n'));
  writeProfilesDocument(repositoryPath, {
    schemaVersion: 1,
    profiles: { global: { assets: [] } },
  });
  return repositoryPath;
}

function writeBinding(root: string, repositoryPath: string, repositoryId: string): void {
  const statePath = process.platform === 'darwin'
    ? path.join(root, 'Library', 'Application Support', 'mcv', 'config.json')
    : path.join(root, '.config', 'mcv', 'config.json');
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, `${JSON.stringify({
    schemaVersion: 3,
    repositoryPath,
    defaultRepositoryId: repositoryId,
  }, null, 2)}\n`);
}

function expectExact(marker: string, label: string): string {
  return [
    'expect {',
    `  -exact {${marker}} {}`,
    `  timeout { puts stderr {Missing ${label}}; exit 124 }`,
    `  eof { puts stderr {EOF before ${label}}; exit 125 }`,
    '}',
  ].join('\n');
}

function expectEof(): string {
  return [
    'expect {',
    '  eof {}',
    '  timeout { puts stderr {Timed out waiting for EOF}; exit 124 }',
    '}',
  ].join('\n');
}

function expectRestoredTerminal(output: string): void {
  expect(output).toContain('\u001b[?1049h');
  expect(output).toContain('\u001b[?1049l');
  expect(output).toContain('\u001b[?25l');
  expect(output).toContain('\u001b[?25h');
}
