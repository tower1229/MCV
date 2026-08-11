import { displaySkillSurface } from '../core/skill-surfaces.js';
import type { StatusReport } from '../operations/status.js';
import type { PresentationBlock, PresentationDocument, PresentationRole } from '../presentation/contracts.js';
import { fact, paragraph, spacer, status } from '../presentation/builders.js';

export function renderStatusDocument(report: StatusReport): PresentationDocument {
  return {
    operation: 'status', outcome: report.status, title: 'Overview Report',
    summary: [...statusLead(report), ...linkedSkillSummary(report.linkFacts), ...statusTail(report)],
    details: [...statusLead(report), ...linkedSkillDetails(report.linkFacts), ...statusTail(report)],
    nextActions: [], detailPolicy: 'progressive',
  };
}

function statusLead(report: StatusReport): PresentationBlock[] {
  const git = report.repository.git;
  const blocks: PresentationBlock[] = [
    paragraph('MCV configuration overview'), spacer(),
    labeled('Repository', report.repository.path, 'muted', undefined, 'path'),
    labeled('Identity', `${report.repository.id} · schema ${report.repository.schemaVersion}`, 'muted', undefined, 'id'),
    ...(git ? [labeled('Git', git.clean ? 'clean' : `${git.uncommittedChanges} uncommitted ${plural(git.uncommittedChanges, 'change')}`, git.clean ? 'success' : 'attention', git.clean ? '✓' : '!')] : []),
    spacer(),
  ];
  const pending = report.pendingDeployment;
  if (pending.total === 0) {
    blocks.push(status('success', 'No pending deployment changes.'));
    if (pending.advancedCleanupExcluded > 0) blocks.push(status('danger', `${pending.advancedCleanupExcluded} Advanced Cleanup ${plural(pending.advancedCleanupExcluded, 'change')} excluded.`));
    blocks.push(spacer());
    return blocks;
  }
  blocks.push(
    status(pending.delete > 0 ? 'danger' : 'attention', `${pending.total} pending deployment ${plural(pending.total, 'change')}.`),
    fact('Breakdown', formatPendingBreakdown(pending), 'information'),
  );
  const destructive = [
    ...(pending.delete ? [`${pending.delete} ${plural(pending.delete, 'deletion')}`] : []),
    ...(pending.advancedCleanupExcluded ? [`${pending.advancedCleanupExcluded} Advanced Cleanup excluded`] : []),
  ];
  blocks.push(destructive.length
    ? status('danger', destructive.join(' · '))
    : status('success', 'No deletions or Advanced Cleanup.'));
  blocks.push(spacer());
  return blocks;
}

function statusTail(report: StatusReport): PresentationBlock[] {
  const blocks: PresentationBlock[] = [];
  const local = report.postDeployLocalState;
  const localRole: PresentationRole = local.missing ? 'danger' : local.drift ? 'attention' : 'success';
  const localSummary = [...(local.drift ? [`${local.drift} drifted`] : []), ...(local.missing ? [`${local.missing} missing`] : []), `${local.unchanged} unchanged`].join(' · ');
  blocks.push(labeled('Device', localSummary, localRole, local.missing ? '×' : local.drift ? '!' : '✓'));
  const specific = [...(local.contentDrift ? [`${local.contentDrift} content`] : []), ...(local.topologyDrift ? [`${local.topologyDrift} topology`] : []), ...(local.missing ? [`${local.missing} missing-file`] : [])];
  blocks.push(specific.length ? status(localRole, `${specific.join(' · ')} drift`) : status('success', 'No content, topology, or missing-file drift.'));
  for (const entry of local.contentDrifts) blocks.push(status('attention', `Content Drift: Canonical Skill package ${entry.packageName}`));
  for (const entry of local.topologyDrifts) {
    const target = entry.kind === 'canonical-skill-package' ? 'Canonical Device Skill Store' : displaySkillSurface(entry.surface);
    blocks.push(status('attention', `Topology Drift: ${target} · ${entry.packageName} · ${entry.reason}`));
  }
  blocks.push(spacer());
  const missingVariables = report.environment.missingVariables;
  blocks.push(labeled('Environment', missingVariables.length ? `${missingVariables.length} missing ${plural(missingVariables.length, 'variable')}` : 'No missing variables', missingVariables.length ? 'danger' : 'success', missingVariables.length ? '×' : '✓'));
  if (missingVariables.length) blocks.push(fact('Missing', missingVariables.join(', '), 'danger', 'id'));
  const enabledCount = report.environment.ideSupport.filter((ide) => ide.enabled).length;
  const detectedCount = report.environment.ideSupport.filter((ide) => ide.detected).length;
  blocks.push(labeled('IDEs', `${enabledCount} enabled · ${detectedCount} detected`, 'muted'));
  for (const ide of report.environment.ideSupport) {
    const role: PresentationRole = ide.enabled && ide.detected ? 'success' : ide.enabled ? 'attention' : 'muted';
    blocks.push(status(role, `${ide.name} · ${ide.enabled ? 'enabled' : 'disabled'}, ${ide.detected ? 'detected' : 'not detected'}`));
    if (ide.id === 'gemini') {
      const present = ide.surfaces.filter((surface) => surface.detected).map((surface) => surface.id);
      const absent = ide.surfaces.filter((surface) => !surface.detected).map((surface) => surface.id);
      if (present.length) blocks.push(status('success', present.join(' · ')));
      if (absent.length) blocks.push(status(ide.enabled ? 'attention' : 'muted', `${absent.join(' · ')} absent`));
    }
  }
  blocks.push(spacer());
  blocks.push(report.lastOperation
    ? labeled('Last', `${report.lastOperation.kind} ${report.lastOperation.success ? 'succeeded' : 'failed'} · ${report.lastOperation.time}`, report.lastOperation.success ? 'success' : 'danger', report.lastOperation.success ? '✓' : '×')
    : labeled('Last', 'No operations recorded on this device', 'muted'));
  blocks.push(spacer());
  return blocks;
}

