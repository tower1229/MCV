import { displaySkillSurface } from '../core/skill-surfaces.js';
import { styleText } from './color.js';
export function renderStatusDocument(report) {
    const full = renderStatusPlain(report);
    const overflowSummary = full.filter((line) => line.startsWith('Repository:')
        || line.startsWith('Git:')
        || line.startsWith('Pending deployment:')
        || line.startsWith('Post-deploy local state:')
        || line.startsWith('Environment:')
        || line.startsWith('Last operation'));
    overflowSummary.push(`Details: ${report.linkFacts.length} linked Skill facts, ${report.postDeployLocalState.contentDrifts.length + report.postDeployLocalState.topologyDrifts.length} Skill Drift entries, ${report.environment.ideSupport.length} IDEs.`);
    return {
        operation: 'status',
        title: 'Overview Report',
        summary: [],
        overflowSummary,
        details: full,
        nextActions: [],
        detailPolicy: 'overflow',
    };
}
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
    lines.push(`Pending deployment: ${pending.total} ${plural(pending.total, 'change')} (${pending.add} add, ${pending.modify} modify, ${pending.delete} delete; ${pending.recommended} recommended, ${pending.optional} optional; ${pending.advancedCleanupExcluded} Advanced Cleanup excluded)`);
    for (const fact of report.linkFacts) {
        const surface = fact.surfaces.length === 0
            ? displaySkillSurface('canonical-store')
            : fact.surfaces.map(({ surface: surfaceId }) => displaySkillSurface(surfaceId)).join(' + ');
        const state = fact.severity === 'error'
            ? 'Blocked'
            : fact.severity === 'decisionRequired'
                ? 'Needs decision'
                : fact.severity === 'warning'
                    ? 'Preserve external'
                    : fact.ownership === 'managed'
                        ? 'Already satisfied projection'
                        : 'Satisfied via link';
        lines.push(`Linked Skills: ${surface} · ${state} · ${fact.ownership} · ${fact.packageNames.length} ${plural(fact.packageNames.length, 'package')} · ${fact.affectedFileCount} affected ${plural(fact.affectedFileCount, 'file')}`);
    }
    const local = report.postDeployLocalState;
    lines.push(`Post-deploy local state: ${local.unchanged} unchanged, ${styleText(String(local.contentDrift), local.contentDrift > 0 ? 'yellow' : 'green')} content Drift, ${styleText(String(local.topologyDrift), local.topologyDrift > 0 ? 'yellow' : 'green')} topology Drift, ${styleText(String(local.drift), local.drift > 0 ? 'yellow' : 'green')} Drift, ${styleText(String(local.missing), local.missing > 0 ? 'red' : 'green')} missing`);
    for (const entry of local.contentDrifts) {
        lines.push(`  Content Drift: Canonical Skill package ${entry.packageName}`);
    }
    for (const entry of local.topologyDrifts) {
        lines.push(entry.kind === 'canonical-skill-package'
            ? `  Topology Drift: Canonical Device Skill Store · ${entry.packageName} · ${entry.reason}`
            : `  Topology Drift: ${displaySkillSurface(entry.surface)} · ${entry.packageName} · ${entry.reason}`);
    }
    lines.push(`Environment: ${report.environment.missingVariables.length} missing ${plural(report.environment.missingVariables.length, 'variable')}`);
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
        lines.push(`Last operation on this device: ${report.lastOperation.kind} · ${report.lastOperation.success
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
