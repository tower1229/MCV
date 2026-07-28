import type { Issue, IssueSeverity } from '../operations/contracts.js';

export type TextTone = 'green' | 'yellow' | 'red' | 'cyan' | 'dim';

const ANSI_CODES: Record<TextTone, number> = {
  green: 32,
  yellow: 33,
  red: 31,
  cyan: 36,
  dim: 2,
};

export interface ColorContext {
  isTTY?: boolean;
  env?: NodeJS.ProcessEnv;
}

export function shouldUseColor(
  context: ColorContext = {},
): boolean {
  const isTTY = context.isTTY ?? Boolean(process.stdout.isTTY);
  const env = context.env ?? process.env;
  return isTTY
    && !Object.prototype.hasOwnProperty.call(env, 'NO_COLOR')
    && env.TERM !== 'dumb'
    && env.FORCE_COLOR !== '0';
}

export function styleText(
  text: string,
  tone: TextTone,
  context: ColorContext = {},
): string {
  if (!shouldUseColor(context)) return text;
  return `\u001b[${ANSI_CODES[tone]}m${text}\u001b[0m`;
}

export function styleIssueSeverity(
  severity: IssueSeverity,
): string {
  const tone: TextTone = severity === 'notice'
    ? 'cyan'
    : severity === 'warning' || severity === 'decisionRequired'
      ? 'yellow'
      : 'red';
  return styleText(severity, tone);
}

export function renderIssuePlain(issue: Issue): string {
  return `[${styleIssueSeverity(issue.severity)}] ${issue.code}: ${issue.message}`;
}
