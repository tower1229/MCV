import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'yaml';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { writeState } from './utils/state.js';

const terminalPrompt = vi.hoisted(() => ({
  question: vi.fn(),
  once: vi.fn(),
  off: vi.fn(),
  close: vi.fn(),
}));
const mainMenu = vi.hoisted(() => ({
  runMainMenu: vi.fn(),
}));

vi.mock('readline/promises', () => ({
  createInterface: vi.fn(() => terminalPrompt),
}));
vi.mock('./tui/menu/app.js', () => mainMenu);

import { createProgram } from './index.js';

describe('mcv one-shot task launcher routing', () => {
  const originalCwd = process.cwd();
  const originalIsTTY = process.stdin.isTTY;
  const originalStdoutIsTTY = process.stdout.isTTY;
  const originalColumns = process.stdout.columns;
  const originalRows = process.stdout.rows;
  const originalTerm = process.env.TERM;
  const originalLocale = process.env.LC_ALL;
  let testRoot: string;
  let repositoryPath: string;
  let homeDir: string;

  beforeEach(() => {
    testRoot = fs.mkdtempSync(path.join(originalCwd, '.mcv-index-test-'));
    repositoryPath = path.join(testRoot, 'repository');
    homeDir = path.join(testRoot, 'home');
    fs.mkdirSync(repositoryPath);
    fs.mkdirSync(homeDir);
    fs.writeFileSync(path.join(repositoryPath, 'mcv.yaml'), yaml.stringify({
      schemaVersion: 5,
      repositoryId: 'index-overview-id',
      initializedAt: '2026-08-07T00:00:00.000Z',
      targets: {
        codex: { enabled: true },
        claudeCode: { enabled: true },
        gemini: {
          enabled: true,
          surfaces: { geminiCli: 'auto', antigravity: 'auto' },
        },
      },
      variables: {},
      capture: { preserveUnknownNativeFields: true },
      deploy: { backupBeforeWrite: true, useSymlinks: false },
    }));
    fs.writeFileSync(path.join(repositoryPath, 'profiles.yaml'), yaml.stringify({
      schemaVersion: 1,
      profiles: {
        global: {
          assets: [],
        },
      },
    }));
    writeState(
      { homeDir, platform: 'darwin', env: {}, pathEnv: '' },
      {
        schemaVersion: 2,
        defaultRepositoryId: 'index-overview-id',
        repositoryPath,
      },
    );
    process.chdir(repositoryPath);
    Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value: true });
    Object.defineProperty(process.stdout, 'isTTY', { configurable: true, value: true });
    terminalPrompt.question.mockReset().mockResolvedValue('n');
    terminalPrompt.once.mockReset();
    terminalPrompt.off.mockReset();
    terminalPrompt.close.mockReset();
    mainMenu.runMainMenu.mockReset().mockResolvedValue({
      status: 'selected',
      action: { type: 'quit', reason: 'cancelled' },
    });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    process.chdir(originalCwd);
    Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value: originalIsTTY });
    Object.defineProperty(process.stdout, 'isTTY', {
      configurable: true,
      value: originalStdoutIsTTY,
    });
    Object.defineProperty(process.stdout, 'columns', { configurable: true, value: originalColumns });
    Object.defineProperty(process.stdout, 'rows', { configurable: true, value: originalRows });
    if (originalTerm === undefined) delete process.env.TERM;
    else process.env.TERM = originalTerm;
    if (originalLocale === undefined) delete process.env.LC_ALL;
    else process.env.LC_ALL = originalLocale;
    vi.restoreAllMocks();
    fs.rmSync(testRoot, { recursive: true, force: true });
  });

  function context() {
    return { homeDir, platform: 'darwin' as const, env: {}, pathEnv: '' };
  }

  function loggedText(): string {
    return vi.mocked(console.log).mock.calls.map((call) => String(call[0])).join('\n');
  }

  it('keeps explicit JSON Init execution one-shot inside a TTY', async () => {
    const emptyRepo = path.join(testRoot, 'empty-init');
    fs.mkdirSync(emptyRepo);
    process.chdir(emptyRepo);
    writeState(context(), { schemaVersion: 2 });

    await createProgram(context()).parseAsync(['node', 'mcv', 'init', '--yes', '--json']);

    expect(terminalPrompt.question).not.toHaveBeenCalled();
    expect(console.log).toHaveBeenCalledOnce();
    expect(JSON.parse(String(vi.mocked(console.log).mock.calls[0]?.[0]))).toMatchObject({
      operation: 'init',
      status: 'succeeded',
    });
  });

  it('prints a plain-text Overview when stdout is not a TTY', async () => {
    Object.defineProperty(process.stdout, 'isTTY', {
      configurable: true,
      value: false,
    });
    const output: string[] = [];
    const cli = createProgram(context());
    cli.configureOutput({ writeOut: (text) => output.push(text) });

    await cli.parseAsync(['node', 'mcv']);

    expect(output.join('')).not.toContain('Usage: mcv [options] [command]');
    expect(loggedText()).toContain('Repository');
    expect(terminalPrompt.question).not.toHaveBeenCalled();
  });

  it('prints a plain-text Overview when stdout is a TTY even if stdin is not', async () => {
    Object.defineProperty(process.stdin, 'isTTY', {
      configurable: true,
      value: false,
    });

    await createProgram(context()).parseAsync(['node', 'mcv']);

    expect(loggedText()).toContain('Repository');
    expect(loggedText()).toContain('pending deployment');
    expect(terminalPrompt.question).not.toHaveBeenCalled();
  });

  it('opens the task launcher for bare mcv in a capable TTY and exits without an Overview', async () => {
    Object.defineProperty(process.stdout, 'columns', { configurable: true, value: 80 });
    Object.defineProperty(process.stdout, 'rows', { configurable: true, value: 24 });
    process.env.TERM = 'xterm-256color';
    process.env.LC_ALL = 'en_US.UTF-8';
    await createProgram(context()).parseAsync(['node', 'mcv']);

    expect(mainMenu.runMainMenu).toHaveBeenCalledWith(context(), repositoryPath);
    expect(loggedText()).not.toContain('Repository  ');
    expect(terminalPrompt.question).not.toHaveBeenCalled();
  });

  it.each([
    ['dumb terminal', { term: 'dumb', columns: 80, rows: 24, locale: 'en_US.UTF-8' }],
    ['ASCII locale', { term: 'xterm-256color', columns: 80, rows: 24, locale: 'C' }],
    ['narrow terminal', { term: 'xterm-256color', columns: 59, rows: 18, locale: 'en_US.UTF-8' }],
    ['short terminal', { term: 'xterm-256color', columns: 60, rows: 17, locale: 'en_US.UTF-8' }],
  ])('falls back safely for a %s', async (_label, terminal) => {
    Object.defineProperty(process.stdout, 'columns', { configurable: true, value: terminal.columns });
    Object.defineProperty(process.stdout, 'rows', { configurable: true, value: terminal.rows });
    process.env.TERM = terminal.term;
    process.env.LC_ALL = terminal.locale;

    await createProgram(context()).parseAsync(['node', 'mcv']);

    expect(mainMenu.runMainMenu).not.toHaveBeenCalled();
    expect(loggedText()).toContain('Repository');
  });

  it('restores the safe report when menu rendering fails', async () => {
    Object.defineProperty(process.stdout, 'columns', { configurable: true, value: 80 });
    Object.defineProperty(process.stdout, 'rows', { configurable: true, value: 24 });
    process.env.TERM = 'xterm-256color';
    process.env.LC_ALL = 'en_US.UTF-8';
    mainMenu.runMainMenu.mockResolvedValue({ status: 'failed', error: new Error('render failed') });

    await createProgram(context()).parseAsync(['node', 'mcv']);

    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('render failed'));
    expect(loggedText()).toContain('Repository');
  });

  it('prints the same Overview through the status compatibility alias', async () => {
    await createProgram(context()).parseAsync(['node', 'mcv', 'status']);

    expect(loggedText()).toContain('Repository');
    expect(loggedText()).toContain('pending deployment');
    expect(mainMenu.runMainMenu).not.toHaveBeenCalled();
    expect(terminalPrompt.question).not.toHaveBeenCalled();
  });

  it.each([
    {
      argv: ['init'],
      prepare: () => {
        const emptyRepo = path.join(testRoot, 'empty-init-plan');
        fs.mkdirSync(emptyRepo);
        process.chdir(emptyRepo);
        writeState(context(), { schemaVersion: 2 });
      },
      marker: 'Init Plan',
    },
    { argv: ['repo'], marker: 'Repository Report' },
    { argv: ['bind'], marker: 'Bind Plan' },
    { argv: ['unbind'], marker: 'Unbind Plan' },
    {
      argv: ['migrate'],
      prepare: () => {
        const oldRepository = path.join(testRoot, 'old-repository');
        fs.mkdirSync(oldRepository);
        fs.writeFileSync(path.join(oldRepository, 'mcv.yaml'), yaml.stringify({
          schemaVersion: 1,
          repositoryId: 'old-repository-id',
          targets: {},
        }));
        process.chdir(oldRepository);
      },
      marker: 'Migration Plan',
    },
    { argv: ['discover'], marker: 'Codex:' },
  ])('runs `mcv $argv` as a one-shot report without a Shell', async ({ argv, prepare, marker }) => {
    prepare?.();
    await createProgram(context()).parseAsync(['node', 'mcv', ...argv]);

    expect(loggedText()).toContain(marker);
    expect(terminalPrompt.question).not.toHaveBeenCalled();
  });

  it('runs capture through the one-shot Plan/confirm path in a TTY', async () => {
    await createProgram(context()).parseAsync(['node', 'mcv', 'capture']);

    expect(loggedText().length).toBeGreaterThan(0);
    expect(terminalPrompt.question).toHaveBeenCalled();
  });

  it.each([
    ['--tui', '--no-tui'],
    ['--tui', '--dry-run'],
    ['--no-tui', '--yes'],
    ['--tui', '--verbose'],
  ])('rejects incompatible Capture review flags: %s %s', async (left, right) => {
    const cli = createProgram(context());
    const capture = cli.commands.find((command) => command.name() === 'capture');
    capture?.configureOutput({ writeErr: () => {} }).exitOverride();

    await expect(
      cli.parseAsync(['node', 'mcv', 'capture', left, right]),
    ).rejects.toMatchObject({ exitCode: 2 });
  });

  it('runs deploy through the one-shot command path in a TTY', async () => {
    await createProgram(context()).parseAsync(['node', 'mcv', 'deploy', '--global']);

    expect(loggedText()).toMatch(/already in sync|Deploy global configuration/);
  });

  it('runs restore through the one-shot command path in a TTY', async () => {
    await createProgram(context()).parseAsync(['node', 'mcv', 'restore', '--global']);

    expect(`${loggedText()}\n${vi.mocked(console.error).mock.calls.map((call) => String(call[0])).join('\n')}`)
      .toMatch(/Restore Plan:|No complete restore backup|restore\./i);
  });
});
