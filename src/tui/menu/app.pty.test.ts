import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawn } from 'child_process';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const expectPath = '/usr/bin/expect';
const cliPath = path.join(process.cwd(), 'dist', 'index.js');

describe.skipIf(!fs.existsSync(expectPath))('packaged MCV task launcher in a real PTY', () => {
  let testRoot: string;

  beforeEach(() => {
    testRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mcv-menu-pty-')));
  });

  afterEach(() => {
    fs.rmSync(testRoot, { recursive: true, force: true });
  });

  it('opens the unbound task launcher, quits without writes, and restores the terminal', async () => {
    const before = directoryFiles(testRoot);
    const outcome = await runExpect([
      'set timeout 8',
      'log_user 1',
      'spawn /bin/zsh -f -c {trap : INT; stty rows 24 columns 80; cd "$MCV_TEST_ROOT"; TERM=xterm-256color LC_ALL=en_US.UTF-8 "$MCV_TEST_NODE" "$MCV_TEST_CLI"; code=$?; print -r -- EXIT_CODE:$code; exit $code}',
      expectExact('MCV · Mobile Configuration Vehicle', 'task launcher title'),
      expectExact('Create Repository', 'unbound primary action'),
      'send "q"',
      expectExact('EXIT_CODE:0', 'exit marker'),
      expectEof(),
      'exit 0',
    ]);

    expect(outcome.code, outcome.output).toBe(0);
    expectRestoredTerminal(outcome.output);
    expect(directoryFiles(testRoot)).toEqual(before);
  }, 20_000);

  it('returns 130 on Ctrl+C and restores the alternate screen', async () => {
    const outcome = await runExpect([
      'set timeout 8',
      'log_user 1',
      'spawn /bin/zsh -f -c {trap : INT; stty rows 24 columns 80; cd "$MCV_TEST_ROOT"; TERM=xterm-256color LC_ALL=en_US.UTF-8 "$MCV_TEST_NODE" "$MCV_TEST_CLI"; code=$?; print -r -- EXIT_CODE:$code; exit $code}',
      expectExact('MCV · Mobile Configuration Vehicle', 'task launcher title'),
      'send "\\003"',
      expectExact('EXIT_CODE:130', 'interrupt marker'),
      expectEof(),
      'exit 130',
    ]);

    expect(outcome.code, outcome.output).toBe(130);
    expectRestoredTerminal(outcome.output);
  }, 20_000);

  it('falls back to a one-shot Repository Report in a small terminal', async () => {
    const outcome = await runExpect([
      'set timeout 8',
      'log_user 1',
      'spawn /bin/zsh -f -c {stty rows 17 columns 59; cd "$MCV_TEST_ROOT"; TERM=xterm-256color LC_ALL=en_US.UTF-8 "$MCV_TEST_NODE" "$MCV_TEST_CLI"; code=$?; print -r -- EXIT_CODE:$code; exit $code}',
      expectExact('Repository Report', 'fallback report'),
      expectExact('EXIT_CODE:0', 'exit marker'),
      expectEof(),
      'exit 0',
    ]);

    expect(outcome.code, outcome.output).toBe(0);
    expect(outcome.output).not.toContain('\u001b[?1049h');
  }, 20_000);

  it('unloads the menu before showing the Init Plan and cancellation writes nothing', async () => {
    const before = directoryFiles(testRoot);
    const outcome = await runExpect([
      'set timeout 8',
      'log_user 1',
      'spawn /bin/zsh -f -c {trap : INT; stty rows 24 columns 80; cd "$MCV_TEST_ROOT"; TERM=xterm-256color LC_ALL=en_US.UTF-8 "$MCV_TEST_NODE" "$MCV_TEST_CLI"; code=$?; print -r -- EXIT_CODE:$code; exit $code}',
      expectExact('Create Repository', 'Create Repository action'),
      'send "\\r"',
      expectExact('Init Plan', 'Init Plan handoff'),
      expectExact('Apply? [y/N]', 'Init confirmation'),
      'send "n\\r"',
      expectExact('EXIT_CODE:0', 'exit marker'),
      expectEof(),
      'exit 0',
    ]);

    expect(outcome.code, outcome.output).toBe(0);
    expect(outcome.output.indexOf('\u001b[?1049l')).toBeLessThan(outcome.output.indexOf('Init Plan'));
    expect(directoryFiles(testRoot)).toEqual(before);
  }, 20_000);

  it('hands Inspect Detected IDEs to a one-shot report and exits', async () => {
    const outcome = await runExpect([
      'set timeout 8',
      'log_user 1',
      'spawn /bin/zsh -f -c {trap : INT; stty rows 24 columns 80; cd "$MCV_TEST_ROOT"; TERM=xterm-256color LC_ALL=en_US.UTF-8 "$MCV_TEST_NODE" "$MCV_TEST_CLI"; code=$?; print -r -- EXIT_CODE:$code; exit $code}',
      expectExact('Inspect Detected IDEs', 'Inspect action'),
      'send "\\033\\133B\\033\\133B\\r"',
      expectExact('Codex:', 'Environment report'),
      expectExact('EXIT_CODE:0', 'exit marker'),
      expectEof(),
      'exit 0',
    ]);

    expect(outcome.code, outcome.output).toBe(0);
    expectRestoredTerminal(outcome.output);
  }, 20_000);

  function runExpect(lines: string[]): Promise<{ code: number | null; output: string }> {
    return new Promise((resolve, reject) => {
      const child = spawn(expectPath, ['-c', lines.join('\n')], {
        env: {
          ...process.env,
          HOME: testRoot,
          USERPROFILE: testRoot,
          APPDATA: testRoot,
          CODEX_HOME: path.join(testRoot, '.codex'),
          CLAUDE_CONFIG_DIR: path.join(testRoot, '.claude'),
          MCV_TEST_ROOT: testRoot,
          MCV_TEST_NODE: process.execPath,
          MCV_TEST_CLI: cliPath,
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      let output = '';
      const timeout = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new Error(`Timed out waiting for task launcher. Output: ${output}`));
      }, 15_000);
      const collect = (chunk: Buffer): void => { output += chunk.toString('utf8'); };
      child.stdout.on('data', collect);
      child.stderr.on('data', collect);
      child.once('error', reject);
      child.once('exit', (code) => {
        clearTimeout(timeout);
        resolve({ code, output });
      });
    });
  }
});

function expectExact(pattern: string, label: string): string {
  return `expect {${escapeExpect(pattern)}} {} timeout {puts stderr "Missing ${label}"; exit 97}`;
}

function expectEof(): string {
  return 'expect eof';
}

function escapeExpect(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('{', '\\{').replaceAll('}', '\\}');
}

function expectRestoredTerminal(output: string): void {
  expect(output).toContain('\u001b[?1049h');
  expect(output).toContain('\u001b[?1049l');
  expect(output.lastIndexOf('\u001b[?1049l')).toBeGreaterThan(output.lastIndexOf('\u001b[?1049h'));
  expect(output).toContain('\u001b[?25h');
}

function directoryFiles(root: string): string[] {
  return fs.readdirSync(root, { recursive: true, encoding: 'utf8' }).sort();
}
