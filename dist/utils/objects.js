export function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}
export function mergeRecords(base, overlay) {
    const merged = { ...base };
    for (const [key, value] of Object.entries(overlay)) {
        const baseValue = merged[key];
        merged[key] = isRecord(baseValue) && isRecord(value)
            ? mergeRecords(baseValue, value)
            : value;
    }
    return merged;
}
