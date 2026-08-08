import stringWidth from 'string-width';
export function displayWidth(value) {
    return stringWidth(value);
}
export function truncateDisplay(value, maxWidth) {
    if (maxWidth <= 0)
        return '';
    if (displayWidth(value) <= maxWidth)
        return value;
    if (maxWidth === 1)
        return '…';
    let output = '';
    for (const char of value) {
        const next = output + char;
        if (displayWidth(next) > maxWidth - 1)
            break;
        output = next;
    }
    return `${output}…`;
}
export function padDisplay(value, width) {
    const current = displayWidth(value);
    if (current >= width)
        return truncateDisplay(value, width);
    return value + ' '.repeat(width - current);
}
