const ANSI_CODES = {
    green: 32,
    yellow: 33,
    red: 31,
    cyan: 36,
    dim: 2,
};
export function shouldUseColor(context = {}) {
    const isTTY = context.isTTY ?? Boolean(process.stdout.isTTY);
    const env = context.env ?? process.env;
    return isTTY
        && !Object.prototype.hasOwnProperty.call(env, 'NO_COLOR')
        && env.TERM !== 'dumb'
        && env.FORCE_COLOR !== '0';
}
export function styleText(text, tone, context = {}) {
    if (!shouldUseColor(context))
        return text;
    return `\u001b[${ANSI_CODES[tone]}m${text}\u001b[0m`;
}
export function styleIssueSeverity(severity) {
    const tone = severity === 'notice'
        ? 'cyan'
        : severity === 'warning' || severity === 'decisionRequired'
            ? 'yellow'
            : 'red';
    return styleText(severity, tone);
}
export function renderIssuePlain(issue) {
    return `[${styleIssueSeverity(issue.severity)}] ${issue.code}: ${issue.message}`;
}
