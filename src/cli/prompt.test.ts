import { afterEach, describe, expect, it, vi } from 'vitest';

const terminalPrompt = vi.hoisted(() => ({
  question: vi.fn(),
  once: vi.fn(),
  off: vi.fn(),
  close: vi.fn(),
}));

vi.mock('readline/promises', () => ({
  createInterface: vi.fn(() => terminalPrompt),
}));

import { askInTerminal, withInterruptsIgnored } from './prompt.js';

describe('terminal prompt interruption', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    terminalPrompt.question.mockReset();
    terminalPrompt.once.mockReset();
    terminalPrompt.off.mockReset();
    terminalPrompt.close.mockReset();
  });

  it('returns an interrupted outcome and removes signal handlers on Ctrl+C', async () => {
    terminalPrompt.question.mockImplementation(
      (_question: string, options: { signal: AbortSignal }) =>
        new Promise<string>((_resolve, reject) => {
          options.signal.addEventListener('abort', () => {
            const error = new Error('aborted');
            error.name = 'AbortError';
            reject(error);
          });
        }),
    );

    const outcome = askInTerminal('Continue? ');
    process.emit('SIGINT');

    await expect(outcome).resolves.toEqual({ interrupted: true });
    expect(terminalPrompt.close).toHaveBeenCalledOnce();
    expect(process.listenerCount('SIGINT')).toBe(0);
  });

  it('ignores Ctrl+C only while a write transaction is running', async () => {
    await expect(withInterruptsIgnored(async () => {
      process.emit('SIGINT');
      return 'committed';
    })).resolves.toBe('committed');
    expect(process.listenerCount('SIGINT')).toBe(0);
  });
});
