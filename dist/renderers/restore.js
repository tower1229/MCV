"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderRestorePlanPlain = renderRestorePlanPlain;
function renderRestorePlanPlain(plan) {
    const lines = ['Restore Plan: latest complete deployment backup'];
    if (plan.backup)
        lines.push(`Backup time: ${plan.backup.createdAt}`);
    for (const change of plan.changes) {
        lines.push(`  [${change.action}] ${change.targetPath}`);
    }
    const restoreCount = plan.changes.filter((change) => change.action === 'restore').length;
    const deleteCount = plan.changes.length - restoreCount;
    lines.push(`Summary: ${restoreCount} file(s) to restore, ${deleteCount} file(s) to delete.`);
    for (const issue of plan.issues) {
        lines.push(`[${issue.severity}] ${issue.code}: ${issue.message}`);
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
