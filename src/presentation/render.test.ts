import { describe, expect, it } from 'vitest';
import { issueBlocks } from './builders.js';
import { renderPresentationBlocks } from './render.js';
import { resolveOutputCapability } from './theme.js';

describe('Presentation semantic rendering', () => {
  it('keeps symbols and wording when color is disabled', () => {
    const output = renderPresentationBlocks([
      { kind: 'status', role: 'success', text: 'Complete' },
      { kind: 'status', role: 'attention', text: 'Drift requires review' },
      { kind: 'status', role: 'decision', text: 'Choose a source' },
      { kind: 'status', role: 'danger', text: 'Blocked' },
      { kind: 'status', role: 'information', text: 'Active context' },
      { kind: 'status', role: 'muted', text: 'Optional path absent' },
    ], { color: false });

    expect(output).toBe([
      '✓ Complete',
      '! Drift requires review',
      '? Choose a source',
      '× Blocked',
      '• Active context',
      '· Optional path absent',
    ].join('\n'));
  });

  it('orders standard Issues without changing source order within a severity', () => {
    const output = renderPresentationBlocks(issueBlocks([
      { severity: 'warning', confirmationId: 'w.first', code: 'w.first', message: 'First warning' },
      { severity: 'error', code: 'e.only', message: 'Error' },
      { severity: 'warning', confirmationId: 'w.second', code: 'w.second', message: 'Second warning' },
      { severity: 'decisionRequired', code: 'd.only', message: 'Decision' },
      { severity: 'notice', code: 'n.only', message: 'Notice' },
    ]), { color: false });

    expect(output.split('\n')).toEqual([
      '× e.only: Error',
      '? d.only: Decision',
      '! w.first: First warning',
      '! w.second: Second warning',
      '• n.only: Notice',
    ]);
  });

  it('applies deterministic color capability precedence', () => {
    expect(resolveOutputCapability({ isTTY: false, env: { FORCE_COLOR: '' } }).color).toBe(true);
    expect(resolveOutputCapability({ isTTY: true, env: { FORCE_COLOR: '0' } }).color).toBe(false);
    expect(resolveOutputCapability({ isTTY: true, env: { FORCE_COLOR: '1', NO_COLOR: '' } }).color).toBe(false);
    expect(resolveOutputCapability({ isTTY: true, env: { FORCE_COLOR: '1', TERM: 'dumb' } }).color).toBe(false);
    expect(resolveOutputCapability({ isTTY: true, forcePlain: true, env: { FORCE_COLOR: '1' } }).color).toBe(false);
  });

  it('quotes whitespace paths and never reflows path or command values', () => {
    const reviewPath = '/Users/me/Library/Application Support/mcv/reviews/status-long-name.txt';
    const output = renderPresentationBlocks([
      { kind: 'fact', label: 'Review', value: reviewPath, valueKind: 'path' },
      { kind: 'fact', label: 'Repository', value: '/Users/me/repo', valueKind: 'path' },
      { kind: 'fact', label: 'Repository', value: 'not bound', valueKind: 'path' },
      { kind: 'fact', label: 'restore', value: '/tmp/home/settings.json [Ordinary file]', valueKind: 'path' },
      { kind: 'fact', label: 'Next command', value: 'mcv status --verbose', valueKind: 'command' },
      { kind: 'list', items: [{ text: '/Users/me/Library/Application Support/mcv', kind: 'path' }] },
    ], { color: false, columns: 40 });

    expect(output).toBe([
      `Review  "${reviewPath}"`,
      'Repository  /Users/me/repo',
      'Repository  not bound',
      'restore  /tmp/home/settings.json [Ordinary file]',
      'Next command  mcv status --verbose',
      '   "/Users/me/Library/Application Support/mcv"',
    ].join('\n'));
  });
});
