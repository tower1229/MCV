import type { CanonicalSkillTarget } from '../core/canonical-skill-device-layout.js';
import { displaySkillSurface } from '../core/skill-surfaces.js';
import type { DeployPlan, DeployResult } from '../operations/deploy.js';
import type { PresentationBlock, PresentationDocument, PresentationRole } from '../presentation/contracts.js';
import { diffLines, fact, instructionActions, issueBlocks, paragraph, status } from '../presentation/builders.js';

export function renderDeployPlanDocument(plan: DeployPlan): PresentationDocument {
  const selectedCount = plan.changes.filter((change) => change.defaultSelected).length;
  const unselectedCount = plan.changes.length - selectedCount;
  const addCount = countDeployChanges(plan, 'add');
  const modifyCount = countDeployChanges(plan, 'modify');
  const deleteCount = countDeployChanges(plan, 'delete');
  const destructive = plan.changes.filter((change) =>
    change.change === 'delete' || change.deploymentKind === 'topology-migration');
  const topologyMigrationCount = destructive.filter((change) => change.deploymentKind === 'topology-migration').length;
  const selectedDestructive = destructive.filter((change) => change.defaultSelected).length;
  const issueCounts = countIssues(plan);
  const requiresReview = issueCounts.errors + issueCounts.warnings + issueCounts.decisions > 0;
  const ready = plan.status !== 'failed' && plan.readyToApply && !requiresReview;
  const leadRole: PresentationRole = plan.status === 'failed' || issueCounts.errors > 0
    ? 'danger'
    : requiresReview ? 'decision' : 'success';
  const leadText = plan.status === 'failed' ? 'Deploy plan failed.'
    : issueCounts.errors > 0 ? 'Deploy is blocked.'
      : requiresReview ? 'Review required before deploy.'
        : selectedCount === 0 ? 'No selected changes to deploy.' : 'Ready to deploy.';
  const summary: PresentationBlock[] = [
    paragraph(`Deploy ${plan.scope} configuration`),
    status(leadRole, leadText),
    fact('Repository', plan.repositoryPath ?? 'not bound', 'muted', 'path'),
    fact('Target', plan.targetRoot, 'muted', 'path'),
    fact('Changes', [
      `${selectedCount} selected ${selectedCount === 1 ? 'change' : 'changes'}`,
      ...(unselectedCount ? [`${unselectedCount} not selected`] : []),
      ...formatNonZeroChangeCounts(addCount, modifyCount, deleteCount),
    ].join(' · '), ready ? 'information' : 'attention'),
    destructive.length === 0
      ? status('success', 'No deletions or topology migrations.')
      : status(selectedDestructive > 0 ? 'danger' : 'attention', `${formatDestructiveCounts(deleteCount, topologyMigrationCount)} · ${selectedDestructive} selected.`),
    issueCounts.errors + issueCounts.warnings + issueCounts.decisions === 0
      ? status('success', 'No errors, warnings, or decisions required.')
      : status(issueCounts.errors > 0 ? 'danger' : 'attention', formatActionableIssueCounts(issueCounts)),
    ...(plan.linkOutcomes.length ? [linkOutcomeSummary(plan)] : []),
    ...(issueCounts.notices ? [fact('Info', `${issueCounts.notices} notice(s) · details included in review`, 'muted')] : []),
    ...issueBlocks(plan.issues),
  ];
  if (plan.status === 'failed') summary.push(status('danger', plan.error.message));
  return {
    operation: 'deploy', outcome: plan.status, title: 'Deploy Plan', summary,
    details: deployPlanDetails(plan), nextActions: instructionActions(plan.nextActions), detailPolicy: 'review',
  };
}

function deployPlanDetails(plan: DeployPlan): PresentationBlock[] {
  const blocks: PresentationBlock[] = [fact('Repository', plan.repositoryPath ?? 'not bound', 'muted', 'path')];
  blocks.push(...plan.linkOutcomes.map(linkOutcomeBlock));
  const standard = plan.changes.filter((change) => change.group === 'standard');
  for (const [group, changes] of groupChanges(standard)) {
    blocks.push({ kind: 'section', title: group, blocks: changes.map(changeBlock) });
  }
  const advanced = plan.changes.filter((change) => change.group === 'advanced');
  if (advanced.length) {
    blocks.push({
      kind: 'section', title: 'Advanced Cleanup (not selected by default)',
      blocks: advanced.map((change) => ({
        kind: 'section', title: `${displayDeployTarget(change)} / ${displayCapability(change.capability)}`,
        blocks: [changeBlock(change)],
      })),
    });
  }
  if (!plan.changes.length && plan.status === 'planned') blocks.push(status('success', 'No configuration changes to deploy.'));
  blocks.push(fact('Summary', `${plan.changes.length} item(s)`, 'information'), ...issueBlocks(plan.issues));
  if (plan.status === 'failed') {
    blocks.push(status('danger', plan.error.message));
    if (plan.error.technicalDetails) blocks.push({ kind: 'literal', text: plan.error.technicalDetails });
  }
  return blocks;
}

