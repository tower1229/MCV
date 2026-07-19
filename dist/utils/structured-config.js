"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseStructuredObject = parseStructuredObject;
exports.parseJsonc = parseJsonc;
exports.parseJsoncObject = parseJsoncObject;
exports.stringifyStructuredObject = stringifyStructuredObject;
exports.splitOwnedFields = splitOwnedFields;
exports.mergeStructuredOverlay = mergeStructuredOverlay;
exports.deleteObjectPath = deleteObjectPath;
const yaml = __importStar(require("yaml"));
const smol_toml_1 = require("smol-toml");
const objects_1 = require("./objects");
function parseStructuredObject(content, format, label) {
    const parsed = format === 'json'
        ? JSON.parse(content)
        : format === 'yaml'
            ? yaml.parse(content)
            : (0, smol_toml_1.parse)(content);
    if (!(0, objects_1.isRecord)(parsed)) {
        throw new Error(`${label} must contain a ${format.toUpperCase()} object.`);
    }
    return parsed;
}
function parseJsonc(content) {
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
function parseJsoncObject(content, label) {
    const parsed = parseJsonc(content);
    if (!(0, objects_1.isRecord)(parsed))
        throw new Error(`${label} must contain a JSON object.`);
    return parsed;
}
function stringifyStructuredObject(value, format) {
    if (format === 'json')
        return `${JSON.stringify(value, null, 2)}\n`;
    if (format === 'yaml')
        return yaml.stringify(value);
    return (0, smol_toml_1.stringify)(value);
}
function splitOwnedFields(value, managedPaths, localPaths) {
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
function mergeStructuredOverlay(existing, native, managed, managedPaths) {
    const merged = (0, objects_1.mergeRecords)(existing, native);
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
        if (!(0, objects_1.isRecord)(current) || !(segment in current))
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
        if (!(0, objects_1.isRecord)(next))
            current[segment] = {};
        current = current[segment];
    }
    current[segments.at(-1)] = fieldValue;
}
function deleteObjectPath(value, objectPath) {
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
        if (!(0, objects_1.isRecord)(next))
            return;
        parents.push({ value: current, key: segment });
        current = next;
    }
    delete current[segments.at(-1)];
    for (const parent of parents.reverse()) {
        const child = parent.value[parent.key];
        if ((0, objects_1.isRecord)(child) && Object.keys(child).length === 0) {
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
    if ((0, objects_1.isRecord)(value))
        return cloneRecord(value);
    if (value instanceof Date)
        return new Date(value);
    return value;
}
