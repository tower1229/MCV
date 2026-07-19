import * as yaml from 'yaml';
import { parse as parseToml, stringify as stringifyToml } from 'smol-toml';
import { isRecord, mergeRecords } from './objects';

export type StructuredFormat = 'json' | 'yaml' | 'toml';

export function parseStructuredObject(
  content: string,
  format: StructuredFormat,
  label: string,
): Record<string, unknown> {
  const parsed: unknown = format === 'json'
    ? JSON.parse(content)
    : format === 'yaml'
      ? yaml.parse(content)
      : parseToml(content);
  if (!isRecord(parsed)) {
    throw new Error(`${label} must contain a ${format.toUpperCase()} object.`);
  }
  return parsed;
}

export function stringifyStructuredObject(
  value: Record<string, unknown>,
  format: StructuredFormat,
): string {
  if (format === 'json') return `${JSON.stringify(value, null, 2)}\n`;
  if (format === 'yaml') return yaml.stringify(value);
  return stringifyToml(value as Parameters<typeof stringifyToml>[0]);
}

export function splitOwnedFields(
  value: Record<string, unknown>,
  managedPaths: readonly string[],
  localPaths: readonly string[],
): {
  native: Record<string, unknown>;
  managed: Array<{ path: string; value: unknown }>;
} {
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

export function mergeStructuredOverlay(
  existing: Record<string, unknown>,
  native: Record<string, unknown>,
  managed: Record<string, unknown> | undefined,
  managedPaths: readonly string[],
): Record<string, unknown> {
  const merged = mergeRecords(existing, native);
  for (const objectPath of managedPaths) {
    const field = managed
      ? getObjectPath(managed, objectPath)
      : { found: false };
    if (field.found) {
      setObjectPath(merged, objectPath, field.value);
    } else {
      deleteObjectPath(merged, objectPath);
    }
  }
  return merged;
}

function getObjectPath(
  value: Record<string, unknown>,
  objectPath: string,
): { found: boolean; value?: unknown } {
  let current: unknown = value;
  for (const segment of parseObjectPath(objectPath)) {
    if (!isRecord(current) || !(segment in current)) return { found: false };
    current = current[segment];
  }
  return { found: true, value: current };
}

function setObjectPath(
  value: Record<string, unknown>,
  objectPath: string,
  fieldValue: unknown,
): void {
  const segments = parseObjectPath(objectPath);
  let current = value;
  for (const segment of segments.slice(0, -1)) {
    const next = current[segment];
    if (!isRecord(next)) current[segment] = {};
    current = current[segment] as Record<string, unknown>;
  }
  current[segments.at(-1)!] = fieldValue;
}

function deleteObjectPath(
  value: Record<string, unknown>,
  objectPath: string,
): void {
  const segments = parseObjectPath(objectPath);
  const parents: Array<{ value: Record<string, unknown>; key: string }> = [];
  let current = value;
  for (const segment of segments.slice(0, -1)) {
    const next = current[segment];
    if (!isRecord(next)) return;
    parents.push({ value: current, key: segment });
    current = next;
  }
  delete current[segments.at(-1)!];
  for (const parent of parents.reverse()) {
    const child = parent.value[parent.key];
    if (isRecord(child) && Object.keys(child).length === 0) {
      delete parent.value[parent.key];
    } else {
      break;
    }
  }
}

function parseObjectPath(objectPath: string): string[] {
  if (!/^\$\.[^.]+(?:\.[^.]+)*$/.test(objectPath)) {
    throw new Error(`Unsupported object path: ${objectPath}`);
  }
  return objectPath.slice(2).split('.');
}

function cloneRecord(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).map(([key, field]) => [key, cloneValue(field)]),
  );
}

function cloneValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(cloneValue);
  if (isRecord(value)) return cloneRecord(value);
  if (value instanceof Date) return new Date(value);
  return value;
}