function groupChanges(changes: DeployPlan['changes']): Map<string, DeployPlan['changes']> {
  const groups = new Map<string, DeployPlan['changes']>();
  for (const change of changes) {
    const label = `${displayDeployTarget(change)} / ${displayCapability(change.capability)}`;
    groups.set(label, [...(groups.get(label) ?? []), change]);
  }
  return groups;
}

function changeBlock(change: DeployPlan['changes'][number]): PresentationBlock {
  const destructive = change.change === 'delete' || change.deploymentKind === 'topology-migration';
  const role: PresentationRole = destructive ? 'danger' : 'attention';
  const strategy = change.strategy === 'replace-entire-file' ? 'replace entire file' : 'managed merge';
  const blocks: PresentationBlock[] = [
    status(role, `${change.change}: ${change.name}`),
    fact('ID', change.id, 'muted', 'id'),
    fact('Deployment', deploymentLabel(change.deploymentKind), destructive ? 'danger' : 'information'),
    fact('Strategy', strategy, 'muted'),
    { kind: 'list', items: [{ text: 'Selected for Deploy', selected: change.defaultSelected }] },
  ];
  const preview = change.preview;
  if (preview.kind === 'link') {
    blocks.push(fact('Link', `${preview.targetPath} -> ${preview.linkTarget}`, 'muted', 'path'));
  } else if (preview.kind === 'package') {
    blocks.push({ kind: 'section', title: preview.targetPath, titleKind: 'path', blocks: [status('attention', 'Replace linked package node')] });
    for (const file of preview.files) {
      blocks.push(file.kind === 'binary'
        ? fact('Binary', `${file.targetPath} · ${file.bytes} bytes · sha256 ${file.sha256}`, 'muted', 'path')
        : { kind: 'section', title: file.targetPath, titleKind: 'path', blocks: [{ kind: 'diff', lines: diffLines(file.diff) }] });
    }
  } else if (preview.kind === 'binary') {
    blocks.push(fact('Binary', `${change.targetPath} · ${preview.bytes} bytes · sha256 ${preview.sha256}`, 'muted', 'path'));
  } else {
    blocks.push({ kind: 'section', title: change.targetPath, titleKind: 'path', blocks: [{ kind: 'diff', lines: diffLines(preview.diff) }] });
  }
  return { kind: 'section', title: change.name, blocks };
}

function linkOutcomeBlock(outcome: DeployPlan['linkOutcomes'][number]): PresentationBlock {
  const satisfied = outcome.status === 'satisfied-via-link';
  const state = satisfied
    ? outcome.ownership === 'managed' ? 'Already satisfied projection' : 'Satisfied via link'
    : `Blocked (${linkedOutcomeReason(outcome.reason)})`;
  return {
    kind: 'section', title: `${displayDeployTarget(outcome)} / Skills`,
    blocks: [
      status(satisfied ? 'success' : 'danger', state),
      fact('Ownership', outcome.ownership, 'muted'),
      fact('Packages', String(outcome.packageNames.length), 'information'),
      fact('Affected files', String(outcome.affectedFileCount), 'information'),
      ...outcome.linkPaths.map((path) => fact('Link', path, 'muted', 'path')),
      ...(outcome.resolvedPaths?.map((path) => fact('Resolved target', path, 'muted', 'path')) ?? []),
    ],
  };
}

export function renderDeployResultDocument(result: DeployResult): PresentationDocument {
  const details = deployResultBlocks(result);
  return {
    operation: 'deploy', outcome: result.status, title: 'Deploy Result', summary: [],
    overflowSummary: result.status === 'succeeded' ? details.slice(0, 1) : details.slice(0, 3),
    details, nextActions: instructionActions(result.nextActions), detailPolicy: 'overflow',
  };
}

