import { renderIssuePlain } from './color.js';
import { restoreLayoutLabel } from './restore-layout.js';
import { renderCriticalIssues, summarizeIssues, withoutNextActions } from './human-document.js';
export function renderRestorePlanDocument(plan) {
    const restoreCount = plan.changes.filter((change) => change.action === 'restore').length;
    const deleteCount = plan.changes.length - restoreCount;
    const summary = [
        'Restore Plan: latest complete deployment backup',
        ...(plan.backup ? [`Backup time: ${plan.backup.createdAt}`] : []),
        `Changes: ${restoreCount} restore, ${deleteCount} delete.`,
        ...(deleteCount > 0 ? [`[destructive] Deletes selected by Restore: ${deleteCount}.`] : []),
        summarizeIssues(plan.issues),
        ...renderCriticalIssues(plan.issues),
    ];
    if (plan.status === 'failed')
        summary.push(`Error: ${plan.error.message}`);
    const hasReviewDetails = plan.changes.length > 0
        || plan.issues.some((issue) => issue.details)
        || (plan.status === 'failed' && Boolean(plan.error.technicalDetails));
    return {
        operation: 'restore',
        title: 'Restore Plan',
        summary,
        details: hasReviewDetails ? renderRestorePlanPlain(plan) : [],
        nextActions: [
            ...(plan.changes.length > 0 ? ['Review every affected path before confirming Restore.'] : []),
            ...plan.nextActions,
        ],
        detailPolicy: 'review',
    };
}
export function renderRestorePlanPlain(plan) {
    const lines = ['Restore Plan: latest complete deployment backup'];
    if (plan.backup)
        lines.push(`Backup time: ${plan.backup.createdAt}`);
    for (const change of plan.changes) {
        lines.push(`  [${change.action}] ${change.targetPath} [${restoreLayoutLabel(change.layoutKind, change.nodeKind)}]`);
        if (change.linkTarget)
            lines.push(`    ${change.targetPath} -> ${change.linkTarget}`);
    }
    const restoreCount = plan.changes.filter((change) => change.action === 'restore').length;
    const deleteCount = plan.changes.length - restoreCount;
    const projectionCount = plan.changes.filter((change) => change.layoutKind === 'managed-link-projection').length;
    const packageCount = plan.changes.filter((change) => change.layoutKind === 'physical-package').length;
    lines.push(`Summary: ${restoreCount} change(s) to restore, ${deleteCount} change(s) to delete.`);
    lines.push(`Managed-link projections: ${projectionCount}`);
    lines.push(`Physical packages: ${packageCount}`);
    for (const issue of plan.issues) {
        lines.push(renderIssuePlain(issue));
        if (issue.details) {
            for (const detail of issue.details.split('\n'))
                lines.push(`  ${detail}`);
        }
    }
    if (plan.status === 'failed')
        lines.push(`Error: ${plan.error.message}`);
    for (const action of plan.nextActions)
        lines.push(`Next: ${action}`);
    return lines;
}
export function renderRestoreResultPlain(result) {
    if (result.status === 'succeeded') {
        return [
            `Current pre-restore state saved to ${result.data?.backupPath}.`,
            `Restored ${result.data?.appliedChangeIds.length ?? 0} change(s) from the latest backup.`,
        ];
    }
    const lines = [`Restore ${result.status}.`];
    for (const issue of result.issues) {
        lines.push(renderIssuePlain(issue));
        if (issue.details) {
            for (const detail of issue.details.split('\n'))
                lines.push(`  ${detail}`);
        }
    }
    if (result.status === 'failed') {
        lines.push(`Error: ${result.error.message}`);
        if (result.error.technicalDetails)
            lines.push(`Details: ${result.error.technicalDetails}`);
    }
    for (const action of result.nextActions)
        lines.push(`Next: ${action}`);
    return lines;
}
export function renderRestoreResultDocument(result) {
    const full = renderRestoreResultPlain(result);
    const overflowSummary = result.status === 'succeeded'
        ? [`Restored ${result.data?.appliedChangeIds.length ?? 0} change(s) from the latest backup.`]
        : [
            `Restore ${result.status}.`,
            `Issues: ${result.issues.length}`,
            ...(result.status === 'failed' ? [`Error: ${result.error.message}`] : []),
        ];
    return {
        operation: 'restore',
        title: 'Restore Result',
        summary: [],
        overflowSummary,
        details: withoutNextActions(full),
        nextActions: result.nextActions,
        detailPolicy: 'overflow',
    };
}
