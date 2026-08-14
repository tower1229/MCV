import { describe, expect, it, vi } from 'vitest';
import { preserveTerminalInputMode, restoreStdinKeepAlive } from './terminal-input-mode.js';

describe('stdin keep-alive after TUI', () => {
  it('re-refs a TTY stdin and discards buffered input', () => {
    const chunks: Array<Buffer | null> = [Buffer.from('\r'), null];
    const stdin = {
      isTTY: true,
      ref: vi.fn(),
      resume: vi.fn(),
      pause: vi.fn(),
      read: vi.fn(() => chunks.shift() ?? null),
    };

    restoreStdinKeepAlive(stdin);

    expect(stdin.ref).toHaveBeenCalledOnce();
    expect(stdin.resume).toHaveBeenCalledOnce();
    expect(stdin.read).toHaveBeenCalledTimes(2);
    expect(stdin.pause).toHaveBeenCalledOnce();
  });

  it('does not touch non-TTY stdin', () => {
    const stdin = { isTTY: false, ref: vi.fn() };
    restoreStdinKeepAlive(stdin);
    expect(stdin.ref).not.toHaveBeenCalled();
  });

  it('re-refs stdin when restoring a non-Windows TUI session', () => {
    const ref = vi.spyOn(process.stdin, 'ref').mockReturnValue(process.stdin);
    const resume = vi.spyOn(process.stdin, 'resume').mockReturnValue(process.stdin);
    const pause = vi.spyOn(process.stdin, 'pause').mockReturnValue(process.stdin);
    const read = vi.spyOn(process.stdin, 'read').mockReturnValue(null);
    const originalIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value: true });
    try {
      preserveTerminalInputMode('darwin')();
      expect(ref).toHaveBeenCalled();
    } finally {
      Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value: originalIsTTY });
      read.mockRestore();
      pause.mockRestore();
      resume.mockRestore();
      ref.mockRestore();
    }
  });
});
