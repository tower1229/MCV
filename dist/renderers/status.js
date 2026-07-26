"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderStatusPlain = renderStatusPlain;
const color_1 = require("./color");
function renderStatusPlain(report) {
    const lines = [
        `Repository: ${report.repository.path}`,
        `Repository ID: ${report.repository.id}`,
        `Repository schema: ${report.repository.schemaVersion}`,
    ];
    if (report.repository.git) {
        lines.push(report.repository.git.clean
            ? `Git: ${(0, color_1.styleText)('clean', 'green')}`
            : `Git: ${(0, color_1.styleText)(String(report.repository.git.uncommittedChanges), 'yellow')} uncommitted ${plural(report.repository.git.uncommittedChanges, 'change')}`);
    }
    const pending = report.pendingDeployment;
    lines.push(`Pending deployment: ${pending.total} ${plural(pending.total, 'change')} (${pending.add} add, ${pending.modify} modify, ${pending.delete} delete)`);
    const local = report.postDeployLocalState;
    lines.push(`Post-deploy local state: ${local.unchanged} unchanged, ${(0, color_1.styleText)(String(local.drift), local.drift > 0 ? 'yellow' : 'green')} Drift, ${(0, color_1.styleText)(String(local.missing), local.missing > 0 ? 'red' : 'green')} missing`, `Environment: ${report.environment.missingVariables.length} missing ${plural(report.environment.missingVariables.length, 'variable')}`);
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
        lines.push(`Last operation: ${report.lastOperation.kind} · ${report.lastOperation.success
            ? (0, color_1.styleText)('success', 'green')
            : (0, color_1.styleText)('failure', 'red')} · ${report.lastOperation.time}`);
    }
    else {
        lines.push('Last operation: none');
    }
    return lines;
}
function plural(count, singular) {
    return count === 1 ? singular : `${singular}s`;
}
