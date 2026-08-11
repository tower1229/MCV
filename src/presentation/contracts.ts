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
  role?: PresentationRole;
}

export type PresentationBlock =
  | { kind: 'status'; role: PresentationRole; text: string }
  | { kind: 'fact'; label: string; value: string; role?: PresentationRole }
  | { kind: 'paragraph'; content: PresentationText[]; role?: PresentationRole }
  | { kind: 'list'; items: Array<PresentationText & { selected?: boolean }> }
  | { kind: 'literal'; text: string }
  | { kind: 'diff'; lines: Array<{ kind: 'metadata' | 'context' | 'add' | 'remove'; text: string }> }
  | { kind: 'section'; title: string; blocks: PresentationBlock[] }
  | { kind: 'spacer' };

export interface PresentationDocument {
  operation: OperationName;
  title: string;
  summary: PresentationBlock[];
  overflowSummary?: PresentationBlock[];
  details: PresentationBlock[];
  nextActions: string[];
  detailPolicy: 'review' | 'overflow' | 'progressive';
}

export interface PresentationResult {
  reviewPath?: string;
}

export interface PresentationOptions {
  verbose?: boolean;
}