type LinkFact = StatusReport['linkFacts'][number];
type LinkSeverity = LinkFact['severity'];
const LINK_SEVERITY_RANK: Record<LinkSeverity, number> = { notice: 0, warning: 1, decisionRequired: 2, error: 3 };
const SURFACE_ORDER = ['codex', 'claude-code', 'gemini-cli', 'antigravity'] as const;

function linkedSkillSummary(facts: LinkFact[]): PresentationBlock[] {
  if (!facts.length) return [labeled('Skills', 'No linked packages', 'muted'), spacer()];
  const packageSeverities = new Map<string, LinkSeverity>();
  const packagesBySurface = new Map<string, Set<string>>();
  const ideSurfacesByPackage = new Map<string, Set<string>>();
  const canonicalStorePackages = new Set<string>();
  for (const link of facts) {
    for (const packageName of link.packageNames) {
      const current = packageSeverities.get(packageName);
      if (!current || LINK_SEVERITY_RANK[link.severity] > LINK_SEVERITY_RANK[current]) packageSeverities.set(packageName, link.severity);
      if (!link.surfaces.length) canonicalStorePackages.add(packageName);
      for (const { surface } of link.surfaces) {
        const surfacePackages = packagesBySurface.get(surface) ?? new Set<string>();
        surfacePackages.add(packageName); packagesBySurface.set(surface, surfacePackages);
        const packageSurfaces = ideSurfacesByPackage.get(packageName) ?? new Set<string>();
        packageSurfaces.add(surface); ideSurfacesByPackage.set(packageName, packageSurfaces);
      }
    }
  }
  const severities = [...packageSeverities.values()];
  const healthy = severities.filter((value) => value === 'notice').length;
  const needsReview = severities.filter((value) => value === 'warning' || value === 'decisionRequired').length;
  const blocked = severities.filter((value) => value === 'error').length;
  const packageCount = packageSeverities.size;
  const blocks: PresentationBlock[] = [labeled('Skills', healthy === packageCount
    ? `${packageCount} linked ${plural(packageCount, 'package')} healthy`
    : `${packageCount} ${plural(packageCount, 'package')} · ${healthy} healthy · ${needsReview} need review · ${blocked} blocked`,
  healthy === packageCount ? 'success' : blocked ? 'danger' : 'attention', healthy === packageCount ? '✓' : blocked ? '×' : '!')];
  const coverage = SURFACE_ORDER.flatMap((surface) => {
    const count = packagesBySurface.get(surface)?.size ?? 0;
    return count ? [`${displaySkillSurface(surface)} ${count}`] : [];
  });
  if (canonicalStorePackages.size) coverage.push(`${displaySkillSurface('canonical-store')} ${canonicalStorePackages.size}`);
  const shared = [...ideSurfacesByPackage.values()].filter((surfaces) => surfaces.size > 1).length;
  if (shared) coverage.push(`${shared} shared`);
  if (coverage.length) blocks.push(labeled('Coverage', coverage.join(' · '), 'information'));
  if (facts.some((link) => link.ownership === 'external')) blocks.push(status('success', 'External links preserved.'));
  for (const link of sortLinkFacts(facts).filter((value) => value.severity !== 'notice')) {
    blocks.push(linkHeadline(link));
    if (link.severity === 'warning') blocks.push(paragraph('Acknowledge during Deploy to preserve the external shared link.'));
    if (link.severity === 'decisionRequired') blocks.push(paragraph('Choose Preserve or Replace during Deploy.'));
  }
  blocks.push(labeled('Details', 'mcv status --verbose', 'muted', undefined, 'command'), spacer());
  return blocks;
}

