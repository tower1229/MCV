import { isRecord } from './objects';

export function resolvePortableValue(
  value: unknown,
  variables: Record<string, string>,
  platform: NodeJS.Platform,
): unknown {
  if (typeof value === 'string') {
    return resolvePortableVariables(value, variables, platform);
  }
  if (Array.isArray(value)) {
    return value.map((item) => resolvePortableValue(item, variables, platform));
  }
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [
        key,
        resolvePortableValue(child, variables, platform),
      ]),
    );
  }
  return value;
}

export function resolveVariableDefinitions(
  definitions: Record<string, string>,
  deviceValues: Record<string, string>,
  platform: NodeJS.Platform,
): Record<string, string> {
  const resolved = { ...deviceValues };
  const resolving = new Set<string>();

  const resolveName = (name: string): string => {
    const existing = resolved[name];
    if (existing !== undefined) return existing;
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

  for (const name of Object.keys(definitions)) resolveName(name);
  return resolved;
}

function resolvePortableVariables(
  content: string,
  variables: Record<string, string>,
  platform: NodeJS.Platform,
): string {
  return replacePortableReferences(
    content,
    (name) => {
      const value = variables[name];
      if (value === undefined) {
        throw new Error(`Missing value for portable variable \${${name}}.`);
      }
      return value;
    },
    platform,
  );
}

function replacePortableReferences(
  content: string,
  resolveName: (name: string) => string,
  platform: NodeJS.Platform,
): string {
  let isPath = false;
  const resolved = content.replace(
    /\$\{([A-Z][A-Z0-9_]*)\}([\\/])?/g,
    (_reference, name: string, separator: string | undefined) => {
      const value = resolveName(name);
      isPath ||= separator !== undefined;
      return separator === undefined
        ? value
        : `${value}${platform === 'win32' ? '\\' : '/'}`;
    },
  );
  if (!isPath) return resolved;
  const uris: string[] = [];
  const protectedValue = resolved.replace(
    /[a-zA-Z][a-zA-Z0-9+.-]*:\/\/\S+/g,
    (uri) => {
      const token = `\uE000MCV_URI_${uris.length}\uE001`;
      uris.push(uri);
      return token;
    },
  );
  const normalized = platform === 'win32'
    ? protectedValue.replace(/\//g, '\\')
    : protectedValue.replace(/\\/g, '/');
  return normalized.replace(
    /\uE000MCV_URI_(\d+)\uE001/g,
    (_token, index: string) => uris[Number(index)],
  );
}
