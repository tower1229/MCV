import { renderIssuePlain } from './color.js';
export function summarizeIssues(issues) {
    const count = (severity) => issues.filter((issue) => issue.severity === severity).length;
    return `Issues: ${count('error')} errors, ${count('warning')} warnings, ${count('decisionRequired')} decisions required, ${count('notice')} notices.`;
}
export function renderCriticalIssues(issues) {
    const groups = new Map();
    for (const issue of issues) {
        if (issue.severity === 'notice')
            continue;
        const key = `${issue.severity}\0${issue.code}`;
        groups.set(key, [...(groups.get(key) ?? []), issue]);
    }
    return [...groups.values()].map((group) => {
        const first = renderIssuePlain(group[0]);
        return group.length === 1 ? first : `${first} (${group.length} occurrences; see full review)`;
    });
}
export function withoutNextActions(lines) {
    return lines.filter((line) => !line.startsWith('Next: '));
}
