import { shouldUseColor } from '../renderers/color.js';

export type StatusTone = 'success' | 'info' | 'warning' | 'error' | 'muted';

export interface StatusToneStyle {
  symbol: '✓' | '●' | '!' | '×' | '○';
  color?: 'green' | 'cyan' | 'yellow' | 'red';
  dimColor?: boolean;
}

const STATUS_TONE_STYLES: Record<StatusTone, StatusToneStyle> = {
  success: { symbol: '✓', color: 'green' },
  info: { symbol: '●', color: 'cyan' },
  warning: { symbol: '!', color: 'yellow' },
  error: { symbol: '×', color: 'red' },
  muted: { symbol: '○', dimColor: true },
};

export function statusToneStyle(
  tone: StatusTone,
  env: NodeJS.ProcessEnv = process.env,
): StatusToneStyle {
  const style = STATUS_TONE_STYLES[tone];
  if (!shouldUseColor({ isTTY: true, env })) {
    return { ...style, color: undefined };
  }
  return style;
}
