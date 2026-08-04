export function parameterizeConfig(input, context) {
    let parameterizedPathCount = 0;
    const visit = (value) => {
        if (Array.isArray(value))
            return value.map(visit);
        if (value !== null && typeof value === 'object') {
            return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, visit(child)]));
        }
        if (typeof value !== 'string')
            return value;
        const parameterized = parameterizeHomePath(value, context);
        parameterizedPathCount += parameterized.replacementCount;
        return parameterized.value;
    };
    return { value: visit(input), parameterizedPathCount };
}
function parameterizeHomePath(value, context) {
    const replacements = Object.entries({
        HOME: context.homeDir,
        ...context.variables,
    }).flatMap(([name, absolutePath]) => [...new Set([
            absolutePath,
            absolutePath.replace(/\\/g, '/'),
            absolutePath.replace(/\//g, '\\'),
        ])].map((variant) => ({ name, absolutePath: variant })));
    const caseInsensitive = context.platform === 'win32';
    let result = value;
    let replacementCount = 0;
    for (const replacement of replacements.sort((left, right) => right.absolutePath.length - left.absolutePath.length)) {
        if (!replacement.absolutePath)
            continue;
        const expression = new RegExp(`${escapeRegExp(replacement.absolutePath)}(?=$|[\\\\/])`, caseInsensitive ? 'gi' : 'g');
        result = result.replace(expression, () => {
            replacementCount += 1;
            return `\${${replacement.name}}`;
        });
    }
    return {
        value: replacementCount === 0
            ? result
            : normalizePortableSeparators(result, context.platform),
        replacementCount,
    };
}
function normalizePortableSeparators(value, platform) {
    const uris = [];
    const protectedValue = value.replace(/[a-zA-Z][a-zA-Z0-9+.-]*:\/\/\S+/g, (uri) => {
        const token = `\uE000MCV_URI_${uris.length}\uE001`;
        uris.push(uri);
        return token;
    });
    const normalized = platform === 'win32'
        ? protectedValue.replace(/\//g, '\\')
        : protectedValue.replace(/\\/g, '/');
    return normalized.replace(/\uE000MCV_URI_(\d+)\uE001/g, (_token, index) => uris[Number(index)]);
}
function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
