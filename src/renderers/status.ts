import type { StatusReport } from '../operations/status.js';
import type { PresentationBlock, PresentationDocument, PresentationRole } from '../presentation/contracts.js';
import { textLines } from '../presentation/builders.js';
import { displaySkillSurface } from '../core/skill-surfaces.js';
import { detailText } from './plain-details.js';

export function renderStatusDocument(report: StatusReport): PresentationDocument {
  return {
    operation: 'status',
    title: 'Overview Report',
    summary: statusBlocks(renderStatusSummary(report)),
    details: statusBlocks(renderStatusPlain(report)),
    nextActions: [],
    detailPolicy: 'progressive',
  };
}

function statusBlocks(lines: string[]): PresentationBlock[] {
  return lines.map((line) => line.length === 0
    ? { kind: 'spacer' }
    : { kind: 'paragraph', content: [{ text: line }], role: lineRole(line) });
}

function lineRole(line: string): PresentationRole | undefined {
  const trimmed = line.trimStart();
  if (line === 'MCV configuration overview') return 'information';
  if (/No content, topology, or missing-file drift/u.test(trimmed)) return 'success';
  if (trimmed.startsWith('✓') || line.includes(' ✓ ')) return 'success';
  if (trimmed.startsWith('×') || line.includes(' × ') || /missing|blocked/u.test(trimmed)) return 'danger';
  if (trimmed.startsWith('!') || /drift|pending|uncommitted|review/u.test(trimmed)) return 'attention';
  if (trimmed.startsWith('·') || /absent|disabled|not detected|No operations/u.test(trimmed)) return 'muted';
  if (/^(Repository|Identity)/u.test(line)) return 'muted';
  if (/^(Skills|Environment|IDEs|Device|Last|Coverage|Details)/u.test(line)) return 'information';
  return undefined;
}

export function renderStatusPlain(report: StatusReport): string[] {
  return [
    ...renderStatusLead(report),
    ...renderLinkedSkillDetails(report.linkFacts),
    ...renderStatusTail(report),
  ];
}

function renderStatusSummary(report: StatusReport): string[] {
  return [
    ...renderStatusLead(report),
    ...renderLinkedSkillSummary(report.linkFacts),
    ...renderStatusTail(report),
  ];
}

function renderStatusLead(report: StatusReport): string[] {
  const repositoryDetails = [
    report.repository.id,
    `schema ${report.repository.schemaVersion}`,
    ...(report.repository.git
      ? [report.repository.git.clean
        ? detailText('Git clean', 'success')
        : detailText(
          `${report.repository.git.uncommittedChanges} uncommitted ${plural(report.repository.git.uncommittedChanges, 'change')}`,
          'attention',
        )]
      : []),
  ].join(' · ');
  const lines = [
    detailText('MCV configuration overview', 'information'),
    '',
    labeled('Repository', detailText(report.repository.path, 'muted')),
    labeled('Identity', detailText(repositoryDetails, 'muted')),
    '',
  ];
  const pending = report.pendingDeployment;
  if (pending.total === 0) {
    lines.push(detailText('✓ No pending deployment changes', 'success'));
    if (pending.advancedCleanupExcluded > 0) {
      lines.push(`  ${detailText(`${pending.advancedCleanupExcluded} Advanced Cleanup ${plural(pending.advancedCleanupExcluded, 'change')} excluded`, 'attention')}`);
    }
    lines.push('');
    return lines;
  }

  lines.push(
    detailText(`! ${pending.total} pending deployment ${plural(pending.total, 'change')}`, pending.delete > 0 ? 'danger' : 'attention'),
    `  ${detailText(formatPendingBreakdown(pending), 'information')}`,
  );
  const destructive = [
    ...(pending.delete > 0 ? [`${pending.delete} ${plural(pending.delete, 'deletion')}`] : []),
    ...(pending.advancedCleanupExcluded > 0
      ? [`${pending.advancedCleanupExcluded} Advanced Cleanup excluded`]
      : []),
  ];
  lines.push(destructive.length > 0
    ? `  ${detailText(destructive.join(' · '), pending.delete > 0 ? 'danger' : 'attention')}`
    : `  ${detailText('No deletions or Advanced Cleanup', 'success')}`);
  lines.push('');
  return lines;
}

