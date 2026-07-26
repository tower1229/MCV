import * as fs from 'fs';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const terminalPrompt = vi.hoisted(() => ({
  question: vi.fn(),
  once: vi.fn(),
  off: vi.fn(),
  close: vi.fn(),
}));

vi.mock('readline/promises', () => ({
  createInterface: vi.fn(() => terminalPrompt),
}));

import { createProgram } from './index';

describe('mcv init interaction', () => {
  const originalCwd = process.cwd();
  const originalIsTTY = process.stdin.isTTY;
  let testRoot: string;
  let repositoryPath: string;
  let homeDir: string;

  beforeEach(() => {
    testRoot = fs.mkdtempSync(path.join(originalCwd, '.mcv-index-test-'));
    repositoryPath = path.join(testRoot, 'repository');
    homeDir = path.join(testRoot, 'home');
    fs.mkdirSync(repositoryPath);
    fs.mkdirSync(path.join(homeDir, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(homeDir, '.claude', 'settings.json'), '{"theme":"dark"}\n');
    process.chdir(repositoryPath);
    Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value: true });
    terminalPrompt.question.mockReset().mockResolvedValueOnce('y');
    terminalPrompt.once.mockReset();
    terminalPrompt.off.mockReset();
    terminalPrompt.close.mockReset();
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    process.chdir(originalCwd);
    Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value: originalIsTTY });
    vi.restoreAllMocks();
    fs.rmSync(testRoot, { recursive: true, force: true });
  });

  it('keeps explicit JSON Init execution one-shot inside a TTY', async () => {
    await createProgram(
      { homeDir, platform: 'darwin', env: {}, pathEnv: '' },
    ).parseAsync(['node', 'mcv', 'init', '--yes', '--json']);

    expect(terminalPrompt.question).not.toHaveBeenCalled();
    expect(console.log).toHaveBeenCalledOnce();
    expect(JSON.parse(String(vi.mocked(console.log).mock.calls[0]?.[0]))).toMatchObject({
      operation: 'init',
      status: 'succeeded',
    });
  });

  it('closes the main menu prompt before a selected command starts reading terminal input', async () => {
    const context = { homeDir, platform: 'darwin' as const, env: {}, pathEnv: '' };
    Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value: false });
    await createProgram(context).parseAsync(['node', 'mcv', 'init', '--yes']);
    Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value: true });
    terminalPrompt.question.mockReset().mockResolvedValueOnce('2');
    terminalPrompt.close.mockReset();

    await createProgram(
      context,
      {
        confirmCapture: async () => {
          expect(terminalPrompt.close).toHaveBeenCalledOnce();
          return false;
        },
      },
    ).parseAsync(['node', 'mcv']);
  });
});
