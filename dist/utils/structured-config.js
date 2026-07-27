import * as yaml from 'yaml';
import { parse as parseToml, stringify as stringifyToml } from 'smol-toml';
import { isRecord, mergeRecords } from './objects.js';
export function parseStructuredObject(content, format, label) {
    const parsed = format === 'json'
        ? JSON.parse(content)
        : format === 'yaml'
            ? yaml.parse(content)
            : parseToml(content);
    if (!isRecord(parsed)) {
        throw new Error(`${label} must contain a ${format.toUpperCase()} object.`);
    }
    return parsed;
}
export function parseJsonc(content) {
    let output = '';
    let inString = false;
    let escaped = false;
    let lineComment = false;
    let blockComment = false;
    for (let index = 0; index < content.length; index += 1) {
        const char = content[index];
        const next = content[index + 1];
        if (lineComment) {
            if (char === '\n') {
                lineComment = false;
                output += char;
            }
            continue;
        }
        if (blockComment) {
            if (char === '*' && next === '/') {
                blockComment = false;
                index += 1;
            }
            continue;
        }
        if (!inString && char === '/' && next === '/') {
            lineComment = true;
            index += 1;
            continue;
        }
        if (!inString && char === '/' && next === '*') {
            blockComment = true;
            index += 1;
            continue;
        }
        output += char;
        if (inString) {
            if (escaped)
                escaped = false;
            else if (char === '\\')
                escaped = true;
            else if (char === '"')
                inString = false;
        }
        else if (char === '"')
            inString = true;
    }
    const withoutTrailingCommas = output.replace(/,(\s*[}\]])/g, '$1');
    return JSON.parse(withoutTrailingCommas);
}
export function parseJsoncObject(content, label) {
    const parsed = parseJsonc(content);
    if (!isRecord(parsed))
        throw new Error(`${label} must contain a JSON object.`);
    return parsed;
}
export function stringifyStructuredObject(value, format) {
    if (format === 'json')
        return `${JSON.stringify(value, null, 2)}\n`;
    if (format === 'yaml')
        return yaml.stringify(value);
    return stringifyToml(value);
}
export function splitOwnedFields(value, managedPaths, localPaths) {
    const native = cloneRecord(value);
    const managed = managedPaths.flatMap((objectPath) => {
        const field = getObjectPath(value, objectPath);
        return field.found ? [{ path: objectPath, value: field.value }] : [];
    });
    for (const objectPath of [...managedPaths, ...localPaths]) {
        deleteObjectPath(native, objectPath);
    }
    return { native, managed };
}
export function mergeStructuredOverlay(existing, native, managed, managedPaths) {
    const merged = mergeRecords(existing, native);
    for (const objectPath of managedPaths) {
        const field = managed
            ? getObjectPath(managed, objectPath)
            : { found: false };
        if (field.found) {
            setObjectPath(merged, objectPath, field.value);
        }
        else {
            deleteObjectPath(merged, objectPath);
        }
    }
    return merged;
}
function getObjectPath(value, objectPath) {
    let current = value;
    for (const segment of parseObjectPath(objectPath)) {
        if (!isRecord(current) || !(segment in current))
            return { found: false };
        current = current[segment];
    }
    return { found: true, value: current };
}
function setObjectPath(value, objectPath, fieldValue) {
    const segments = parseObjectPath(objectPath);
    let current = value;
    for (const segment of segments.slice(0, -1)) {
        const next = current[segment];
        if (!isRecord(next))
            current[segment] = {};
        current = current[segment];
    }
    current[segments.at(-1)] = fieldValue;
}
export function deleteObjectPath(value, objectPath) {
    const exactKey = objectPath.slice(2);
    if (exactKey in value) {
        delete value[exactKey];
        return;
    }
    const segments = parseObjectPath(objectPath);
    const parents = [];
    let current = value;
    for (const segment of segments.slice(0, -1)) {
        const next = current[segment];
        if (!isRecord(next))
            return;
        parents.push({ value: current, key: segment });
        current = next;
    }
    delete current[segments.at(-1)];
    for (const parent of parents.reverse()) {
        const child = parent.value[parent.key];
        if (isRecord(child) && Object.keys(child).length === 0) {
            delete parent.value[parent.key];
        }
        else {
            break;
        }
    }
}
function parseObjectPath(objectPath) {
    if (!/^\$\.[^.]+(?:\.[^.]+)*$/.test(objectPath)) {
        throw new Error(`Unsupported object path: ${objectPath}`);
    }
    return objectPath.slice(2).split('.');
}
function cloneRecord(value) {
    return Object.fromEntries(Object.entries(value).map(([key, field]) => [key, cloneValue(field)]));
}
function cloneValue(value) {
    if (Array.isArray(value))
        return value.map(cloneValue);
    if (isRecord(value))
        return cloneRecord(value);
    if (value instanceof Date)
        return new Date(value);
    return value;
}