function renderStatusTail(report: StatusReport): string[] {
  const lines: string[] = [];
  const local = report.postDeployLocalState;
  const localSummary = [
    ...(local.drift > 0 ? [`${local.drift} drifted`] : []),
    ...(local.missing > 0 ? [`${local.missing} missing`] : []),
    `${local.unchanged} unchanged`,
  ].join(' · ');
  const localTone = local.missing > 0 ? 'danger' : local.drift > 0 ? 'attention' : 'success';
  const localSymbol = local.missing > 0 ? '×' : local.drift > 0 ? '!' : '✓';
  lines.push(labeled(
    'Device',
    detailText(`${localSymbol} ${localSummary}`, localTone),
  ));
  const specificDrift = [
    ...(local.contentDrift > 0 ? [`${local.contentDrift} content`] : []),
    ...(local.topologyDrift > 0 ? [`${local.topologyDrift} topology`] : []),
    ...(local.missing > 0 ? [`${local.missing} missing-file`] : []),
  ];
  lines.push(specificDrift.length > 0
    ? `  ${detailText(`${specificDrift.join(' · ')} drift`, localTone)}`
    : `  ${detailText('No content, topology, or missing-file drift', 'success')}`);
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
  lines.push(labeled(
    'Environment',
    missingVariableCount === 0
      ? detailText('✓ No missing variables', 'success')
      : detailText(`× ${missingVariableCount} missing ${plural(missingVariableCount, 'variable')}`, 'danger'),
  ));
  if (report.environment.missingVariables.length > 0) {
    lines.push(`  ${report.environment.missingVariables.join(', ')}`);
  }
  const enabledCount = report.environment.ideSupport.filter((ide) => ide.enabled).length;
  const detectedCount = report.environment.ideSupport.filter((ide) => ide.detected).length;
  lines.push(labeled('IDEs', detailText(`${enabledCount} enabled · ${detectedCount} detected`, 'muted')));
  for (const ide of report.environment.ideSupport) {
    const symbol = ide.enabled && ide.detected ? '✓' : ide.enabled ? '!' : '·';
    const tone = ide.enabled && ide.detected ? 'success' : ide.enabled ? 'attention' : 'muted';
    lines.push(`  ${detailText(`${symbol} ${ide.name} · ${ide.enabled ? 'enabled' : 'disabled'}, ${ide.detected ? 'detected' : 'not detected'}`, tone)}`);
    if (ide.id === 'gemini') {
      const presentSurfaces = ide.surfaces.filter((surface) => surface.detected).map((surface) => surface.id);
      const absentSurfaces = ide.surfaces.filter((surface) => !surface.detected).map((surface) => surface.id);
      if (presentSurfaces.length > 0) lines.push(`    ${detailText(presentSurfaces.join(' · '), 'success')}`);
      if (absentSurfaces.length > 0) lines.push(`    ${detailText(`${absentSurfaces.join(' · ')} absent`, ide.enabled ? 'attention' : 'muted')}`);
    }
  }
  lines.push('');
  if (report.lastOperation) {
    lines.push(labeled(
      'Last',
      detailText(
        `${report.lastOperation.success ? '✓' : '×'} ${report.lastOperation.kind} ${report.lastOperation.success ? 'succeeded' : 'failed'} · ${report.lastOperation.time}`,
        report.lastOperation.success ? 'success' : 'danger',
      ),
    ));
  } else {
    lines.push(labeled('Last', detailText('No operations recorded on this device', 'muted')));
  }
  lines.push('');
  return lines;
}

