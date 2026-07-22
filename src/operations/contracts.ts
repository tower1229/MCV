export const OPERATION_SCHEMA_VERSION = 1 as const;

export type OperationName =
  | 'discover'
  | 'repository'
  | 'init'
  | 'bind'
  | 'unbind'
  | 'migrate'
  | 'capture'
  | 'deploy'
  | 'status'
  | 'restore';

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

export interface McvError {
  code: string;
  message: string;
  technicalDetails?: string;
  nextActions: string[];
}

export interface OperationContract<TChange = unknown> {
  schemaVersion: typeof OPERATION_SCHEMA_VERSION;
  operation: OperationName;
  repositoryPath: string | null;
  changes: TChange[];
  issues: Issue[];
  nextActions: string[];
}

export type Report<TChange = unknown> = OperationContract<TChange> & (
  | {
    status: 'reported';
    ready: boolean;
    error?: never;
  }
  | {
    status: 'failed';
    ready: false;
    error: McvError;
  }
);

interface PlanContract<TChange> extends OperationContract<TChange> {
  operationId: string;
  preconditions: Record<string, string>;
}

export type Plan<TChange = unknown> = PlanContract<TChange> & (
  | {
    status: 'planned';
    readyToApply: boolean;
    error?: never;
  }
  | {
    status: 'failed';
    readyToApply: false;
    error: McvError;
  }
);

export type Result<TData = unknown, TChange = unknown> = OperationContract<TChange> & (
  | {
    status: 'succeeded';
    data?: TData;
    error?: never;
  }
  | {
    status: 'blocked';
    data?: never;
    error?: never;
  }
  | {
    status: 'failed';
    data?: never;
    error: McvError;
  }
);
