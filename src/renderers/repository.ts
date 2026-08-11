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
  issueBlocks,
  paragraph,
  status,
} from '../presentation/builders.js';
import type { PresentationBlock, PresentationDocument } from '../presentation/contracts.js';

export function renderRepositoryDocument(report: RepositoryReport): PresentationDocument {
  const details: PresentationBlock[] = [
    fact('Repository', report.repositoryPath ?? 'not bound', report.repositoryPath ? 'muted' : 'danger'),
    fact('Identity', report.repositoryId ?? 'unknown', 'muted'),
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
  return document('repository', 'Repository Report', details, report.nextActions, 'progressive');
}

export function renderBindDocument(contract: BindPlan | BindResult): PresentationDocument {
  const details: PresentationBlock[] = [];
  if (contract.status === 'planned') {
    details.push(
      status(contract.readyToApply ? 'decision' : 'danger', contract.readyToApply
        ? 'Repository binding is ready for confirmation.'
        : 'Repository binding is blocked.'),
      fact('Repository', contract.repositoryPath ?? 'not bound', 'muted'),
      ...contract.changes.map((change) => paragraph(
        `${change.previousRepositoryPath ?? 'not bound'} -> ${change.repositoryPath ?? 'not bound'}`,
        'attention',
      )),
    );
  } else if (contract.status === 'succeeded') {
    details.push(status('success', `Bound this device to ${contract.repositoryPath}.`));
  } else {
    details.push(status('danger', 'Repository binding failed.'));
  }
  details.push(...issueBlocks(contract.issues));
  return document('bind', contract.status === 'planned' ? 'Bind Plan' : 'Bind Result', details, contract.nextActions);
}

export function renderUnbindDocument(contract: UnbindPlan | UnbindResult): PresentationDocument {
  const details: PresentationBlock[] = [];
  if (contract.status === 'planned') {
    details.push(
      status(contract.readyToApply ? 'decision' : 'danger', contract.readyToApply
        ? 'Removing the local Repository binding requires confirmation.'
        : 'Repository unbind is blocked.'),
      fact('Repository', contract.repositoryPath ?? 'not bound', 'muted'),
    );
  } else if (contract.status === 'succeeded') {
    details.push(status('success', 'Removed the MCV Repository binding from this device.'));
  } else {
    details.push(status('danger', 'Repository unbind failed.'));
  }
  details.push(...issueBlocks(contract.issues));
  return document('unbind', contract.status === 'planned' ? 'Unbind Plan' : 'Unbind Result', details, contract.nextActions);
}

export function renderInitDocument(contract: InitPlan | InitResult): PresentationDocument {
  const details: PresentationBlock[] = [];
  if (contract.status === 'planned') {
    details.push(
      status(contract.readyToApply ? 'decision' : 'danger', contract.readyToApply
        ? 'Repository initialization is ready for confirmation.'
        : 'Repository initialization is blocked.'),
      fact('Repository', contract.repositoryPath ?? 'not bound', 'muted'),
      ...contract.changes.map((change) => paragraph(
        `${change.kind}: ${change.path ?? change.repositoryPath}`,
        change.kind === 'add' ? 'attention' : 'information',
      )),
    );
  } else if (contract.status === 'succeeded') {
    details.push(status('success', `Initialized and bound MCV Repository at ${contract.repositoryPath}.`));
  } else {
    details.push(status('danger', 'Repository initialization failed.'));
  }
  details.push(...issueBlocks(contract.issues));
  return document('init', contract.status === 'planned' ? 'Init Plan' : 'Init Result', details, contract.nextActions);
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
      fact('Repository', contract.repositoryPath ?? 'not bound', 'muted'),
      ...contract.changes.map(renderMigrationChange),
    );
  } else if (contract.status === 'succeeded') {
    details.push(
      status('success', `Migrated Repository to schema v${contract.data?.repositorySchemaVersion}.`),
      fact('Repository', contract.repositoryPath ?? 'not bound', 'muted'),
      fact('Verified backup', contract.data?.backupPath ?? 'unknown', 'muted'),
    );
  } else {
    details.push(status('danger', 'Repository migration failed.'));
  }
  details.push(...issueBlocks(contract.issues));
  return document('migrate', contract.status === 'planned' ? 'Migration Plan' : 'Migration Result', details, contract.nextActions);
}

function renderMigrationChange(change: MigrationChange): PresentationBlock {
  if (change.kind === 'move') return paragraph(`move: ${change.sourcePath} -> ${change.targetPath}`, 'attention');
  if (change.kind === 'scan') {
    return paragraph(`scan Asset Catalog: ${change.assetIds?.join(', ') || '(empty catalog)'}`, 'information');
  }
  if (change.before !== undefined && change.after !== undefined) {
    return paragraph(`${change.kind}: ${change.path ?? change.id} · v${change.before} -> v${change.after}`, 'attention');
  }
  return paragraph(`${change.kind}: ${change.path ?? change.id}`, change.kind === 'backup' ? 'information' : 'attention');
}

function document(
  operation: PresentationDocument['operation'],
  title: string,
  details: PresentationBlock[],
  nextActions: string[],
  detailPolicy: PresentationDocument['detailPolicy'] = 'overflow',
): PresentationDocument {
  return {
    operation,
    title,
    summary: detailPolicy === 'progressive' ? details : [],
    overflowSummary: details.slice(0, 4),
    details,
    nextActions,
    detailPolicy,
  };
}
