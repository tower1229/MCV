import type { Issue } from '../operations/contracts.js';
import type { PresentationBlock, PresentationNextAction, PresentationRole, PresentationText } from './contracts.js';

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
  valueKind?: PresentationText['kind'],
): PresentationBlock => ({ kind: 'fact', label, value, role, valueKind });

export const paragraph = (
  text: string | PresentationText[],
): PresentationBlock => ({
  kind: 'paragraph',
  content: typeof text === 'string' ? [{ text }] : text,
});

export const instruction = (text: string): PresentationNextAction => ({ kind: 'instruction', text });
export const command = (text: string): PresentationNextAction => ({ kind: 'command', text });

export const instructionActions = (actions: string[]): PresentationNextAction[] => actions.map(instruction);

export function diffLines(diff: string): Array<{ kind: 'metadata' | 'context' | 'add' | 'remove'; text: string }> {
  return diff.split('\n').map((text) => {
    if (text.startsWith('+++') || text.startsWith('---') || text.startsWith('@@')) return { kind: 'metadata', text };
    if (text.startsWith('+')) return { kind: 'add', text };
    if (text.startsWith('-')) return { kind: 'remove', text };
    return { kind: 'context', text };
  });
}

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
