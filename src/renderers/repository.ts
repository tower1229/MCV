import type {
  BindPlan,
  BindResult,
  InitPlan,
  InitResult,
  MigrationChange,
  MigrationPlan,
  MigrationResult,
  RepositoryReport,
  UnbindPlan,
  UnbindResult,
} from '../operations/repository.js';
import {
  fact,
  instructionActions,
  issueBlocks,
  status,
} from '../presentation/builders.js';
import type { PresentationBlock, PresentationDocument } from '../presentation/contracts.js';

export function renderRepositoryDocument(report: RepositoryReport): PresentationDocument {
  const details: PresentationBlock[] = [
    fact('Repository', report.repositoryPath ?? 'not bound', report.repositoryPath ? 'muted' : 'danger', 'path'),
    fact('Identity', report.repositoryId ?? 'unknown', 'muted', 'id'),
    fact('Schema', report.repositorySchemaVersion?.toString() ?? 'unknown', 'muted'),
    status(report.valid ? 'success' : 'danger', report.valid
      ? 'Repository is valid.'
      : 'Repository is not valid.'),
  ];
  if (report.git) {
    details.push(status(report.git.clean ? 'success' : 'attention', report.git.clean
      ? `Git is clean${report.git.branch ? ` on ${report.git.branch}` : ''}.`
      : `Git has ${report.git.uncommittedChanges} uncommitted change(s)${report.git.branch ? ` on ${report.git.branch}` : ''}.`));
  } else if (report.repositoryPath) {
    details.push(status('muted', 'Git is not enabled for this Repository.'));
  }
  details.push(...issueBlocks(report.issues));
  return document('repository', report.status, 'Repository Report', details, report.nextActions, 'progressive');
}

export function renderBindDocument(contract: BindPlan | BindResult): PresentationDocument {
  const details: PresentationBlock[] = [];
  if (contract.status === 'planned') {
    details.push(
      status(contract.readyToApply ? 'decision' : 'danger', contract.readyToApply
        ? 'Repository binding is ready for confirmation.'
        : 'Repository binding is blocked.'),
      fact('Repository', contract.repositoryPath ?? 'not bound', 'muted', 'path'),
      ...contract.changes.map((change) => fact('Binding', `${change.previousRepositoryPath ?? 'not bound'} -> ${change.repositoryPath ?? 'not bound'}`, 'attention', 'path')),
    );
  } else if (contract.status === 'succeeded') {
    details.push(status('success', `Bound this device to ${contract.repositoryPath}.`));
  } else {
    details.push(status('danger', 'Repository binding failed.'));
  }
  details.push(...issueBlocks(contract.issues));
  return document('bind', contract.status, contract.status === 'planned' ? 'Bind Plan' : 'Bind Result', details, contract.nextActions);
}

export function renderUnbindDocument(contract: UnbindPlan | UnbindResult): PresentationDocument {
  const details: PresentationBlock[] = [];
  if (contract.status === 'planned') {
    details.push(
      status(contract.readyToApply ? 'decision' : 'danger', contract.readyToApply
        ? 'Removing the local Repository binding requires confirmation.'
        : 'Repository unbind is blocked.'),
      fact('Repository', contract.repositoryPath ?? 'not bound', 'muted', 'path'),
    );
  } else if (contract.status === 'succeeded') {
    details.push(status('success', 'Removed the MCV Repository binding from this device.'));
  } else {
    details.push(status('danger', 'Repository unbind failed.'));
  }
  details.push(...issueBlocks(contract.issues));
  return document('unbind', contract.status, contract.status === 'planned' ? 'Unbind Plan' : 'Unbind Result', details, contract.nextActions);
}

export function renderInitDocument(contract: InitPlan | InitResult): PresentationDocument {
  const details: PresentationBlock[] = [];
  if (contract.status === 'planned') {
    details.push(
      status(contract.readyToApply ? 'decision' : 'danger', contract.readyToApply
        ? 'Repository initialization is ready for confirmation.'
        : 'Repository initialization is blocked.'),
      fact('Repository', contract.repositoryPath ?? 'not bound', 'muted', 'path'),
      ...contract.changes.map((change) => fact(change.kind, change.path ?? change.repositoryPath, change.kind === 'add' ? 'attention' : 'information', 'path')),
    );
  } else if (contract.status === 'succeeded') {
    details.push(status('success', `Initialized and bound MCV Repository at ${contract.repositoryPath}.`));
  } else {
    details.push(status('danger', 'Repository initialization failed.'));
  }
  details.push(...issueBlocks(contract.issues));
  return document('init', contract.status, contract.status === 'planned' ? 'Init Plan' : 'Init Result', details, contract.nextActions);
}

export function renderMigrationDocument(
  contract: MigrationPlan | MigrationResult,
): PresentationDocument {
  const details: PresentationBlock[] = [];
  if (contract.status === 'planned') {
    details.push(
      status(contract.readyToApply ? 'decision' : 'danger', contract.readyToApply
        ? 'Repository migration is ready for confirmation.'
        : 'Repository migration is blocked.'),
      fact('Repository', contract.repositoryPath ?? 'not bound', 'muted', 'path'),
      ...contract.changes.map(renderMigrationChange),
    );
  } else if (contract.status === 'succeeded') {
    details.push(
      status('success', `Migrated Repository to schema v${contract.data?.repositorySchemaVersion}.`),
      fact('Repository', contract.repositoryPath ?? 'not bound', 'muted', 'path'),
      fact('Verified backup', contract.data?.backupPath ?? 'unknown', 'muted', 'path'),
    );
  } else {
    details.push(status('danger', 'Repository migration failed.'));
  }
  details.push(...issueBlocks(contract.issues));
  return document('migrate', contract.status, contract.status === 'planned' ? 'Migration Plan' : 'Migration Result', details, contract.nextActions);
}

function renderMigrationChange(change: MigrationChange): PresentationBlock {
  if (change.kind === 'move') return fact('move', `${change.sourcePath} -> ${change.targetPath}`, 'attention', 'path');
  if (change.kind === 'scan') {
    return fact('scan Asset Catalog', change.assetIds?.join(', ') || '(empty catalog)', 'information', 'id');
  }
  if (change.before !== undefined && change.after !== undefined) {
    return fact(change.kind, `${change.path ?? change.id} · v${change.before} -> v${change.after}`, 'attention', change.path ? 'path' : 'id');
  }
  return fact(change.kind, change.path ?? change.id, change.kind === 'backup' ? 'information' : 'attention', change.path ? 'path' : 'id');
}

function document(
  operation: PresentationDocument['operation'],
  outcome: string,
  title: string,
  details: PresentationBlock[],
  nextActions: string[],
  detailPolicy: PresentationDocument['detailPolicy'] = 'overflow',
): PresentationDocument {
  return {
    operation,
    outcome,
    title,
    summary: detailPolicy === 'progressive' ? details : [],
    overflowSummary: details.slice(0, 4),
    details,
    nextActions: instructionActions(nextActions),
    detailPolicy,
  };
}
