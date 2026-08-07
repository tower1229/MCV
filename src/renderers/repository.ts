import type {
  BindPlan,
  BindResult,
  InitPlan,
  InitResult,
  MigrationPlan,
  MigrationResult,
  RepositoryReport,
  UnbindPlan,
  UnbindResult,
} from '../operations/repository.js';
import { renderIssuePlain, styleText } from './color.js';

export function renderRepositoryPlain(report: RepositoryReport): string[] {
  const lines = [
    `Repository: ${report.repositoryPath ?? 'not bound'}`,
    `Repository ID: ${report.repositoryId ?? 'unknown'}`,
    `Schema version: ${report.repositorySchemaVersion ?? 'unknown'}`,
    `Validity: ${report.valid ? styleText('valid', 'green') : styleText('invalid', 'red')}`,
  ];
  if (report.git) {
    lines.push(
      `Git: ${report.git.clean ? styleText('clean', 'green') : styleText('dirty', 'yellow')}${report.git.branch ? ` (${report.git.branch})` : ''}`,
    );
  }
  return appendIssuesAndActions(lines, report);
}

export function renderBindPlain(contract: BindPlan | BindResult): string[] {
  if (contract.status === 'planned') {
    return appendIssuesAndActions([
      `Bind Plan: ${contract.repositoryPath}`,
      ...contract.changes.map((change) =>
        `[${change.kind}] ${change.previousRepositoryPath ?? 'not bound'} -> ${change.repositoryPath}`),
    ], contract);
  }
  if (contract.status === 'succeeded') {
    return [`Bound this device to ${contract.repositoryPath}.`];
  }
  return appendIssuesAndActions([], contract);
}

export function renderUnbindPlain(contract: UnbindPlan | UnbindResult): string[] {
  if (contract.status === 'planned') {
    return appendIssuesAndActions([
      `Unbind Plan: ${contract.repositoryPath ?? 'not bound'}`,
      ...contract.changes.map((change) =>
        `[${change.kind}] ${change.previousRepositoryPath ?? 'not bound'}`),
    ], contract);
  }
  if (contract.status !== 'succeeded') return appendIssuesAndActions([], contract);
  return appendIssuesAndActions(
    ['Removed the MCV Repository binding from this device.'],
    contract,
  );
}

export function renderInitPlain(contract: InitPlan | InitResult): string[] {
  if (contract.status === 'planned') {
    const lines = [
      `Init Plan: ${contract.repositoryPath}`,
      ...contract.changes.map((change) => `[${change.kind}] ${change.path ?? change.repositoryPath}`),
    ];
    return appendIssuesAndActions(lines, contract);
  }
  if (contract.status === 'succeeded') {
    return [`Initialized and bound MCV Repository at ${contract.repositoryPath}.`];
  }
  return appendIssuesAndActions([], contract);
}

export function renderMigrationPlain(contract: MigrationPlan | MigrationResult): string[] {
  if (contract.status === 'planned') {
    const lines = [
      `Migration Plan: ${contract.repositoryPath}`,
      ...contract.changes.map((change) => {
        if (change.kind === 'move') return `[move] ${change.sourcePath} -> ${change.targetPath}`;
        if (change.kind === 'scan') {
          const assets = change.assetIds?.length
            ? change.assetIds.join(', ')
            : '(empty catalog)';
          return `[scan] Asset Catalog: ${assets}`;
        }
        if (change.id === 'schema-version') {
          return `[modify] ${change.path}: schema v${change.before} -> v${change.after}`;
        }
        if (change.id === 'device-state') {
          return `[modify] device state schema v${change.before} -> v${change.after}`;
        }
        if (change.id === 'repository-profiles') {
          const assets = change.assetIds?.length
            ? change.assetIds.join(', ')
            : '(empty)';
          return `[add] ${change.path} (global: ${assets})`;
        }
        return `[${change.kind}] ${change.path}`;
      }),
    ];
    return appendIssuesAndActions(lines, contract);
  }
  if (contract.status === 'succeeded') {
    return [
      `Migrated Repository at ${contract.repositoryPath} to schema v${contract.data?.repositorySchemaVersion}.`,
      `Verified backup: ${contract.data?.backupPath}`,
    ];
  }
  return appendIssuesAndActions([], contract);
}

function appendIssuesAndActions(
  lines: string[],
  contract: Pick<
    RepositoryReport | BindPlan | BindResult | UnbindPlan | UnbindResult
      | InitPlan | InitResult | MigrationPlan | MigrationResult,
    'issues' | 'nextActions'
  >,
): string[] {
  return [
    ...lines,
    ...contract.issues.map(renderIssuePlain),
    ...contract.nextActions.map((action) => `Next: ${action}`),
  ];
}
