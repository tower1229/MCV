export const OPERATION_SCHEMA_VERSION = 1 as const;

export type IssueSeverity =
  | 'notice'
  | 'warning'
  | 'decisionRequired'
  | 'error';

export interface Issue {
  severity: IssueSeverity;
  code: string;
  message: string;
  details?: string;
}

export type OperationStatus =
  | 'reported'
  | 'planned'
  | 'succeeded'
  | 'blocked'
  | 'failed';

export interface OperationContract {
  schemaVersion: typeof OPERATION_SCHEMA_VERSION;
  operation: string;
  status: OperationStatus;
  issues: Issue[];
  nextActions: string[];
}

export interface Report extends OperationContract {
  status: 'reported';
  ready: boolean;
}

export interface Plan<TChange = unknown> extends OperationContract {
  status: 'planned' | 'blocked';
  operationId: string;
  readyToApply: boolean;
  changes: TChange[];
  preconditions: Record<string, string>;
}

export interface Result<TData = unknown> extends OperationContract {
  status: 'succeeded' | 'failed';
  data?: TData;
  error?: McvError;
}

export interface McvError {
  code: string;
  message: string;
  technicalDetails?: string;
  nextActions: string[];
}

