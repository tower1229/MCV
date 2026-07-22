import * as path from 'path';
import type { DeviceContext } from '../adapters/types';

const SENSITIVE_FIELD_PATTERN = /(secret|token|password|credential|api[_-]?key|access[_-]?key|private[_-]?key|client[_-]?key|\.key$)/i;
const REFERENCE_FIELD_PATTERN = /(env_var|env_vars|variable|reference)$/i;
const SENSITIVE_FILE_NAMES = new Set([
  '.env',
  'credentials.json',
  'credentials.yaml',
  'credentials.yml',
  'id_rsa',
  'id_ed25519',
]);

export interface SanitizedConfig<T> {
  value: T;
  sensitiveFieldCount: number;
  parameterizedPathCount: number;
}

export function isSensitiveFile(filePath: string): boolean {
  const fileName = path.basename(filePath).toLowerCase();
  return SENSITIVE_FILE_NAMES.has(fileName)
    || fileName.startsWith('.env.')
    || fileName.endsWith('.pem')
    || fileName.endsWith('.key');
}

export function sanitizeConfig<T>(
  input: T,
  context: DeviceContext,
): SanitizedConfig<T> {
  let sensitiveFieldCount = 0;
  let parameterizedPathCount = 0;

  const visit = (value: unknown, fieldPath: string[] = []): unknown => {
    if (Array.isArray(value)) {
      return value.map((child, index) => visit(child, [...fieldPath, String(index)]));
    }

    if (value !== null && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value).map(([key, child]) => {
          if (SENSITIVE_FIELD_PATTERN.test(key) && !REFERENCE_FIELD_PATTERN.test(key)) {
            sensitiveFieldCount += 1;
            return [key, `\${env:${toEnvironmentName(key)}}`];
          }
          return [key, visit(child, [...fieldPath, key])];
        }),
      );
    }

    if (typeof value === 'string') {
      const parameterized = parameterizeHomePath(value, context);
      parameterizedPathCount += parameterized.replacementCount;
      if (
        path.posix.isAbsolute(parameterized.value)
        || path.win32.isAbsolute(parameterized.value)
      ) {
        parameterizedPathCount += 1;
        return parameterized.value;
      }
      return parameterized.value;
    }

    return value;
  };

  return {
    value: visit(input) as T,
    sensitiveFieldCount,
    parameterizedPathCount,
  };
}

export function scanTextForSecrets(content: string): string[] {
  const findings: string[] = [];
  const patterns: Array<[string, RegExp]> = [
    ['private-key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
    ['github-token', /\b(?:ghp|github_pat)_[A-Za-z0-9_]{20,}\b/],
    ['openai-key', /\bsk-[A-Za-z0-9_-]{20,}\b/],
    ['google-key', /\bAIza[A-Za-z0-9_-]{20,}\b/],
    ['aws-key', /\bAKIA[0-9A-Z]{16}\b/],
  ];
  for (const [name, pattern] of patterns) if (pattern.test(content)) findings.push(name);
  return findings;
}

function toEnvironmentName(fieldName: string): string {
  return fieldName
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase();
}

function parameterizeHomePath(
  value: string,
  context: DeviceContext,
): { value: string; replacementCount: number } {
  const replacements = Object.entries({
    HOME: context.homeDir,
    ...context.variables,
  }).flatMap(([name, absolutePath]) =>
    [...new Set([
      absolutePath,
      absolutePath.replace(/\\/g, '/'),
      absolutePath.replace(/\//g, '\\'),
    ])].map((variant) => ({ name, absolutePath: variant })),
  );
  const caseInsensitive = context.platform === 'win32';
  let result = value;
  let replacementCount = 0;

  for (const replacement of replacements.sort(
    (left, right) => right.absolutePath.length - left.absolutePath.length,
  )) {
    if (!replacement.absolutePath) continue;
    const expression = new RegExp(
      `${escapeRegExp(replacement.absolutePath)}(?=$|[\\\\/])`,
      caseInsensitive ? 'gi' : 'g',
    );
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

function normalizePortableSeparators(value: string, platform: NodeJS.Platform): string {
  const uris: string[] = [];
  const protectedValue = value.replace(/[a-zA-Z][a-zA-Z0-9+.-]*:\/\/\S+/g, (uri) => {
    const token = `\uE000MCV_URI_${uris.length}\uE001`;
    uris.push(uri);
    return token;
  });
  const normalized = platform === 'win32'
    ? protectedValue.replace(/\//g, '\\')
    : protectedValue.replace(/\\/g, '/');
  return normalized.replace(
    /\uE000MCV_URI_(\d+)\uE001/g,
    (_token, index: string) => uris[Number(index)],
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
