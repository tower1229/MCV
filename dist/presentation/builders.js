export const spacer = () => ({ kind: 'spacer' });
export const status = (role, text) => ({
    kind: 'status',
    role,
    text,
});
export const fact = (label, value, role, valueKind) => ({ kind: 'fact', label, value, role, valueKind });
export const paragraph = (text) => ({
    kind: 'paragraph',
    content: typeof text === 'string' ? [{ text }] : text,
});
export const instruction = (text) => ({ kind: 'instruction', text });
export const command = (text) => ({ kind: 'command', text });
export const instructionActions = (actions) => actions.map(instruction);
export function diffLines(diff) {
    return diff.split('\n').map((text) => {
        if (text.startsWith('+++') || text.startsWith('---') || text.startsWith('@@'))
            return { kind: 'metadata', text };
        if (text.startsWith('+'))
            return { kind: 'add', text };
        if (text.startsWith('-'))
            return { kind: 'remove', text };
        return { kind: 'context', text };
    });
}
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
