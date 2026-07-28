import type { Key } from 'ink';

export type ShellInteractionIntent =
  | { type: 'interrupt' }
  | { type: 'quit' }
  | { type: 'focus.previous' }
  | { type: 'focus.next' }
  | { type: 'focus.first' }
  | { type: 'focus.last' }
  | { type: 'page.previous' }
  | { type: 'page.next' }
  | { type: 'open' }
  | { type: 'confirm' }
  | { type: 'back' }
  | { type: 'cancel' }
  | { type: 'toggle' }
  | { type: 'delete.backward' }
  | { type: 'text'; value: string }
  | { type: 'ignore' };

export function normalizeShellInteraction(
  input: string,
  key: Key,
): ShellInteractionIntent {
  if (key.ctrl && input === 'c') return { type: 'interrupt' };
  if (input === 'q' && !key.ctrl && !key.meta) return { type: 'quit' };
  if (key.upArrow) return { type: 'focus.previous' };
  if (key.downArrow) return { type: 'focus.next' };
  if (key.home) return { type: 'focus.first' };
  if (key.end) return { type: 'focus.last' };
  if (key.pageUp) return { type: 'page.previous' };
  if (key.pageDown) return { type: 'page.next' };
  if (key.rightArrow) return { type: 'open' };
  if (key.return) return { type: 'confirm' };
  if (key.leftArrow) return { type: 'back' };
  if (key.escape) return { type: 'cancel' };
  if (input === ' ') return { type: 'toggle' };
  if (key.backspace || key.delete) return { type: 'delete.backward' };
  if (input && !key.ctrl && !key.meta) return { type: 'text', value: input };
  return { type: 'ignore' };
}
