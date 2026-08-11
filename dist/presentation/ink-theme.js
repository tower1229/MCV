import { resolveOutputCapability } from './theme.js';
const ROLE_COLORS = {
    success: 'green',
    attention: 'yellow',
    decision: 'yellow',
    danger: 'red',
    information: 'cyan',
};
export function inkRoleProps(role, options = {}) {
    if (!inkStylingEnabled(options.env))
        return {};
    return {
        color: ROLE_COLORS[role],
        dimColor: role === 'muted' || undefined,
        bold: options.emphasis || undefined,
    };
}
export function inkEmphasisProps(env = process.env) {
    return inkStylingEnabled(env) ? { bold: true } : {};
}
export function inkColor(role, env = process.env) {
    return inkStylingEnabled(env) ? ROLE_COLORS[role] : undefined;
}
function inkStylingEnabled(env = process.env) {
    return resolveOutputCapability({ isTTY: true, env }).color;
}
