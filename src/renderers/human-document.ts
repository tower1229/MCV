import type { Issue } from '../operations/contracts.js';
import { renderIssuePlain } from './color.js';

export function summarizeIssues(issues: readonly Issue[]): string {
  const count = (severity: Issue['severity']): number =>
    issues.filter((issue) => issue.severity === severity).length;
  return `Issues: ${count('error')} errors, ${count('warning')} warnings, ${count('decisionRequired')} decisions required, ${count('notice')} notices.`;
}

export function renderCriticalIssues(issues: readonly Issue[]): string[] {
  const groups = new Map<string, Issue[]>();
  for (const issue of issues) {
    if (issue.severity === 'notice') continue;
    const key = `${issue.severity}\0${issue.code}`;
    groups.set(key, [...(groups.get(key) ?? []), issue]);
  }
  return [...groups.values()].map((group) => {
    const first = renderIssuePlain(group[0]);
    return group.length === 1 ? first : `${first} (${group.length} occurrences; see full review)`;
  });
}

export function withoutNextActions(lines: string[]): string[] {
  return lines.filter((line) => !line.startsWith('Next: '));
}
