import type { IdeId } from '../adapters/types.js';

const NATIVE_TARGETS = new Set<IdeId>(['codex', 'claude-code', 'gemini']);
const SLUG = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
const FILE_ID = /^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/;

export type AssetIdParts =
  | { type: 'instruction'; target: IdeId }
  | { type: 'skill'; name: string }
  | { type: 'mcp'; name: string }
  | { type: 'native'; target: IdeId; fileId: string };

export function formatAssetId(parts: AssetIdParts): string {
  switch (parts.type) {
    case 'instruction':
      return `instruction:${parts.target}`;
    case 'skill':
      return `skill:${parts.name}`;
    case 'mcp':
      return `mcp:${parts.name}`;
    case 'native':
      return `native:${parts.target}/${parts.fileId}`;
  }
}

export function isValidAssetId(id: string): boolean {
  try {
    parseAssetId(id);
    return true;
  } catch {
    return false;
  }
}

export function parseAssetId(id: string): AssetIdParts {
  if (typeof id !== 'string' || id.length === 0) {
    throw new Error(`Invalid Asset ID: ${JSON.stringify(id)}`);
  }
  if (id.startsWith('instruction:')) {
    const target = id.slice('instruction:'.length);
    if (!NATIVE_TARGETS.has(target as IdeId)) throw new Error(`Invalid Asset ID: ${id}`);
    return { type: 'instruction', target: target as IdeId };
  }

  if (id.startsWith('skill:')) {
    const name = id.slice('skill:'.length);
    if (!isSafeSlug(name)) throw new Error(`Invalid Asset ID: ${id}`);
    return { type: 'skill', name };
  }

  if (id.startsWith('mcp:')) {
    const name = id.slice('mcp:'.length);
    if (!isSafeSlug(name)) throw new Error(`Invalid Asset ID: ${id}`);
    return { type: 'mcp', name };
  }

  if (id.startsWith('native:')) {
    const rest = id.slice('native:'.length);
    const slash = rest.indexOf('/');
    if (slash <= 0 || slash === rest.length - 1) {
      throw new Error(`Invalid Asset ID: ${id}`);
    }
    const target = rest.slice(0, slash);
    const fileId = rest.slice(slash + 1);
    if (!NATIVE_TARGETS.has(target as IdeId) || !isSafeFileId(fileId)) {
      throw new Error(`Invalid Asset ID: ${id}`);
    }
    return { type: 'native', target: target as IdeId, fileId };
  }

  throw new Error(`Invalid Asset ID: ${id}`);
}

function isSafeSlug(value: string): boolean {
  return SLUG.test(value) && !value.includes('/') && !value.includes('\\') && !value.includes('..');
}

function isSafeFileId(value: string): boolean {
  return FILE_ID.test(value)
    && !value.includes('/')
    && !value.includes('\\')
    && !value.includes('..')
    && !value.includes(' ');
}