function linkedSkillDetails(facts: LinkFact[]): PresentationBlock[] {
  if (!facts.length) return [fact('Linked Skills', 'none', 'muted')];
  return [{
    kind: 'section', title: 'Linked Skill details',
    blocks: sortLinkFacts(facts).map((link): PresentationBlock => ({
      kind: 'section', title: link.packageNames.join(', '),
      blocks: [
        linkHeadline(link),
        fact('Ownership', link.ownership === 'managed' ? 'MCV-managed' : 'outside MCV', link.ownership === 'managed' ? 'information' : 'attention'),
        { kind: 'list', items: link.linkPaths.map((text) => ({ text, kind: 'path' })) },
        ...(link.resolvedPaths?.length ? [{ kind: 'section', title: 'Resolved targets', blocks: [{ kind: 'list', items: link.resolvedPaths.map((text) => ({ text, kind: 'path' })) }] } as PresentationBlock] : []),
        fact('Coverage', `${link.affectedFileCount} expected file ${plural(link.affectedFileCount, 'placement')} ${link.severity === 'notice' ? 'verified' : 'affected'}`, link.severity === 'notice' ? 'success' : 'attention'),
      ],
    })),
  }];
}

function linkHeadline(link: LinkFact): PresentationBlock {
  const role: PresentationRole = link.severity === 'notice' ? 'success' : link.severity === 'error' ? 'danger' : link.severity === 'decisionRequired' ? 'decision' : 'attention';
  return status(role, `${link.packageNames.join(', ')} · ${linkSurface(link)} · ${linkState(link)}`);
}

function sortLinkFacts(facts: LinkFact[]): LinkFact[] {
  return [...facts].sort((left, right) => LINK_SEVERITY_RANK[right.severity] - LINK_SEVERITY_RANK[left.severity] || left.packageNames.join(',').localeCompare(right.packageNames.join(',')));
}

function linkSurface(link: LinkFact): string {
  return link.surfaces.length ? link.surfaces.map(({ surface }) => displaySkillSurface(surface)).join(' + ') : displaySkillSurface('canonical-store');
}

function linkState(link: LinkFact): string {
  if (link.severity === 'notice') return 'Already matches';
  if (link.severity === 'warning') return 'Review required';
  if (link.severity === 'decisionRequired') return 'Decision required';
  return `Blocked: ${linkReason(link.reason)}`;
}

function linkReason(reason: LinkFact['reason']): string {
  switch (reason) {
    case 'divergent': return 'linked content differs from the repository';
    case 'dangling': return 'link target is missing';
    case 'cycle': return 'link contains a cycle';
    case 'physical-target-conflict': return 'link conflicts with a physical deployment target';
    case 'unclassified': return 'link could not be classified safely';
    case undefined: return 'link cannot be used safely';
  }
}

function plural(count: number, singular: string): string { return count === 1 ? singular : `${singular}s`; }

function labeled(label: string, value: string, role: PresentationRole, symbol?: string, valueKind?: 'path' | 'command' | 'id'): PresentationBlock {
  return fact(label, `${symbol ? `${symbol} ` : ''}${value}`, role, valueKind);
}

function formatPendingBreakdown(pending: StatusReport['pendingDeployment']): string {
  return [...(pending.add ? [`${pending.add} add`] : []), ...(pending.modify ? [`${pending.modify} modify`] : []), ...(pending.delete ? [`${pending.delete} delete`] : []), ...(pending.recommended ? [`${pending.recommended} recommended`] : []), ...(pending.optional ? [`${pending.optional} optional`] : [])].join(' · ');
}
