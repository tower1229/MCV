import { describe, expect, it } from 'vitest';
import { styleText } from './color';

describe('plain renderer color detection', () => {
  it('adds ANSI color only for a color-capable TTY', () => {
    const rendered = styleText('warning', 'yellow', { isTTY: true, env: {} });

    expect(rendered).toContain('\u001b[33m');
    expect(rendered).toContain('warning');
    expect(rendered).toContain('\u001b[0m');
  });

  it('respects NO_COLOR while preserving the textual status', () => {
    expect(styleText('warning', 'yellow', {
      isTTY: true,
      env: { NO_COLOR: '' },
    })).toBe('warning');
    expect(styleText('warning', 'yellow', {
      isTTY: false,
      env: {},
    })).toBe('warning');
  });

  it('does not emit ANSI for a TTY that reports no color capability', () => {
    expect(styleText('warning', 'yellow', {
      isTTY: true,
      env: { TERM: 'dumb' },
    })).toBe('warning');
  });
});