function deployResultBlocks(result: DeployResult): PresentationBlock[] {
  if (result.status !== 'succeeded') {
    const blocks: PresentationBlock[] = [
      status(result.status === 'failed' ? 'danger' : 'attention', `Deploy ${result.status}.`),
      ...issueBlocks(result.issues),
    ];
    if (result.status === 'failed') {
      blocks.push(status('danger', result.error.message));
      if (result.error.technicalDetails) blocks.push({ kind: 'literal', text: result.error.technicalDetails });
    }
    return blocks;
  }
  const skillChanges = result.changes.filter((change) => change.capability === 'skills');
  const byKind = (kind: DeployPlan['changes'][number]['deploymentKind']) => skillChanges.filter((change) => change.deploymentKind === kind);
  const materializations = byKind('physical-materialization');
  const managedLinks = byKind('managed-link-projection');
  const migrations = byKind('topology-migration');
  const copies = byKind('copy-projection');
  const satisfied = result.linkOutcomes?.filter((outcome) => outcome.status === 'satisfied-via-link' && outcome.ownership === 'managed') ?? [];
  return [
    status('success', `Deployed ${result.data?.appliedChangeIds.length ?? 0} selected item(s) from ${result.repositoryPath}.`),
    colonFact('Physical materializations', String(materializations.length), 'information'),
    colonFact('Managed-link projections', `${managedLinks.length}${formatSurfaceList(managedLinks)}`, 'information'),
    colonFact('Topology migrations', `${migrations.length}${formatSurfaceList(migrations)}`, migrations.length ? 'attention' : 'information'),
    colonFact('Copy projections', `${copies.length}${formatSurfaceList(copies)}`, 'information'),
    ...(satisfied.length ? [colonFact('Already satisfied projections', `${satisfied.length}${formatSatisfiedSurfaceList(satisfied)}`, 'success')] : []),
  ];
}

function colonFact(label: string, value: string, role: PresentationRole): PresentationBlock {
  return fact(label, value, role);
}

function linkOutcomeSummary(plan: DeployPlan): PresentationBlock {
  const satisfied = plan.linkOutcomes.filter((outcome) => outcome.status === 'satisfied-via-link').length;
  const blocked = plan.linkOutcomes.length - satisfied;
  return fact('Skills', blocked === 0 ? `${satisfied} ${satisfied === 1 ? 'projection' : 'projections'} already satisfied` : `${satisfied} satisfied · ${blocked} blocked`, blocked ? 'danger' : 'success');
}

function countDeployChanges(plan: DeployPlan, kind: DeployPlan['changes'][number]['change']): number {
  return plan.changes.filter((change) => change.change === kind).length;
}

function formatNonZeroChangeCounts(add: number, modify: number, remove: number): string[] {
  return [...(add ? [`${add} add`] : []), ...(modify ? [`${modify} modify`] : []), ...(remove ? [`${remove} delete`] : [])];
}

function formatDestructiveCounts(deletions: number, topologyMigrations: number): string {
  return [
    ...(deletions ? [`${deletions} deletion candidate(s)`] : []),
    ...(topologyMigrations ? [`${topologyMigrations} topology migration candidate(s)`] : []),
  ].join(' · ');
}

function countIssues(plan: DeployPlan) {
  const count = (severity: DeployPlan['issues'][number]['severity']) => plan.issues.filter((issue) => issue.severity === severity).length;
  return { errors: count('error'), warnings: count('warning'), decisions: count('decisionRequired'), notices: count('notice') };
}

function formatActionableIssueCounts(counts: ReturnType<typeof countIssues>): string {
  return [...(counts.errors ? [`${counts.errors} error(s)`] : []), ...(counts.warnings ? [`${counts.warnings} warning(s)`] : []), ...(counts.decisions ? [`${counts.decisions} decision(s) required`] : [])].join(' · ');
}

function linkedOutcomeReason(reason: DeployPlan['linkOutcomes'][number]['reason']): string {
  return reason?.replaceAll('-', ' ') ?? 'unclassified';
}

function deploymentLabel(kind: DeployPlan['changes'][number]['deploymentKind']): string {
  switch (kind) {
    case 'physical-materialization': return 'Physical materialization';
    case 'managed-link-projection': return 'Managed-link projection';
    case 'topology-migration': return 'Topology migration';
    case 'copy-projection': return 'Copy projection';
    case 'project-skill-package': return 'Project Skill package';
    case 'external-link-replacement': return 'External link replacement';
    default: return 'Ordinary file';
  }
}

function displayIde(ide: string): string {
  if (ide === 'claude-code') return 'Claude Code';
  return ide.charAt(0).toUpperCase() + ide.slice(1);
}

function displayDeployTarget(target: CanonicalSkillTarget): string {
  return target.owner === 'canonical-store' ? displaySkillSurface('canonical-store')
    : target.surface ? displaySkillSurface(target.surface) : displayIde(target.ide);
}

function formatSurfaceList(changes: Array<CanonicalSkillTarget & { deploymentKind?: string }>): string {
  const surfaces = [...new Set(changes.map(displayDeployTarget))].sort();
  return surfaces.length ? ` (${surfaces.join(', ')})` : '';
}

function formatSatisfiedSurfaceList(outcomes: CanonicalSkillTarget[]): string {
  const surfaces = [...new Set(outcomes.map(displayDeployTarget))].sort();
  return surfaces.length ? ` (${surfaces.join(', ')})` : '';
}

function displayCapability(capability: string): string {
  if (capability === 'instructions') return 'IDE Instructions';
  if (capability === 'skills') return 'Skills';
  if (capability === 'mcp') return 'MCP';
  return 'IDE-native Configuration';
}
