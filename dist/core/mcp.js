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
exports.normalizeMcpServers = normalizeMcpServers;
exports.toNativeMcpServers = toNativeMcpServers;
const path = __importStar(require("path"));
const objects_1 = require("../utils/objects");
const PORTABLE_KEYS = new Set(['command', 'args', 'env', 'cwd', 'url', 'httpUrl', 'serverUrl', 'transport', 'overrides']);
function normalizeMcpServers(input, surface) {
    const servers = {};
    const surfaceOverrides = {};
    const excluded = [];
    for (const [name, raw] of Object.entries(input)) {
        if (!(0, objects_1.isRecord)(raw))
            continue;
        const command = typeof raw.command === 'string' ? raw.command : undefined;
        if (isRuntimeMcp(name, command)) {
            excluded.push(name);
            continue;
        }
        const url = [raw.url, raw.httpUrl, raw.serverUrl].find((value) => typeof value === 'string');
        const portable = {};
        if (command)
            portable.command = command;
        if (Array.isArray(raw.args))
            portable.args = raw.args;
        if ((0, objects_1.isRecord)(raw.env))
            portable.env = normalizeEnvironment(raw.env);
        if (typeof raw.cwd === 'string')
            portable.cwd = raw.cwd;
        if (typeof url === 'string')
            portable.url = url;
        portable.transport = typeof raw.transport === 'string' ? raw.transport : typeof url === 'string' ? 'http' : 'stdio';
        const overrides = Object.fromEntries(Object.entries(raw).filter(([key]) => !PORTABLE_KEYS.has(key)));
        if (Object.keys(overrides).length > 0)
            surfaceOverrides[name] = overrides;
        servers[name] = portable;
    }
    return { servers, overrides: surfaceOverrides, excluded };
}
function toNativeMcpServers(input, surface, surfaceOverrides = {}) {
    return Object.fromEntries(Object.entries(input).flatMap(([name, raw]) => {
        if (!(0, objects_1.isRecord)(raw))
            return [];
        const native = {};
        if (typeof raw.command === 'string')
            native.command = raw.command;
        if (Array.isArray(raw.args))
            native.args = raw.args;
        if (typeof raw.cwd === 'string')
            native.cwd = raw.cwd;
        if (typeof raw.url === 'string')
            native[surface === 'antigravity' ? 'serverUrl' : 'url'] = raw.url;
        if ((0, objects_1.isRecord)(raw.env)) {
            if (surface === 'codex') {
                const literal = {};
                const forwarded = [];
                for (const [key, value] of Object.entries(raw.env)) {
                    const reference = parseEnvReference(value);
                    if (reference === key)
                        forwarded.push(key);
                    else
                        literal[key] = reference ? `$${reference}` : value;
                }
                if (Object.keys(literal).length > 0)
                    native.env = literal;
                if (forwarded.length > 0)
                    native.env_vars = forwarded;
            }
            else {
                native.env = Object.fromEntries(Object.entries(raw.env).map(([key, value]) => {
                    const reference = parseEnvReference(value);
                    return [key, reference ? `\${${reference}}` : value];
                }));
            }
        }
        if ((0, objects_1.isRecord)(raw.overrides) && (0, objects_1.isRecord)(raw.overrides[surface]))
            Object.assign(native, raw.overrides[surface]);
        if ((0, objects_1.isRecord)(surfaceOverrides[name]))
            Object.assign(native, convertOverrideReferences(surfaceOverrides[name], surface));
        return [[name, native]];
    }));
}
function convertOverrideReferences(value, surface) {
    if (Array.isArray(value))
        return value.map((entry) => convertOverrideReferences(entry, surface));
    if ((0, objects_1.isRecord)(value))
        return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, convertOverrideReferences(entry, surface)]));
    const reference = parseEnvReference(value);
    if (!reference)
        return value;
    return surface === 'codex' ? reference : `\${${reference}}`;
}
function normalizeEnvironment(env) {
    return Object.fromEntries(Object.entries(env).map(([key, value]) => {
        if (typeof value !== 'string')
            return [key, value];
        const match = value.match(/^\$\{?([A-Z][A-Z0-9_]*)\}?$/) ?? value.match(/^\$\{env:([A-Z][A-Z0-9_]*)\}$/);
        return [key, match ? `\${env:${match[1]}}` : value];
    }));
}
function parseEnvReference(value) {
    return typeof value === 'string' ? value.match(/^\$\{env:([A-Z][A-Z0-9_]*)\}$/)?.[1] : undefined;
}
function isRuntimeMcp(name, command) {
    if (/^(node_repl|browser-use|computer-use)$/i.test(name))
        return true;
    if (!command)
        return false;
    const normalized = command.replace(/\\/g, '/').toLowerCase();
    return /\/openai\/codex\/runtimes\//.test(normalized)
        || /\/(cache|tmp|runtime|runtimes)\//.test(normalized)
        || path.basename(normalized).startsWith('node_repl');
}
