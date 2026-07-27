import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawn } from 'child_process';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const expectPath = '/usr/bin/expect';
const cliPath = path.join(process.cwd(), 'dist', 'index.js');

describe.skipIf(!fs.existsSync(expectPath))('packaged TUI Shell in a real PTY', () => {
  let testRoot: string;

  beforeEach(() => {
    testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mcv-tui-pty-'));
  });

  afterEach(() => {
    fs.rmSync(testRoot, { recursive: true, force: true });
  });

  it('opens Overview in the alternate screen and restores cursor and input mode', async () => {
    const outcome = await runExpect([
      'set timeout 5',
      'log_user 1',
      'spawn /bin/zsh -f -c {stty rows 24 columns 80; before=$(stty -g); "$MCV_TEST_NODE" "$MCV_TEST_CLI"; code=$?; after=$(stty -g); if [[ "$before" == "$after" ]]; then mode=restored; else mode=changed; fi; print -r -- INPUT_MODE:$mode; print -r -- EXIT_CODE:$code; exit $code}',
      'expect -exact {Overview}',
      'after 200',
      'send "\\r"',
      'expect -exact {Loading Environment Details...}',
      'send "q"',
      'expect -exact {INPUT_MODE:restored}',
      'expect -exact {EXIT_CODE:0}',
      'expect eof',
      'set result [wait]',
      'exit [lindex $result 3]',
    ]);

    expect(outcome.code).toBe(0);
    expectRestoredTerminal(outcome.output);
  });

  it('deep-links discover, navigates back to Overview, and exits cleanly', async () => {
    const outcome = await runExpect([
      'set timeout 5',
      'log_user 1',
      'spawn /bin/zsh -f -c {stty rows 24 columns 80; before=$(stty -g); "$MCV_TEST_NODE" "$MCV_TEST_CLI" discover; code=$?; after=$(stty -g); if [[ "$before" == "$after" ]]; then mode=restored; else mode=changed; fi; print -r -- INPUT_MODE:$mode; print -r -- EXIT_CODE:$code; exit $code}',
      'expect -exact {Environment Details}',
      'expect -exact {Gemini:}',
      'send "\\033"',
      'after 200',
      'expect -exact {Loading Overview...}',
      'send "q"',
      'expect -exact {IDEs detected; 0 missing variables.}',
      'expect -exact {INPUT_MODE:restored}',
      'expect -exact {EXIT_CODE:0}',
      'expect eof',
      'set result [wait]',
      'exit [lindex $result 3]',
    ]);

    expect(outcome.code).toBe(0);
    expectRestoredTerminal(outcome.output);
  }, 10_000);

  it('returns 130 on Ctrl+C before any Apply and restores the terminal', async () => {
    const outcome = await runExpect([
      'set timeout 5',
      'log_user 1',
      'spawn /bin/zsh -f -c {stty rows 24 columns 80; before=$(stty -g); "$MCV_TEST_NODE" "$MCV_TEST_CLI" status; code=$?; after=$(stty -g); if [[ "$before" == "$after" ]]; then mode=restored; else mode=changed; fi; print -r -- INPUT_MODE:$mode; print -r -- EXIT_CODE:$code; exit $code}',
      'expect -exact {Overview}',
      'after 200',
      'send "\\003"',
      'expect -exact {MCV interrupted.}',
      'expect -exact {INPUT_MODE:restored}',
      'expect -exact {EXIT_CODE:130}',
      'expect eof',
      'set result [wait]',
      'exit [lindex $result 3]',
    ]);

    expect(outcome.code).toBe(130);
    expectRestoredTerminal(outcome.output);
  });

  it('labels a direct-route failure with the page that actually failed', async () => {
    const outcome = await runExpect([
      'set timeout 5',
      'log_user 1',
      'spawn /bin/zsh -f -c {"$MCV_TEST_NODE" "$MCV_TEST_CLI" discover; code=$?; print -r -- EXIT_CODE:$code; exit $code}',
      'expect -exact {Gemini:}',
      'send "\\033"',
      'after 200',
      'expect -exact {Failed: No bound MCV repository found.}',
      'send "q"',
      'expect -exact {Overview failed: No bound MCV repository found.}',
      'expect -exact {EXIT_CODE:1}',
      'expect eof',
      'set result [wait]',
      'exit [lindex $result 3]',
    ]);

    expect(outcome.output).toContain('Overview failed:');
    expect(outcome.output).not.toContain('Environment Details failed:');
    expectRestoredTerminal(outcome.output);
  });

  it('restores the terminal after an uncaught Shell exception', async () => {
    const fixturePath = path.join(testRoot, 'crash-shell.mjs');
    const shellModuleUrl = new URL(
      `file://${path.join(process.cwd(), 'dist', 'tui', 'shell.js')}`,
    ).href;
    fs.writeFileSync(fixturePath, [
      `import { runTuiShell } from ${JSON.stringify(shellModuleUrl)};`,
      'await runTuiShell(',
      "  { homeDir: process.env.HOME, platform: process.platform, env: process.env },",
      "  'overview',",
      "  { inspectOverview: () => { throw new Error('simulated uncaught TUI failure'); } },",
      ');',
      '',
    ].join('\n'));

    const outcome = await runExpect([
      'set timeout 5',
      'log_user 1',
      'spawn /bin/zsh -f -c {stty rows 24 columns 80; before=$(stty -g); "$MCV_TEST_NODE" "$MCV_TEST_SCRIPT"; code=$?; after=$(stty -g); if [[ "$before" == "$after" ]]; then mode=restored; else mode=changed; fi; print -r -- INPUT_MODE:$mode; print -r -- EXIT_CODE:$code; exit $code}',
      'expect -exact {simulated uncaught TUI failure}',
      'expect -exact {INPUT_MODE:restored}',
      'expect -exact {EXIT_CODE:1}',
      'expect eof',
      'set result [wait]',
      'exit [lindex $result 3]',
    ], { MCV_TEST_SCRIPT: fixturePath });

    expect(outcome.code).toBe(1);
    expectRestoredTerminal(outcome.output);
  });

  it('restores the terminal when the initial render throws', async () => {
    const fixturePath = path.join(testRoot, 'crash-initial-render.mjs');
    const shellModuleUrl = new URL(
      `file://${path.join(process.cwd(), 'dist', 'tui', 'shell.js')}`,
    ).href;
    fs.writeFileSync(fixturePath, [
      `import { runTuiShell } from ${JSON.stringify(shellModuleUrl)};`,
      'await runTuiShell(',
      "  { homeDir: process.env.HOME, platform: process.platform, env: process.env },",
      "  'overview',",
      '  {},',
      '  { render: () => {',
      "    process.stdout.write('\\u001b[?1049h\\u001b[?25l');",
      '    process.stdin.setRawMode?.(true);',
      "    throw new Error('simulated initial render failure');",
      '  } },',
      ');',
      '',
    ].join('\n'));

    const outcome = await runExpect([
      'set timeout 5',
      'log_user 1',
      'spawn /bin/zsh -f -c {stty rows 24 columns 80; before=$(stty -g); "$MCV_TEST_NODE" "$MCV_TEST_SCRIPT"; code=$?; after=$(stty -g); if [[ "$before" == "$after" ]]; then mode=restored; else mode=changed; fi; print -r -- INPUT_MODE:$mode; print -r -- EXIT_CODE:$code; exit $code}',
      'expect -exact {simulated initial render failure}',
      'expect -exact {INPUT_MODE:restored}',
      'expect -exact {EXIT_CODE:1}',
      'expect eof',
      'set result [wait]',
      'exit [lindex $result 3]',
    ], { MCV_TEST_SCRIPT: fixturePath });

    expect(outcome.output).toContain('EXIT_CODE:1');
    expectRestoredTerminal(outcome.output);
  });

  it('keeps explicit plain and JSON routes out of the alternate screen', async () => {
    const outcome = await runExpect([
      'set timeout 5',
      'log_user 1',
      'spawn /bin/zsh -f -c {"$MCV_TEST_NODE" "$MCV_TEST_CLI" discover --plain; plain=$?; "$MCV_TEST_NODE" "$MCV_TEST_CLI" discover --json; json=$?; print -r -- ROUTE_CODES:$plain,$json; exit $((plain || json))}',
      'expect -exact {ROUTE_CODES:0,0}',
      'expect eof',
      'set result [wait]',
      'exit [lindex $result 3]',
    ]);

    expect(outcome.code).toBe(0);
    expect(outcome.output).toContain('Codex:');
    expect(outcome.output).toContain('"operation": "discover"');
    expect(outcome.output).not.toContain('\u001b[?1049h');
    expect(outcome.output).not.toContain('\u001b[?1049l');
  });

  function runExpect(
    lines: string[],
    extraEnvironment: NodeJS.ProcessEnv = {},
  ): Promise<{ code: number | null; output: string }> {
    return new Promise((resolve, reject) => {
      const child = spawn(expectPath, ['-c', lines.join('\n')], {
        env: {
          ...process.env,
          HOME: testRoot,
          USERPROFILE: testRoot,
          APPDATA: testRoot,
          MCV_TEST_NODE: process.execPath,
          MCV_TEST_CLI: cliPath,
          ...extraEnvironment,
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      let output = '';
      const timeout = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new Error(`Timed out waiting for TUI. Output: ${output}`));
      }, 7_000);
      const collect = (chunk: Buffer): void => {
        output += chunk.toString('utf8');
      };
      child.stdout.on('data', collect);
      child.stderr.on('data', collect);
      child.once('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      child.once('exit', (code) => {
        clearTimeout(timeout);
        resolve({ code, output });
      });
    });
  }
});

function expectRestoredTerminal(output: string): void {
  expect(output).toContain('\u001b[?1049h');
  expect(output).toContain('\u001b[?1049l');
  expect(output).toContain('\u001b[?25l');
  expect(output).toContain('\u001b[?25h');
}
