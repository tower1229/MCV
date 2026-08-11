import type { RestorePlan, RestoreResult } from '../operations/restore.js';
import type { PresentationBlock, PresentationDocument, PresentationRole } from '../presentation/contracts.js';
import { fact, instruction, instructionActions, issueBlocks, paragraph, status } from '../presentation/builders.js';
import { restoreLayoutLabel } from './restore-layout.js';

export function renderRestorePlanDocument(plan: RestorePlan): PresentationDocument {
  const restoreCount = plan.changes.filter((change) => change.action === 'restore').length;
  const deleteCount = plan.changes.length - restoreCount;
  const summary: PresentationBlock[] = [
    paragraph('Restore Plan: latest complete deployment backup'),
    status(plan.status === 'failed' ? 'danger' : deleteCount > 0 ? 'decision' : 'information',
      plan.status === 'failed' ? 'Restore Plan failed.' : 'Restore Plan uses the latest complete deployment backup.'),
    ...(plan.backup ? [fact('Backup time', plan.backup.createdAt, 'muted')] : []),
    fact('Changes', `${restoreCount} restore, ${deleteCount} delete`, deleteCount > 0 ? 'danger' : 'information'),
    ...(deleteCount > 0 ? [status('danger', `${deleteCount} deletion(s) selected by Restore.`)] : []),
    ...issueBlocks(plan.issues),
  ];
  if (plan.status === 'failed') summary.push(status('danger', plan.error.message));
  return {
    operation: 'restore',
    outcome: plan.status,
    title: 'Restore Plan',
    summary,
    details: restorePlanDetails(plan),
    nextActions: [
      ...(plan.changes.length > 0 ? [instruction('Review every affected path before confirming Restore.')] : []),
      ...instructionActions(plan.nextActions),
    ],
    detailPolicy: 'review',
  };
}

function restorePlanDetails(plan: RestorePlan): PresentationBlock[] {
  const blocks: PresentationBlock[] = [status('information', 'Latest complete deployment backup')];
  if (plan.backup) blocks.push(fact('Backup time', plan.backup.createdAt, 'muted'));
  for (const change of plan.changes) {
    const role: PresentationRole = change.action === 'delete' ? 'danger' : 'attention';
    blocks.push(fact(change.action, `${change.targetPath} [${restoreLayoutLabel(change.layoutKind, change.nodeKind)}]`, role, 'path'));
    if (change.linkTarget) blocks.push(fact('Link', `${change.targetPath} -> ${change.linkTarget}`, 'muted', 'path'));
  }
  const restoreCount = plan.changes.filter((change) => change.action === 'restore').length;
  const deleteCount = plan.changes.length - restoreCount;
  blocks.push(
    fact('Summary', `${restoreCount} restore · ${deleteCount} delete`, deleteCount > 0 ? 'danger' : 'information'),
    fact('Managed-link projections', String(plan.changes.filter((change) => change.layoutKind === 'managed-link-projection').length), 'muted'),
    fact('Physical packages', String(plan.changes.filter((change) => change.layoutKind === 'physical-package').length), 'muted'),
    ...issueBlocks(plan.issues),
  );
  if (plan.status === 'failed') {
    blocks.push(status('danger', plan.error.message));
    if (plan.error.technicalDetails) blocks.push({ kind: 'literal', text: plan.error.technicalDetails });
  }
  return blocks;
}

export function renderRestoreResultDocument(result: RestoreResult): PresentationDocument {
  const applied = result.data?.appliedChangeIds.length ?? 0;
  const details: PresentationBlock[] = result.status === 'succeeded'
    ? [
        status('success', `Restored ${applied} change(s) from the latest backup.`),
        fact('Pre-restore backup', result.data?.backupPath ?? 'not available', 'muted', 'path'),
      ]
    : [
        status(result.status === 'failed' ? 'danger' : 'attention', `Restore ${result.status}.`),
        ...issueBlocks(result.issues),
      ];
  if (result.status === 'failed') {
    details.push(status('danger', result.error.message));
    if (result.error.technicalDetails) details.push({ kind: 'literal', text: result.error.technicalDetails });
  }
  return {
    operation: 'restore', outcome: result.status, title: 'Restore Result', summary: [],
    overflowSummary: details.slice(0, 2), details, nextActions: instructionActions(result.nextActions), detailPolicy: 'overflow',
  };
}
