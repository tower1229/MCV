import { describe, expect, it, vi } from 'vitest';
import { preserveTerminalInputMode } from './terminal-input-mode.js';

describe('preserveTerminalInputMode', () => {
  it('does nothing outside Windows', () => {
    const spawn = vi.fn();

    const restore = preserveTerminalInputMode('darwin', spawn);
    restore();

    expect(spawn).not.toHaveBeenCalled();
  });

  it('captures and restores the exact Windows console input mode', () => {
    const spawn = vi.fn()
      .mockReturnValueOnce({ status: 0, stdout: '503\r\n' })
      .mockReturnValueOnce({ status: 0, stdout: '' });

    const restore = preserveTerminalInputMode('win32', spawn);
    restore();

    expect(spawn).toHaveBeenCalledTimes(2);
    expect(spawn.mock.calls[0]?.[1]).toContain('-Command');
    expect(spawn.mock.calls[1]?.[1].join(' ')).toContain(
      '[uint32]503',
    );
  });

  it('fails safely when the Windows mode cannot be read', () => {
    const spawn = vi.fn().mockReturnValue({
      status: 1,
      stdout: '',
    });

    expect(() => preserveTerminalInputMode('win32', spawn)).toThrow(
      'Could not capture the Windows console input mode.',
    );
    expect(spawn).toHaveBeenCalledTimes(1);
  });

  it('reports a failed Windows mode restore', () => {
    const spawn = vi.fn()
      .mockReturnValueOnce({ status: 0, stdout: '503\r\n' })
      .mockReturnValueOnce({ status: 1, stdout: '' });

    const restore = preserveTerminalInputMode('win32', spawn);

    expect(restore).toThrow('Could not restore the Windows console input mode.');
  });
});
