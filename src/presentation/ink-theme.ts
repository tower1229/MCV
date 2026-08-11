import type { PresentationRole } from './contracts.js';
import { resolveOutputCapability } from './theme.js';

type InkColor = 'green' | 'yellow' | 'red' | 'cyan';

const ROLE_COLORS: Partial<Record<PresentationRole, InkColor>> = {
  success: 'green',
  attention: 'yellow',
  decision: 'yellow',
  danger: 'red',
  information: 'cyan',
};

export function inkRoleProps(
  role: PresentationRole,
  options: { emphasis?: boolean; env?: NodeJS.ProcessEnv } = {},
): { color?: InkColor; dimColor?: boolean; bold?: boolean } {
  if (!inkStylingEnabled(options.env)) return {};
  return {
    color: ROLE_COLORS[role],
    dimColor: role === 'muted' || undefined,
    bold: options.emphasis || undefined,
  };
}

export function inkEmphasisProps(
  env: NodeJS.ProcessEnv = process.env,
): { bold?: boolean } {
  return inkStylingEnabled(env) ? { bold: true } : {};
}

export function inkColor(
  role: PresentationRole,
  env: NodeJS.ProcessEnv = process.env,
): InkColor | undefined {
  return inkStylingEnabled(env) ? ROLE_COLORS[role] : undefined;
}

function inkStylingEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return resolveOutputCapability({ isTTY: true, env }).color;
}
