export const spacer = () => ({ kind: 'spacer' });
export const status = (role, text) => ({
    kind: 'status',
    role,
    text,
});
export const fact = (label, value, role) => ({ kind: 'fact', label, value, role });
export const paragraph = (text, role) => ({
    kind: 'paragraph',
    content: typeof text === 'string' ? [{ text }] : text,
    role,
});
export const literal = (text) => ({ kind: 'literal', text });
export function issueRole(severity) {
    switch (severity) {
        case 'error': return 'danger';
        case 'decisionRequired': return 'decision';
        case 'warning': return 'attention';
        case 'notice': return 'information';
    }
}
export function issueBlocks(issues) {
    const order = ['error', 'decisionRequired', 'warning', 'notice'];
    return order.flatMap((severity) => issues
        .filter((issue) => issue.severity === severity)
        .flatMap((issue) => [
        status(issueRole(issue.severity), `${issue.code}: ${issue.message}`),
        ...(issue.details ? [literal(issue.details)] : []),
    ]));
}
export function textLines(lines) {
    return lines.map((line) => line.length === 0 ? spacer() : paragraph(line));
}
