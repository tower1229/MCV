import type { PresentationRole } from './contracts.js';

export interface PresentationToken {
  symbol: string;
  ansi: number;
}

export const PRESENTATION_THEME: Record<PresentationRole, PresentationToken> = {
  success: { symbol: '✓', ansi: 32 },
  attention: { symbol: '!', ansi: 33 },
  decision: { symbol: '?', ansi: 33 },
  danger: { symbol: '×', ansi: 31 },
  information: { symbol: '•', ansi: 36 },
  muted: { symbol: '·', ansi: 2 },
};

export interface OutputCapability {
  color: boolean;
  columns?: number;
}

export function resolveOutputCapability(input: {
  isTTY?: boolean;
  columns?: number;
  env?: NodeJS.ProcessEnv;
  forcePlain?: boolean;
} = {}): OutputCapability {
  const env = input.env ?? process.env;
  const forceColorPresent = Object.prototype.hasOwnProperty.call(env, 'FORCE_COLOR');
  const color = !input.forcePlain
    && !Object.prototype.hasOwnProperty.call(env, 'NO_COLOR')
    && env.TERM?.toLowerCase() !== 'dumb'
    && env.FORCE_COLOR !== '0'
    && (forceColorPresent || Boolean(input.isTTY));
  return {
    color,
    columns: input.isTTY ? input.columns : undefined,
  };
}

export function stylePresentationText(
  text: string,
  role: PresentationRole | undefined,
  capability: OutputCapability,
): string {
  if (!role || !capability.color) return text;
  return `\u001b[${PRESENTATION_THEME[role].ansi}m${text}\u001b[0m`;
}
