import type { StatusReport } from '../operations/status.js';
import type { HumanDocument } from '../cli/human-output.js';
import { displaySkillSurface } from '../core/skill-surfaces.js';
import { styleText } from './color.js';

export function renderStatusDocument(report: StatusReport): HumanDocument {
  return {
    operation: 'status',
    title: 'Overview Report',
    summary: renderStatusSummary(report),
    details: renderStatusPlain(report),
    nextActions: [],
    detailPolicy: 'progressive',
  };
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
  const lines = [
    `Repository: ${report.repository.path}`,
    `Repository ID: ${report.repository.id}`,
    `Repository schema: ${report.repository.schemaVersion}`,
  ];
  if (report.repository.git) {
    lines.push(report.repository.git.clean
      ? `Git: ${styleText('clean', 'green')}`
      : `Git: ${styleText(String(report.repository.git.uncommittedChanges), 'yellow')} uncommitted ${plural(
        report.repository.git.uncommittedChanges,
        'change',
      )}`);
  }
  const pending = report.pendingDeployment;
  lines.push(
    `Pending deployment: ${pending.total} ${plural(pending.total, 'change')} (${pending.add} add, ${pending.modify} modify, ${pending.delete} delete; ${pending.recommended} recommended, ${pending.optional} optional; ${pending.advancedCleanupExcluded} Advanced Cleanup excluded)`,
  );
  return lines;
}

function renderStatusTail(report: StatusReport): string[] {
  const lines: string[] = [];
  const local = report.postDeployLocalState;
  lines.push(
    `Post-deploy local state: ${local.unchanged} unchanged, ${styleText(String(local.contentDrift), local.contentDrift > 0 ? 'yellow' : 'green')} content Drift, ${styleText(String(local.topologyDrift), local.topologyDrift > 0 ? 'yellow' : 'green')} topology Drift, ${styleText(String(local.drift), local.drift > 0 ? 'yellow' : 'green')} Drift, ${styleText(String(local.missing), local.missing > 0 ? 'red' : 'green')} missing`,
  );
  for (const entry of local.contentDrifts) {
    lines.push(`  Content Drift: Canonical Skill package ${entry.packageName}`);
  }
  for (const entry of local.topologyDrifts) {
    lines.push(entry.kind === 'canonical-skill-package'
      ? `  Topology Drift: Canonical Device Skill Store · ${entry.packageName} · ${entry.reason}`
      : `  Topology Drift: ${displaySkillSurface(entry.surface)} · ${entry.packageName} · ${entry.reason}`);
  }
  lines.push(
    `Environment: ${report.environment.missingVariables.length} missing ${plural(
      report.environment.missingVariables.length,
      'variable',
    )}`,
  );
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
  } else {
    lines.push('Last operation: none');
  }
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
  if (facts.length === 0) return ['Linked Skills: none'];

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
  const matchVerb = packageCount === 1 ? 'matches' : 'match';
  const reviewVerb = needsReview === 1 ? 'needs' : 'need';
  const lines = healthy === packageCount
    ? [`Linked Skills: ✓ ${packageCount} ${plural(packageCount, 'package')} ${matchVerb} through existing local links · no action required`]
    : [`Linked Skills: ${packageCount} ${plural(packageCount, 'package')} · ${healthy} healthy · ${needsReview} ${reviewVerb} review · ${blocked} blocked`];

  const coverage = SURFACE_ORDER.flatMap((surface) => {
    const count = packagesBySurface.get(surface)?.size ?? 0;
    return count > 0 ? [`${displaySkillSurface(surface)} ${count}`] : [];
  });
  if (canonicalStorePackages.size > 0) {
    coverage.push(`${displaySkillSurface('canonical-store')} ${canonicalStorePackages.size}`);
  }
  const shared = [...ideSurfacesByPackage.values()].filter((surfaces) => surfaces.size > 1).length;
  if (shared > 0) coverage.push(`${shared} shared`);
  if (coverage.length > 0) lines.push(`  Coverage: ${coverage.join(' · ')}`);
  if (facts.some((fact) => fact.ownership === 'external')) {
    lines.push('  External links are outside MCV ownership and will be preserved.');
  }
  lines.push(...sortLinkFacts(facts)
    .filter((fact) => fact.severity !== 'notice')
    .flatMap(renderActionableLinkFact));
  lines.push('  Details: mcv status --verbose');
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
  return `  ${linkFactSymbol(fact)} ${fact.packageNames.join(', ')} · ${linkFactSurface(fact)} · ${linkFactState(fact)}`;
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
