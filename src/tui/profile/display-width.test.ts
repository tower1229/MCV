import { describe, expect, it } from 'vitest';
import { displayWidth, padDisplay, truncateDisplay } from './display-width.js';

describe('displayWidth', () => {
  it('counts CJK characters as double width', () => {
    expect(displayWidth('中文')).toBe(4);
    expect(displayWidth('ア')).toBe(2);
    expect(displayWidth('abc')).toBe(3);
    expect(displayWidth('技能:调试')).toBe(9);
  });

  it('truncates search and list labels on display columns, not code units', () => {
    expect(truncateDisplay('中文调试助手', 6)).toBe('中文…');
    expect(truncateDisplay('skill:debug', 8)).toBe('skill:d…');
    expect(padDisplay('中', 4)).toBe('中  ');
  });
});
