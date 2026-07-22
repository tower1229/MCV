"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderStatusPlain = renderStatusPlain;
function renderStatusPlain(report) {
    const lines = [
        `Repository: ${report.repository.path}`,
        `Repository ID: ${report.repository.id}`,
        `Repository schema: ${report.repository.schemaVersion}`,
    ];
    if (report.repository.git) {
        lines.push(report.repository.git.clean
            ? 'Git: clean'
            : `Git: ${report.repository.git.uncommittedChanges} uncommitted ${plural(report.repository.git.uncommittedChanges, 'change')}`);
    }
    const pending = report.pendingDeployment;
    lines.push(`Pending deployment: ${pending.total} ${plural(pending.total, 'change')} (${pending.add} add, ${pending.modify} modify, ${pending.delete} delete)`);
    const local = report.postDeployLocalState;
    lines.push(`Post-deploy local state: ${local.unchanged} unchanged, ${local.drift} Drift, ${local.missing} missing`, `Environment: ${report.environment.missingVariables.length} missing ${plural(report.environment.missingVariables.length, 'variable')}`);
    if (report.environment.missingVariables.length > 0) {
        lines.push(`Missing variables: ${report.environment.missingVariables.join(', ')}`);
    }
    lines.push('IDE support:');
    for (const ide of report.environment.ideSupport) {
        lines.push(`  ${ide.name}: ${ide.enabled ? 'enabled' : 'disabled'}, ${ide.detected ? 'detected' : 'not detected'}`);
        if (ide.id === 'gemini') {
            for (const surface of ide.surfaces) {
                lines.push(`    ${surface.id}: ${surface.detected ? 'present' : 'absent'}`);
            }
        }
    }
    if (report.lastOperation) {
        lines.push(`Last operation: ${report.lastOperation.kind} · ${report.lastOperation.success ? 'success' : 'failure'} · ${report.lastOperation.time}`);
    }
    else {
        lines.push('Last operation: none');
    }
    return lines;
}
function plural(count, singular) {
    return count === 1 ? singular : `${singular}s`;
}
