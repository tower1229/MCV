import { shouldUseColor } from '../renderers/color.js';
const STATUS_TONE_STYLES = {
    success: { symbol: '✓', color: 'green' },
    info: { symbol: '●', color: 'cyan' },
    warning: { symbol: '!', color: 'yellow' },
    error: { symbol: '×', color: 'red' },
    muted: { symbol: '○', dimColor: true },
};
export function statusToneStyle(tone, env = process.env) {
    const style = STATUS_TONE_STYLES[tone];
    if (!shouldUseColor({ isTTY: true, env })) {
        return { ...style, color: undefined };
    }
    return style;
}