type LinkFact = StatusReport['linkFacts'][number];
type LinkSeverity = LinkFact['severity'];

const LINK_SEVERITY_RANK: Record<LinkSeverity, number> = {
  notice: 0,
  warning: 1,
  decisionRequired: 2,
  error: 3,
};

const SURFACE_ORDER = ['codex', 'claude-code', 'gemini-cli', 'antigravity'] as const;

function renderLinkedSkillSummary(facts: LinkFact[]): string[] {
  if (facts.length === 0) return [labeled('Skills', detailText('No linked packages', 'muted')), ''];

  const packageSeverities = new Map<string, LinkSeverity>();
  const packagesBySurface = new Map<string, Set<string>>();
  const ideSurfacesByPackage = new Map<string, Set<string>>();
  const canonicalStorePackages = new Set<string>();
  for (const fact of facts) {
    for (const packageName of fact.packageNames) {
      const current = packageSeverities.get(packageName);
      if (!current || LINK_SEVERITY_RANK[fact.severity] > LINK_SEVERITY_RANK[current]) {
        packageSeverities.set(packageName, fact.severity);
      }
      if (fact.surfaces.length === 0) canonicalStorePackages.add(packageName);
      for (const { surface } of fact.surfaces) {
        const surfacePackages = packagesBySurface.get(surface) ?? new Set<string>();
        surfacePackages.add(packageName);
        packagesBySurface.set(surface, surfacePackages);
        const packageSurfaces = ideSurfacesByPackage.get(packageName) ?? new Set<string>();
        packageSurfaces.add(surface);
        ideSurfacesByPackage.set(packageName, packageSurfaces);
      }
    }
  }

  const severities = [...packageSeverities.values()];
  const healthy = severities.filter((severity) => severity === 'notice').length;
  const needsReview = severities.filter((severity) =>
    severity === 'warning' || severity === 'decisionRequired').length;
  const blocked = severities.filter((severity) => severity === 'error').length;
  const packageCount = packageSeverities.size;
  const reviewVerb = needsReview === 1 ? 'needs' : 'need';
  const lines = healthy === packageCount
    ? [labeled('Skills', detailText(`✓ ${packageCount} linked ${plural(packageCount, 'package')} healthy`, 'success'))]
    : [labeled('Skills', detailText(`${packageCount} ${plural(packageCount, 'package')} · ${healthy} healthy · ${needsReview} ${reviewVerb} review · ${blocked} blocked`, blocked > 0 ? 'danger' : 'attention'))];

  const coverage = SURFACE_ORDER.flatMap((surface) => {
    const count = packagesBySurface.get(surface)?.size ?? 0;
    return count > 0 ? [`${displaySkillSurface(surface)} ${count}`] : [];
  });
  if (canonicalStorePackages.size > 0) {
    coverage.push(`${displaySkillSurface('canonical-store')} ${canonicalStorePackages.size}`);
  }
  const shared = [...ideSurfacesByPackage.values()].filter((surfaces) => surfaces.size > 1).length;
  if (shared > 0) coverage.push(`${shared} shared`);
  if (coverage.length > 0) lines.push(`  ${detailText('Coverage', 'information')}  ${coverage.join(' · ')}`);
  if (facts.some((fact) => fact.ownership === 'external')) {
    lines.push(`  ${detailText('External links preserved', 'success')}`);
  }
  lines.push(...sortLinkFacts(facts)
    .filter((fact) => fact.severity !== 'notice')
    .flatMap(renderActionableLinkFact));
  lines.push(`  ${detailText('Details', 'information')}   ${detailText('mcv status --verbose', 'muted')}`);
  lines.push('');
  return lines;
}

