import type {
  BindResult,
  RepositoryReport,
  UnbindResult,
} from '../operations/repository';

export function renderRepositoryPlain(report: RepositoryReport): string[] {
  const lines = [
    `Repository: ${report.repositoryPath ?? 'not bound'}`,
    `Repository ID: ${report.repositoryId ?? 'unknown'}`,
    `Schema version: ${report.repositorySchemaVersion ?? 'unknown'}`,
    `Validity: ${report.valid ? 'valid' : 'invalid'}`,
  ];
  if (report.git) {
    lines.push(
      `Git: ${report.git.clean ? 'clean' : 'dirty'}${report.git.branch ? ` (${report.git.branch})` : ''}`,
    );
  }
  return appendIssuesAndActions(lines, report);
}

export function renderBindPlain(result: BindResult): string[] {
  if (result.status === 'succeeded') {
    return [`Bound this device to ${result.repositoryPath}.`];
  }
  return appendIssuesAndActions([], result);
}

export function renderUnbindPlain(result: UnbindResult): string[] {
  return appendIssuesAndActions(
    ['Removed the MCV Repository binding from this device.'],
    result,
  );
}

function appendIssuesAndActions(
  lines: string[],
  contract: Pick<RepositoryReport, 'issues' | 'nextActions'>,
): string[] {
  return [
    ...lines,
    ...contract.issues.map((issue) => `[${issue.severity}] ${issue.code}: ${issue.message}`),
    ...contract.nextActions.map((action) => `Next: ${action}`),
  ];
}
