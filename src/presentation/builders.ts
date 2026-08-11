import type { Issue } from '../operations/contracts.js';
import type { PresentationBlock, PresentationRole, PresentationText } from './contracts.js';

export const spacer = (): PresentationBlock => ({ kind: 'spacer' });

export const status = (role: PresentationRole, text: string): PresentationBlock => ({
  kind: 'status',
  role,
  text,
});

export const fact = (
  label: string,
  value: string,
  role?: PresentationRole,
): PresentationBlock => ({ kind: 'fact', label, value, role });

export const paragraph = (
  text: string | PresentationText[],
  role?: PresentationRole,
): PresentationBlock => ({
  kind: 'paragraph',
  content: typeof text === 'string' ? [{ text }] : text,
  role,
});

export const literal = (text: string): PresentationBlock => ({ kind: 'literal', text });

export function issueRole(severity: Issue['severity']): PresentationRole {
  switch (severity) {
    case 'error': return 'danger';
    case 'decisionRequired': return 'decision';
    case 'warning': return 'attention';
    case 'notice': return 'information';
  }
}

export function issueBlocks(issues: Issue[]): PresentationBlock[] {
  const order: Issue['severity'][] = ['error', 'decisionRequired', 'warning', 'notice'];
  return order.flatMap((severity) => issues
    .filter((issue) => issue.severity === severity)
    .flatMap((issue) => [
      status(issueRole(issue.severity), `${issue.code}: ${issue.message}`),
      ...(issue.details ? [literal(issue.details)] : []),
    ]));
}

export function textLines(lines: string[]): PresentationBlock[] {
  return lines.map((line) => line.length === 0 ? spacer() : paragraph(line));
}
