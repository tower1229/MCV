import { styleText } from './color.js';
export function renderStatusPlain(report) {
    const lines = [
        `Repository: ${report.repository.path}`,
        `Repository ID: ${report.repository.id}`,
        `Repository schema: ${report.repository.schemaVersion}`,
    ];
    if (report.repository.git) {
        lines.push(report.repository.git.clean
            ? `Git: ${styleText('clean', 'green')}`
            : `Git: ${styleText(String(report.repository.git.uncommittedChanges), 'yellow')} uncommitted ${plural(report.repository.git.uncommittedChanges, 'change')}`);
    }
    const pending = report.pendingDeployment;
    lines.push(`Pending deployment: ${pending.total} ${plural(pending.total, 'change')} (${pending.add} add, ${pending.modify} modify, ${pending.delete} delete)`);
    for (const outcome of report.linkOutcomes) {
        const surface = outcome.owner === 'canonical-store'
            ? 'Canonical Device Skill Store'
            : outcome.ide === 'claude-code'
                ? 'Claude Code'
                : outcome.ide === 'gemini-cli'
                    ? 'Gemini CLI'
                    : outcome.ide === 'antigravity'
                        ? 'Antigravity'
                        : outcome.ide.charAt(0).toUpperCase() + outcome.ide.slice(1);
        const state = outcome.status === 'satisfied-via-link'
            ? outcome.ownership === 'managed'
                ? 'Already satisfied projection'
                : 'Satisfied via link'
            : 'Blocked';
        lines.push(`Linked Skills: ${surface} · ${state} · ${outcome.ownership} · ${outcome.packageNames.length} ${plural(outcome.packageNames.length, 'package')} · ${outcome.affectedFileCount} affected ${plural(outcome.affectedFileCount, 'file')}`);
    }
    const local = report.postDeployLocalState;
    lines.push(`Post-deploy local state: ${local.unchanged} unchanged, ${styleText(String(local.drift), local.drift > 0 ? 'yellow' : 'green')} Drift, ${styleText(String(local.missing), local.missing > 0 ? 'red' : 'green')} missing`, `Environment: ${report.environment.missingVariables.length} missing ${plural(report.environment.missingVariables.length, 'variable')}`);
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
            ? styleText('success', 'green')
            : styleText('failure', 'red')} · ${report.lastOperation.time}`);
    }
    else {
        lines.push('Last operation: none');
    }
    return lines;
}
function plural(count, singular) {
    return count === 1 ? singular : `${singular}s`;
}
