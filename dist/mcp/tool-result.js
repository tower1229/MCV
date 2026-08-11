export function toolResult(toolName, output) {
    return {
        content: [
            {
                type: 'text',
                text: `${toolName}: ${output.status}. See structuredContent for the complete result.`,
            },
        ],
        structuredContent: output,
    };
}
export function serializedToolResultBytes(toolName, output) {
    return Buffer.byteLength(JSON.stringify(toolResult(toolName, output)), 'utf8');
}
