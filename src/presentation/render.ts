import stringWidth from 'string-width';
import type {
  PresentationBlock,
  PresentationDocument,
  PresentationRole,
  PresentationText,
} from './contracts.js';
import {
  PRESENTATION_THEME,
  stylePresentationText,
  type OutputCapability,
} from './theme.js';

export function renderPresentationDocument(
  document: PresentationDocument,
  region: 'summary' | 'overflowSummary' | 'details',
  capability: OutputCapability,
): string {
  const blocks = region === 'overflowSummary'
    ? document.overflowSummary ?? document.summary
    : document[region];
  return renderPresentationBlocks(blocks, capability);
}

export function renderPresentationBlocks(
  blocks: PresentationBlock[],
  capability: OutputCapability,
): string {
  return blocks.flatMap((block) => renderBlock(block, capability)).join('\n');
}

function renderBlock(block: PresentationBlock, capability: OutputCapability): string[] {
  switch (block.kind) {
    case 'status':
      return wrapLine(renderStatus(block.role, block.text, capability), capability);
    case 'fact':
      return wrapLine(
        `${stylePresentationText(block.label, 'information', capability)}  ${stylePresentationText(block.value, block.valueKind ? undefined : block.role, capability)}`,
        capability,
      );
    case 'paragraph':
      return wrapLine(renderTextParts(block.content, capability), capability);
    case 'list':
      return block.items.flatMap((item) => {
        const marker = item.selected === undefined ? '  ' : item.selected ? '[x]' : '[ ]';
        return wrapLine(`${marker} ${stylePresentationText(item.text, item.kind ? undefined : item.role, capability)}`, capability, marker.length + 1);
      });
    case 'literal':
      return block.text.split('\n');
    case 'diff':
      return block.lines.map((line) => stylePresentationText(
        line.text,
        line.kind === 'add' ? 'success' : line.kind === 'remove' ? 'danger' : line.kind === 'metadata' ? 'muted' : undefined,
        capability,
      ));
    case 'section':
      return [
        stylePresentationText(block.title, block.titleKind ? undefined : 'information', capability),
        ...block.blocks.flatMap((child) => renderBlock(child, capability).map((line) => `  ${line}`)),
      ];
    case 'spacer':
      return [''];
  }
}

function renderStatus(
  role: PresentationRole,
  text: string,
  capability: OutputCapability,
): string {
  const phrase = `${PRESENTATION_THEME[role].symbol} ${text}`;
  return stylePresentationText(phrase, role, capability);
}

function renderTextParts(
  content: PresentationText[],
  capability: OutputCapability,
): string {
  return content.map((part) => stylePresentationText(part.text, undefined, capability)).join('');
}

function wrapLine(
  line: string,
  capability: OutputCapability,
  hangingIndent = 2,
): string[] {
  const width = capability.columns;
  if (!width || width < 20 || stringWidth(line) <= width) return [line];
  const words = line.split(/(\s+)/u);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    if (current && stringWidth(current + word) > width) {
      lines.push(current.trimEnd());
      current = `${' '.repeat(hangingIndent)}${word.trimStart()}`;
    } else {
      current += word;
    }
  }
  if (current) lines.push(current.trimEnd());
  return lines;
}

export function escapeTerminalControls(value: string): string {
  let escaped = '';
  for (const character of value) {
    const codePoint = character.codePointAt(0)!;
    escaped += isForbiddenControl(codePoint) ? `\\u{${codePoint.toString(16).toUpperCase()}}` : character;
  }
  return escaped;
}

export function assertPlainTextSafe(value: string): void {
  for (const character of value) {
    const codePoint = character.codePointAt(0)!;
    if (isForbiddenControl(codePoint)) {
      throw new UnsafePresentationContentError(codePoint, escapeTerminalControls(value));
    }
  }
}

function isForbiddenControl(codePoint: number): boolean {
  return (codePoint < 0x20 && codePoint !== 0x09 && codePoint !== 0x0a)
    || codePoint === 0x7f
    || (codePoint >= 0x80 && codePoint <= 0x9f);
}

export class UnsafePresentationContentError extends Error {
  readonly fallback: string;

  constructor(codePoint: number, fallback: string) {
    super(`Review content contains forbidden control U+${codePoint.toString(16).toUpperCase().padStart(4, '0')}.`);
    this.name = 'UnsafePresentationContentError';
    this.fallback = fallback;
  }
}
