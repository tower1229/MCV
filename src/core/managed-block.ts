import { createHash } from 'crypto';

const BEGIN_PREFIX = '<!-- mcv:begin ';
const END_PREFIX = '<!-- mcv:end ';
const MARKER_SUFFIX = ' -->';

export function formatManagedBlock(assetId: string, body: string): string {
  const normalized = normalizeBlockBody(body);
  return [
    `${BEGIN_PREFIX}${assetId}${MARKER_SUFFIX}`,
    normalized.replace(/\n$/, ''),
    `${END_PREFIX}${assetId}${MARKER_SUFFIX}`,
  ].join('\n');
}

export function upsertManagedBlock(
  existingContent: string | undefined,
  assetId: string,
  body: string,
): string {
  const block = formatManagedBlock(assetId, body);
  if (existingContent === undefined || existingContent.length === 0) {
    return `${block}\n`;
  }

  const range = findManagedBlockRange(existingContent, assetId);
  if (!range) {
    const separator = existingContent.endsWith('\n') ? '' : '\n';
    return `${existingContent}${separator}${block}\n`;
  }

  return (
    existingContent.slice(0, range.start)
    + block
    + existingContent.slice(range.end)
  );
}

export function extractManagedBlock(
  content: string,
  assetId: string,
): string | undefined {
  const range = findManagedBlockRange(content, assetId);
  if (!range) return undefined;
  const inner = content.slice(range.bodyStart, range.bodyEnd);
  return normalizeBlockBody(inner);
}

/** Remove an MCV Managed Block and keep surrounding file content. */
export function removeManagedBlock(content: string, assetId: string): string {
  const range = findManagedBlockRange(content, assetId);
  if (!range) return content;
  let before = content.slice(0, range.start);
  let after = content.slice(range.end);
  if (before.endsWith('\n') && after.startsWith('\n')) {
    after = after.slice(1);
  }
  return `${before}${after}`;
}

export function managedBlockDrifted(
  content: string,
  assetId: string,
  expectedBody: string,
): boolean {
  const current = extractManagedBlock(content, assetId);
  if (current === undefined) return false;
  return current !== normalizeBlockBody(expectedBody);
}

export function managedReceiptKey(relativePath: string, assetId: string): string {
  return `${relativePath.split(pathSep()).join('/')}#mcv:${assetId}`;
}

export function hashManagedBlockBody(body: string): string {
  return createHash('sha256').update(normalizeBlockBody(body), 'utf8').digest('hex');
}

function findManagedBlockRange(
  content: string,
  assetId: string,
): { start: number; end: number; bodyStart: number; bodyEnd: number } | undefined {
  const beginMarker = `${BEGIN_PREFIX}${assetId}${MARKER_SUFFIX}`;
  const endMarker = `${END_PREFIX}${assetId}${MARKER_SUFFIX}`;
  const start = content.indexOf(beginMarker);
  if (start < 0) return undefined;
  const afterBegin = start + beginMarker.length;
  const endMarkerIndex = content.indexOf(endMarker, afterBegin);
  if (endMarkerIndex < 0) return undefined;
  const end = endMarkerIndex + endMarker.length;
  const bodyStart = content[afterBegin] === '\n' ? afterBegin + 1 : afterBegin;
  const bodyEnd = endMarkerIndex > bodyStart && content[endMarkerIndex - 1] === '\n'
    ? endMarkerIndex - 1
    : endMarkerIndex;
  return { start, end, bodyStart, bodyEnd };
}

function normalizeBlockBody(body: string): string {
  return body.replace(/\r\n/g, '\n').replace(/([^\n])$/, '$1\n');
}

function pathSep(): string {
  return process.platform === 'win32' ? '\\' : '/';
}
