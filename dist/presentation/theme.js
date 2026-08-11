export const PRESENTATION_THEME = {
    success: { symbol: '✓', ansi: 32 },
    attention: { symbol: '!', ansi: 33 },
    decision: { symbol: '?', ansi: 33 },
    danger: { symbol: '×', ansi: 31 },
    information: { symbol: '•', ansi: 36 },
    muted: { symbol: '·', ansi: 2 },
};
export function resolveOutputCapability(input = {}) {
    const env = input.env ?? process.env;
    const forceColorPresent = Object.prototype.hasOwnProperty.call(env, 'FORCE_COLOR');
    const color = !input.forcePlain
        && !Object.prototype.hasOwnProperty.call(env, 'NO_COLOR')
        && env.TERM?.toLowerCase() !== 'dumb'
        && env.FORCE_COLOR !== '0'
        && (forceColorPresent || Boolean(input.isTTY));
    return {
        color,
        columns: input.isTTY ? input.columns : undefined,
    };
}
export function stylePresentationText(text, role, capability) {
    if (!role || !capability.color)
        return text;
    return `\u001b[${PRESENTATION_THEME[role].ansi}m${text}\u001b[0m`;
}
