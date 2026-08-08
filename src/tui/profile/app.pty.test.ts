import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawn } from 'child_process';
import * as yaml from 'yaml';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { writeProfilesDocument } from '../../profiles/store.js';

const expectPath = '/usr/bin/expect';
const cliPath = path.join(process.cwd(), 'dist', 'index.js');

describe.skipIf(!fs.existsSync(expectPath))('packaged Profile TUI in a real PTY', () => {
  let testRoot: string;

  beforeEach(() => {
    testRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mcv-profile-pty-')));
  });

  afterEach(() => {
    fs.rmSync(testRoot, { recursive: true, force: true });
  });

  it('opens the Profile editor, navigates panes, accepts CJK search input, and restores the terminal', async () => {
    const repositoryPath = createRepository(testRoot, 'profile-pty');
    writeBinding(repositoryPath, 'profile-pty');
    const outcome = await runExpect([
      'set timeout 8',
      'log_user 1',
      'spawn /bin/zsh -f -c {stty rows 30 columns 120; cd "$MCV_TEST_REPO"; TERM=xterm-256color "$MCV_TEST_NODE" "$MCV_TEST_CLI" profile; code=$?; print -r -- EXIT_CODE:$code; exit $code}',
      'expect -exact {MCV Profile Editor}',
      'expect -exact {Profiles}',
      'expect -exact {Assets}',
      'send "/"',
      'send "调"',
      'expect -exact {Search: 调}',
      'send "\\r"',
      'send "\\033\\[C"',
      'after 100',
      'send " "',
      'expect -exact {Status: dirty}',
      'send "\\033"',
      'expect -exact {Profile edits discarded.}',
      'expect -exact {EXIT_CODE:0}',
      'expect eof',
      'set result [wait]',
      'exit [lindex $result 3]',
    ], { MCV_TEST_REPO: repositoryPath });

    expect(outcome.code).toBe(0);
    expectRestoredTerminal(outcome.output);
  }, 20_000);

  it('returns 130 on Ctrl+C and restores the alternate screen', async () => {
    const repositoryPath = createRepository(testRoot, 'profile-interrupt');
    writeBinding(repositoryPath, 'profile-interrupt');
    const outcome = await runExpect([
      'set timeout 8',
      'log_user 1',
      'spawn /bin/zsh -f -c {stty rows 24 columns 100; cd "$MCV_TEST_REPO"; TERM=xterm-256color "$MCV_TEST_NODE" "$MCV_TEST_CLI" profile edit global; code=$?; print -r -- EXIT_CODE:$code; exit $code}',
      'expect -exact {MCV Profile Editor}',
      'send "\\003"',
      'expect -exact {EXIT_CODE:130}',
      'expect eof',
      'set result [wait]',
      'exit [lindex $result 3]',
    ], { MCV_TEST_REPO: repositoryPath });

    expect(outcome.code).toBe(130);
    expectRestoredTerminal(outcome.output);
  }, 20_000);

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
        reject(new Error(`Timed out waiting for Profile TUI. Output: ${output}`));
      }, 15_000);
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

  function writeBinding(repositoryPath: string, repositoryId: string): void {
    fs.mkdirSync(path.dirname(statePath()), { recursive: true });
    fs.writeFileSync(statePath(), `${JSON.stringify({
      schemaVersion: 3,
      repositoryPath,
      defaultRepositoryId: repositoryId,
    }, null, 2)}\n`);
  }

  function statePath(): string {
    if (process.platform === 'darwin') {
      return path.join(testRoot, 'Library', 'Application Support', 'mcv', 'config.json');
    }
    if (process.platform === 'win32') {
      return path.join(testRoot, 'mcv', 'config.json');
    }
    return path.join(testRoot, '.config', 'mcv', 'config.json');
  }
});

function expectRestoredTerminal(output: string): void {
  expect(output).toContain('\u001b[?1049h');
  expect(output).toContain('\u001b[?1049l');
  expect(output).toContain('\u001b[?25l');
  expect(output).toContain('\u001b[?25h');
}

function createRepository(testRoot: string, repositoryId: string): string {
  const repositoryPath = path.join(testRoot, 'repository');
  fs.mkdirSync(path.join(repositoryPath, 'common', 'skills', 'debug'), { recursive: true });
  fs.writeFileSync(path.join(repositoryPath, 'mcv.yaml'), [
    'schemaVersion: 4',
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
      global: { title: 'Global', assets: ['rule:canonical'] },
      dev: { title: 'Dev', assets: ['skill:debug'] },
    },
  });
  return repositoryPath;
}
