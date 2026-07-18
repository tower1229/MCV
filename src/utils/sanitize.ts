import * as path from 'path';
import type { DeviceContext } from '../adapters/types';

const SENSITIVE_FIELD_PATTERN = /(secret|token|key|password|credential)/i;
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
          if (SENSITIVE_FIELD_PATTERN.test(key)) {
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
        const readableName = toEnvironmentName(
          `MCV_${fieldPath.length > 0 ? fieldPath.join('_') : 'LOCAL'}_PATH`,
        );
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
    value: visit(input) as T,
    sensitiveFieldCount,
    parameterizedPathCount,
  };
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
  const caseInsensitive = (context.platform ?? process.platform) === 'win32';
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

  return { value: result, replacementCount };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
