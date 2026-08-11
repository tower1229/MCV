import { displaySkillSurface } from '../core/skill-surfaces.js';
import { styleText } from './color.js';
export function renderStatusDocument(report) {
    return {
        operation: 'status',
        title: 'Overview Report',
        summary: renderStatusSummary(report),
        details: renderStatusPlain(report),
        nextActions: [],
        detailPolicy: 'progressive',
    };
}
export function renderStatusPlain(report) {
    return [
        ...renderStatusLead(report),
        ...renderLinkedSkillDetails(report.linkFacts),
        ...renderStatusTail(report),
    ];
}
function renderStatusSummary(report) {
    return [
        ...renderStatusLead(report),
        ...renderLinkedSkillSummary(report.linkFacts),
        ...renderStatusTail(report),
    ];
}
function renderStatusLead(report) {
    const repositoryDetails = [
        report.repository.id,
        `schema ${report.repository.schemaVersion}`,
        ...(report.repository.git
            ? [report.repository.git.clean
                    ? styleText('Git clean', 'green')
                    : styleText(`${report.repository.git.uncommittedChanges} uncommitted ${plural(report.repository.git.uncommittedChanges, 'change')}`, 'yellow')]
            : []),
    ].join(' · ');
    const lines = [
        styleText('MCV configuration overview', 'cyan'),
        '',
        labeled('Repository', styleText(report.repository.path, 'dim')),
        labeled('Identity', styleText(repositoryDetails, 'dim')),
        '',
    ];
    const pending = report.pendingDeployment;
    if (pending.total === 0) {
        lines.push(styleText('✓ No pending deployment changes', 'green'));
        if (pending.advancedCleanupExcluded > 0) {
            lines.push(`  ${styleText(`${pending.advancedCleanupExcluded} Advanced Cleanup ${plural(pending.advancedCleanupExcluded, 'change')} excluded`, 'yellow')}`);
        }
        lines.push('');
        return lines;
    }
    lines.push(styleText(`! ${pending.total} pending deployment ${plural(pending.total, 'change')}`, pending.delete > 0 ? 'red' : 'yellow'), `  ${styleText(formatPendingBreakdown(pending), 'cyan')}`);
    const destructive = [
        ...(pending.delete > 0 ? [`${pending.delete} ${plural(pending.delete, 'deletion')}`] : []),
        ...(pending.advancedCleanupExcluded > 0
            ? [`${pending.advancedCleanupExcluded} Advanced Cleanup excluded`]
            : []),
    ];
    lines.push(destructive.length > 0
        ? `  ${styleText(destructive.join(' · '), pending.delete > 0 ? 'red' : 'yellow')}`
        : `  ${styleText('No deletions or Advanced Cleanup', 'green')}`);
    lines.push('');
    return lines;
}
function renderStatusTail(report) {
    const lines = [];
    const local = report.postDeployLocalState;
    const localSummary = [
        ...(local.drift > 0 ? [`${local.drift} drifted`] : []),
        ...(local.missing > 0 ? [`${local.missing} missing`] : []),
        `${local.unchanged} unchanged`,
    ].join(' · ');
    const localTone = local.missing > 0 ? 'red' : local.drift > 0 ? 'yellow' : 'green';
    const localSymbol = local.missing > 0 ? '×' : local.drift > 0 ? '!' : '✓';
    lines.push(labeled('Device', styleText(`${localSymbol} ${localSummary}`, localTone)));
    const specificDrift = [
        ...(local.contentDrift > 0 ? [`${local.contentDrift} content`] : []),
        ...(local.topologyDrift > 0 ? [`${local.topologyDrift} topology`] : []),
        ...(local.missing > 0 ? [`${local.missing} missing-file`] : []),
    ];
    lines.push(specificDrift.length > 0
        ? `  ${styleText(`${specificDrift.join(' · ')} drift`, localTone)}`
        : `  ${styleText('No content, topology, or missing-file drift', 'green')}`);
    for (const entry of local.contentDrifts) {
        lines.push(`  Content Drift: Canonical Skill package ${entry.packageName}`);
    }
    for (const entry of local.topologyDrifts) {
        lines.push(entry.kind === 'canonical-skill-package'
            ? `  Topology Drift: Canonical Device Skill Store · ${entry.packageName} · ${entry.reason}`
            : `  Topology Drift: ${displaySkillSurface(entry.surface)} · ${entry.packageName} · ${entry.reason}`);
    }
    lines.push('');
    const missingVariableCount = report.environment.missingVariables.length;
    lines.push(labeled('Environment', missingVariableCount === 0
        ? styleText('✓ No missing variables', 'green')
        : styleText(`× ${missingVariableCount} missing ${plural(missingVariableCount, 'variable')}`, 'red')));
    if (report.environment.missingVariables.length > 0) {
        lines.push(`  ${report.environment.missingVariables.join(', ')}`);
    }
    const enabledCount = report.environment.ideSupport.filter((ide) => ide.enabled).length;
    const detectedCount = report.environment.ideSupport.filter((ide) => ide.detected).length;
    lines.push(labeled('IDEs', styleText(`${enabledCount} enabled · ${detectedCount} detected`, 'dim')));
    for (const ide of report.environment.ideSupport) {
        const symbol = ide.enabled && ide.detected ? '✓' : ide.enabled ? '!' : '·';
        const tone = ide.enabled && ide.detected ? 'green' : ide.enabled ? 'yellow' : 'dim';
        lines.push(`  ${styleText(`${symbol} ${ide.name} · ${ide.enabled ? 'enabled' : 'disabled'}, ${ide.detected ? 'detected' : 'not detected'}`, tone)}`);
        if (ide.id === 'gemini') {
            const presentSurfaces = ide.surfaces.filter((surface) => surface.detected).map((surface) => surface.id);
            const absentSurfaces = ide.surfaces.filter((surface) => !surface.detected).map((surface) => surface.id);
            if (presentSurfaces.length > 0)
                lines.push(`    ${styleText(presentSurfaces.join(' · '), 'green')}`);
            if (absentSurfaces.length > 0)
                lines.push(`    ${styleText(`${absentSurfaces.join(' · ')} absent`, ide.enabled ? 'yellow' : 'dim')}`);
        }
    }
    lines.push('');
    if (report.lastOperation) {
        lines.push(labeled('Last', styleText(`${report.lastOperation.success ? '✓' : '×'} ${report.lastOperation.kind} ${report.lastOperation.success ? 'succeeded' : 'failed'} · ${report.lastOperation.time}`, report.lastOperation.success ? 'green' : 'red')));
    }
    else {
        lines.push(labeled('Last', styleText('No operations recorded on this device', 'dim')));
    }
    lines.push('');
    return lines;
}
const LINK_SEVERITY_RANK = {
    notice: 0,
    warning: 1,
    decisionRequired: 2,
    error: 3,
};
const SURFACE_ORDER = ['codex', 'claude-code', 'gemini-cli', 'antigravity'];
function renderLinkedSkillSummary(facts) {
    if (facts.length === 0)
        return [labeled('Skills', styleText('No linked packages', 'dim')), ''];
    const packageSeverities = new Map();
    const packagesBySurface = new Map();
    const ideSurfacesByPackage = new Map();
    const canonicalStorePackages = new Set();
    for (const fact of facts) {
        for (const packageName of fact.packageNames) {
            const current = packageSeverities.get(packageName);
            if (!current || LINK_SEVERITY_RANK[fact.severity] > LINK_SEVERITY_RANK[current]) {
                packageSeverities.set(packageName, fact.severity);
            }
            if (fact.surfaces.length === 0)
                canonicalStorePackages.add(packageName);
            for (const { surface } of fact.surfaces) {
                const surfacePackages = packagesBySurface.get(surface) ?? new Set();
                surfacePackages.add(packageName);
                packagesBySurface.set(surface, surfacePackages);
                const packageSurfaces = ideSurfacesByPackage.get(packageName) ?? new Set();
                packageSurfaces.add(surface);
                ideSurfacesByPackage.set(packageName, packageSurfaces);
            }
        }
    }
    const severities = [...packageSeverities.values()];
    const healthy = severities.filter((severity) => severity === 'notice').length;
    const needsReview = severities.filter((severity) => severity === 'warning' || severity === 'decisionRequired').length;
    const blocked = severities.filter((severity) => severity === 'error').length;
    const packageCount = packageSeverities.size;
    const reviewVerb = needsReview === 1 ? 'needs' : 'need';
    const lines = healthy === packageCount
        ? [labeled('Skills', styleText(`✓ ${packageCount} linked ${plural(packageCount, 'package')} healthy`, 'green'))]
        : [labeled('Skills', styleText(`${packageCount} ${plural(packageCount, 'package')} · ${healthy} healthy · ${needsReview} ${reviewVerb} review · ${blocked} blocked`, blocked > 0 ? 'red' : 'yellow'))];
    const coverage = SURFACE_ORDER.flatMap((surface) => {
        const count = packagesBySurface.get(surface)?.size ?? 0;
        return count > 0 ? [`${displaySkillSurface(surface)} ${count}`] : [];
    });
    if (canonicalStorePackages.size > 0) {
        coverage.push(`${displaySkillSurface('canonical-store')} ${canonicalStorePackages.size}`);
    }
    const shared = [...ideSurfacesByPackage.values()].filter((surfaces) => surfaces.size > 1).length;
    if (shared > 0)
        coverage.push(`${shared} shared`);
    if (coverage.length > 0)
        lines.push(`  ${styleText('Coverage', 'cyan')}  ${coverage.join(' · ')}`);
    if (facts.some((fact) => fact.ownership === 'external')) {
        lines.push(`  ${styleText('External links preserved', 'green')}`);
    }
    lines.push(...sortLinkFacts(facts)
        .filter((fact) => fact.severity !== 'notice')
        .flatMap(renderActionableLinkFact));
    lines.push(`  ${styleText('Details', 'cyan')}   ${styleText('mcv status --verbose', 'dim')}`);
    lines.push('');
    return lines;
}
function renderLinkedSkillDetails(facts) {
    if (facts.length === 0)
        return ['Linked Skills: none'];
    const lines = ['Linked Skill details:', ''];
    for (const fact of sortLinkFacts(facts)) {
        lines.push(linkFactHeadline(fact));
        lines.push(`    Ownership: ${fact.ownership === 'managed' ? 'MCV-managed' : 'outside MCV'}`);
        lines.push(`    ${plural(fact.linkPaths.length, 'Link')}:`);
        for (const linkPath of fact.linkPaths)
            lines.push(`      ${linkPath}`);
        if (fact.resolvedPaths?.length) {
            lines.push(`    Resolved ${plural(fact.resolvedPaths.length, 'target')}:`);
            for (const resolvedPath of fact.resolvedPaths)
                lines.push(`      ${resolvedPath}`);
        }
        const coverageState = fact.severity === 'notice' ? 'verified' : 'affected';
        lines.push(`    Coverage: ${fact.affectedFileCount} expected file ${plural(fact.affectedFileCount, 'placement')} ${coverageState}`);
        lines.push('');
    }
    return lines;
}
function renderActionableLinkFact(fact) {
    const headline = linkFactHeadline(fact);
    if (fact.severity === 'warning') {
        return [headline, '    Acknowledge during Deploy to preserve the external shared link.'];
    }
    if (fact.severity === 'decisionRequired') {
        return [headline, '    Choose Preserve or Replace during Deploy.'];
    }
    return [headline];
}
function linkFactHeadline(fact) {
    const tone = fact.severity === 'notice'
        ? 'green'
        : fact.severity === 'error'
            ? 'red'
            : 'yellow';
    return styleText(`  ${linkFactSymbol(fact)} ${fact.packageNames.join(', ')} · ${linkFactSurface(fact)} · ${linkFactState(fact)}`, tone);
}
function sortLinkFacts(facts) {
    return [...facts].sort((left, right) => LINK_SEVERITY_RANK[right.severity] - LINK_SEVERITY_RANK[left.severity]
        || left.packageNames.join(',').localeCompare(right.packageNames.join(',')));
}
function linkFactSymbol(fact) {
    if (fact.severity === 'notice')
        return '✓';
    if (fact.severity === 'error')
        return '×';
    return '!';
}
function linkFactSurface(fact) {
    return fact.surfaces.length === 0
        ? displaySkillSurface('canonical-store')
        : fact.surfaces.map(({ surface }) => displaySkillSurface(surface)).join(' + ');
}
function linkFactState(fact) {
    if (fact.severity === 'notice')
        return 'Already matches';
    if (fact.severity === 'warning')
        return 'Review required';
    if (fact.severity === 'decisionRequired')
        return 'Decision required';
    return `Blocked: ${linkFactReason(fact.reason)}`;
}
function linkFactReason(reason) {
    switch (reason) {
        case 'divergent': return 'linked content differs from the repository';
        case 'dangling': return 'link target is missing';
        case 'cycle': return 'link contains a cycle';
        case 'physical-target-conflict': return 'link conflicts with a physical deployment target';
        case 'unclassified': return 'link could not be classified safely';
        case undefined: return 'link cannot be used safely';
    }
}
function plural(count, singular) {
    return count === 1 ? singular : `${singular}s`;
}
function labeled(label, value) {
    return `${styleText(label.padEnd(12), 'cyan')}${value}`;
}
function formatPendingBreakdown(pending) {
    return [
        ...(pending.add > 0 ? [`${pending.add} add`] : []),
        ...(pending.modify > 0 ? [`${pending.modify} modify`] : []),
        ...(pending.delete > 0 ? [`${pending.delete} delete`] : []),
        ...(pending.recommended > 0 ? [`${pending.recommended} recommended`] : []),
        ...(pending.optional > 0 ? [`${pending.optional} optional`] : []),
    ].join(' · ');
}
