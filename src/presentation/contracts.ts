import type { OperationName } from '../operations/contracts.js';

export type PresentationRole =
  | 'success'
  | 'attention'
  | 'decision'
  | 'danger'
  | 'information'
  | 'muted';

export interface PresentationText {
  text: string;
  kind?: 'text' | 'path' | 'command' | 'id';
}

export interface PresentationNextAction {
  kind: 'instruction' | 'command';
  text: string;
}

export type PresentationBlock =
  | { kind: 'status'; role: PresentationRole; text: string }
  | { kind: 'fact'; label: string; value: string; role?: PresentationRole; valueKind?: PresentationText['kind'] }
  | { kind: 'paragraph'; content: PresentationText[] }
  | { kind: 'list'; items: Array<PresentationText & { selected?: boolean; role?: PresentationRole }> }
  | { kind: 'literal'; text: string }
  | { kind: 'diff'; lines: Array<{ kind: 'metadata' | 'context' | 'add' | 'remove'; text: string }> }
  | { kind: 'section'; title: string; titleKind?: PresentationText['kind']; blocks: PresentationBlock[] }
  | { kind: 'spacer' };

export interface PresentationDocument {
  operation: OperationName;
  outcome: string;
  title: string;
  summary: PresentationBlock[];
  overflowSummary?: PresentationBlock[];
  details: PresentationBlock[];
  nextActions: PresentationNextAction[];
  detailPolicy: 'review' | 'overflow' | 'progressive';
}

export interface PresentationResult {
  reviewPath?: string;
}

export interface PresentationOptions {
  verbose?: boolean;
}
