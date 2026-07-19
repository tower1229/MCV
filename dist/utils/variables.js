"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolvePortableValue = resolvePortableValue;
exports.resolveVariableDefinitions = resolveVariableDefinitions;
const objects_1 = require("./objects");
function resolvePortableValue(value, variables, platform) {
    if (typeof value === 'string') {
        return resolvePortableVariables(value, variables, platform);
    }
    if (Array.isArray(value)) {
        return value.map((item) => resolvePortableValue(item, variables, platform));
    }
    if ((0, objects_1.isRecord)(value)) {
        return Object.fromEntries(Object.entries(value).map(([key, child]) => [
            key,
            resolvePortableValue(child, variables, platform),
        ]));
    }
    return value;
}
function resolveVariableDefinitions(definitions, deviceValues, platform) {
    const resolved = { ...deviceValues };
    const resolving = new Set();
    const resolveName = (name) => {
        const existing = resolved[name];
        if (existing !== undefined)
            return existing;
        const definition = definitions[name];
        if (definition === undefined) {
            throw new Error(`Missing value for portable variable \${${name}}.`);
        }
        if (resolving.has(name)) {
            throw new Error(`Circular portable variable reference involving \${${name}}.`);
        }
        resolving.add(name);
        const value = replacePortableReferences(definition, resolveName, platform);
        resolving.delete(name);
        resolved[name] = value;
        return value;
    };
    for (const name of Object.keys(definitions))
        resolveName(name);
    return resolved;
}
function resolvePortableVariables(content, variables, platform) {
    return replacePortableReferences(content, (name) => {
        const value = variables[name];
        if (value === undefined) {
            throw new Error(`Missing value for portable variable \${${name}}.`);
        }
        return value;
    }, platform);
}
function replacePortableReferences(content, resolveName, platform) {
    let isPath = false;
    const resolved = content.replace(/\$\{([A-Z][A-Z0-9_]*)\}([\\/])?/g, (_reference, name, separator) => {
        const value = resolveName(name);
        isPath ||= separator !== undefined;
        return separator === undefined
            ? value
            : `${value}${platform === 'win32' ? '\\' : '/'}`;
    });
    if (!isPath)
        return resolved;
    const uris = [];
    const protectedValue = resolved.replace(/[a-zA-Z][a-zA-Z0-9+.-]*:\/\/\S+/g, (uri) => {
        const token = `\uE000MCV_URI_${uris.length}\uE001`;
        uris.push(uri);
        return token;
    });
    const normalized = platform === 'win32'
        ? protectedValue.replace(/\//g, '\\')
        : protectedValue.replace(/\\/g, '/');
    return normalized.replace(/\uE000MCV_URI_(\d+)\uE001/g, (_token, index) => uris[Number(index)]);
}
