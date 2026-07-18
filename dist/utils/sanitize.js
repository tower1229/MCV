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
exports.isSensitiveFile = isSensitiveFile;
exports.sanitizeConfig = sanitizeConfig;
const path = __importStar(require("path"));
const SENSITIVE_FIELD_PATTERN = /(secret|token|key|password|credential)/i;
const SENSITIVE_FILE_NAMES = new Set([
    '.env',
    'credentials.json',
    'credentials.yaml',
    'credentials.yml',
    'id_rsa',
    'id_ed25519',
]);
function isSensitiveFile(filePath) {
    const fileName = path.basename(filePath).toLowerCase();
    return SENSITIVE_FILE_NAMES.has(fileName)
        || fileName.startsWith('.env.')
        || fileName.endsWith('.pem')
        || fileName.endsWith('.key');
}
function sanitizeConfig(input, context) {
    let sensitiveFieldCount = 0;
    let parameterizedPathCount = 0;
    const visit = (value, fieldPath = []) => {
        if (Array.isArray(value)) {
            return value.map((child, index) => visit(child, [...fieldPath, String(index)]));
        }
        if (value !== null && typeof value === 'object') {
            return Object.fromEntries(Object.entries(value).map(([key, child]) => {
                if (SENSITIVE_FIELD_PATTERN.test(key)) {
                    sensitiveFieldCount += 1;
                    return [key, `\${env:${toEnvironmentName(key)}}`];
                }
                return [key, visit(child, [...fieldPath, key])];
            }));
        }
        if (typeof value === 'string') {
            const parameterized = parameterizeHomePath(value, context);
            parameterizedPathCount += parameterized.replacementCount;
            if (path.posix.isAbsolute(parameterized.value)
                || path.win32.isAbsolute(parameterized.value)) {
                parameterizedPathCount += 1;
                const readableName = toEnvironmentName(`MCV_${fieldPath.length > 0 ? fieldPath.join('_') : 'LOCAL'}_PATH`);
                const encodedPath = (fieldPath.length > 0 ? fieldPath : ['LOCAL'])
                    .map((segment) => Buffer.from(segment, 'utf8').toString('hex').toUpperCase())
                    .join('_');
                const variableName = `${readableName}_${encodedPath}`;
                return `\${env:${variableName}}`;
            }
            return parameterized.value;
        }
        return value;
    };
    return {
        value: visit(input),
        sensitiveFieldCount,
        parameterizedPathCount,
    };
}
function toEnvironmentName(fieldName) {
    return fieldName
        .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
        .replace(/[^a-zA-Z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .toUpperCase();
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
    const caseInsensitive = (context.platform ?? process.platform) === 'win32';
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
    return { value: result, replacementCount };
}
function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
