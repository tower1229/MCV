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

vi.mock('readline/promises', () => ({
  createInterface: vi.fn(() => terminalPrompt),
}));

import { createProgram } from './index.js';

describe('mcv default path without fullscreen Shell', () => {
  const originalCwd = process.cwd();
  const originalIsTTY = process.stdin.isTTY;
  const originalStdoutIsTTY = process.stdout.isTTY;
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
      schemaVersion: 4,
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
    expect(loggedText()).toContain('Repository  ');
    expect(terminalPrompt.question).not.toHaveBeenCalled();
  });

  it('prints a plain-text Overview when stdout is a TTY even if stdin is not', async () => {
    Object.defineProperty(process.stdin, 'isTTY', {
      configurable: true,
      value: false,
    });

    await createProgram(context()).parseAsync(['node', 'mcv']);

    expect(loggedText()).toContain('Repository  ');
    expect(loggedText()).toContain('pending deployment');
    expect(terminalPrompt.question).not.toHaveBeenCalled();
  });

  it('prints a plain-text Overview for bare mcv in a TTY and exits', async () => {
    await createProgram(context()).parseAsync(['node', 'mcv']);

    expect(loggedText()).toContain('Repository  ');
    expect(loggedText()).toContain(repositoryPath);
    expect(loggedText()).toContain('pending deployment');
    expect(terminalPrompt.question).not.toHaveBeenCalled();
  });

  it('prints the same Overview through the status compatibility alias', async () => {
    await createProgram(context()).parseAsync(['node', 'mcv', 'status']);

    expect(loggedText()).toContain('Repository  ');
    expect(loggedText()).toContain('pending deployment');
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
      marker: 'Init Plan:',
    },
    { argv: ['repo'], marker: 'Repository:' },
    { argv: ['bind'], marker: 'Bind Plan:' },
    { argv: ['unbind'], marker: 'Unbind Plan:' },
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
      marker: 'Migration Plan:',
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