function renderLinkedSkillDetails(facts: LinkFact[]): string[] {
  if (facts.length === 0) return ['Linked Skills: none'];
  const lines = ['Linked Skill details:', ''];
  for (const fact of sortLinkFacts(facts)) {
    lines.push(linkFactHeadline(fact));
    lines.push(`    Ownership: ${fact.ownership === 'managed' ? 'MCV-managed' : 'outside MCV'}`);
    lines.push(`    ${plural(fact.linkPaths.length, 'Link')}:`);
    for (const linkPath of fact.linkPaths) lines.push(`      ${linkPath}`);
    if (fact.resolvedPaths?.length) {
      lines.push(`    Resolved ${plural(fact.resolvedPaths.length, 'target')}:`);
      for (const resolvedPath of fact.resolvedPaths) lines.push(`      ${resolvedPath}`);
    }
    const coverageState = fact.severity === 'notice' ? 'verified' : 'affected';
    lines.push(`    Coverage: ${fact.affectedFileCount} expected file ${plural(fact.affectedFileCount, 'placement')} ${coverageState}`);
    lines.push('');
  }
  return lines;
}

function renderActionableLinkFact(fact: LinkFact): string[] {
  const headline = linkFactHeadline(fact);
  if (fact.severity === 'warning') {
    return [headline, '    Acknowledge during Deploy to preserve the external shared link.'];
  }
  if (fact.severity === 'decisionRequired') {
    return [headline, '    Choose Preserve or Replace during Deploy.'];
  }
  return [headline];
}

function linkFactHeadline(fact: LinkFact): string {
  const tone = fact.severity === 'notice'
    ? 'success'
    : fact.severity === 'error'
      ? 'danger'
      : 'attention';
  return detailText(
    `  ${linkFactSymbol(fact)} ${fact.packageNames.join(', ')} · ${linkFactSurface(fact)} · ${linkFactState(fact)}`,
    tone,
  );
}

function sortLinkFacts(facts: LinkFact[]): LinkFact[] {
  return [...facts].sort((left, right) =>
    LINK_SEVERITY_RANK[right.severity] - LINK_SEVERITY_RANK[left.severity]
    || left.packageNames.join(',').localeCompare(right.packageNames.join(',')));
}

function linkFactSymbol(fact: LinkFact): string {
  if (fact.severity === 'notice') return '✓';
  if (fact.severity === 'error') return '×';
  return '!';
}

function linkFactSurface(fact: LinkFact): string {
  return fact.surfaces.length === 0
    ? displaySkillSurface('canonical-store')
    : fact.surfaces.map(({ surface }) => displaySkillSurface(surface)).join(' + ');
}

function linkFactState(fact: LinkFact): string {
  if (fact.severity === 'notice') return 'Already matches';
  if (fact.severity === 'warning') return 'Review required';
  if (fact.severity === 'decisionRequired') return 'Decision required';
  return `Blocked: ${linkFactReason(fact.reason)}`;
}

function linkFactReason(reason: LinkFact['reason']): string {
  switch (reason) {
    case 'divergent': return 'linked content differs from the repository';
    case 'dangling': return 'link target is missing';
    case 'cycle': return 'link contains a cycle';
    case 'physical-target-conflict': return 'link conflicts with a physical deployment target';
    case 'unclassified': return 'link could not be classified safely';
    case undefined: return 'link cannot be used safely';
  }
}

function plural(count: number, singular: string): string {
  return count === 1 ? singular : `${singular}s`;
}

function labeled(label: string, value: string): string {
  return `${detailText(label.padEnd(12), 'information')}${value}`;
}

function formatPendingBreakdown(pending: StatusReport['pendingDeployment']): string {
  return [
    ...(pending.add > 0 ? [`${pending.add} add`] : []),
    ...(pending.modify > 0 ? [`${pending.modify} modify`] : []),
    ...(pending.delete > 0 ? [`${pending.delete} delete`] : []),
    ...(pending.recommended > 0 ? [`${pending.recommended} recommended`] : []),
    ...(pending.optional > 0 ? [`${pending.optional} optional`] : []),
  ].join(' · ');
}
