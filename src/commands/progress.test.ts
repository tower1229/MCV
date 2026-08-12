import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTerminalProgressReporter } from './progress.js';

describe('terminal Operation progress', () => {
  const originalStdinIsTTY = process.stdin.isTTY;
  const originalStdoutIsTTY = process.stdout.isTTY;

  afterEach(() => {
    Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value: originalStdinIsTTY });
    Object.defineProperty(process.stdout, 'isTTY', { configurable: true, value: originalStdoutIsTTY });
    vi.restoreAllMocks();
  });

  it('renders stage labels only for interactive human output', () => {
    Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value: true });
    Object.defineProperty(process.stdout, 'isTTY', { configurable: true, value: true });
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});

    const report = createTerminalProgressReporter(false);
    report?.('building-plan');

    expect(error).toHaveBeenCalledWith(expect.stringContaining('Building plan'));
  });

  it.each([
    ['JSON', true, true, true],
    ['non-TTY stdin', false, false, true],
    ['non-TTY stdout', false, true, false],
  ])('suppresses progress for %s', (_label, json, stdinIsTTY, stdoutIsTTY) => {
    Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value: stdinIsTTY });
    Object.defineProperty(process.stdout, 'isTTY', { configurable: true, value: stdoutIsTTY });

    expect(createTerminalProgressReporter(json)).toBeUndefined();
  });
});
