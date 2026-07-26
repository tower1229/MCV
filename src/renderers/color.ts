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

export function styleText(
  text: string,
  tone: TextTone,
  context: ColorContext = {},
): string {
  const isTTY = context.isTTY ?? Boolean(process.stdout.isTTY);
  const env = context.env ?? process.env;
  if (!isTTY || Object.prototype.hasOwnProperty.call(env, 'NO_COLOR')) return text;
  return `\u001b[${ANSI_CODES[tone]}m${text}\u001b[0m`;
}

export function styleIssueSeverity(
  severity: 'notice' | 'warning' | 'decisionRequired' | 'error',
): string {
  const tone: TextTone = severity === 'notice'
    ? 'cyan'
    : severity === 'warning' || severity === 'decisionRequired'
      ? 'yellow'
      : 'red';
  return styleText(severity, tone);
}
