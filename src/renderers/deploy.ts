import type { DeployPlan, DeployResult } from '../operations/deploy.js';
import type { CanonicalSkillTarget } from '../core/canonical-skill-device-layout.js';
import type { PresentationBlock, PresentationDocument, PresentationRole } from '../presentation/contracts.js';
import { textLines } from '../presentation/builders.js';
import { displaySkillSurface } from '../core/skill-surfaces.js';
import { renderCriticalIssues, renderIssuePlain, detailText, withoutNextActions } from './plain-details.js';

export function renderDeployPlanDocument(plan: DeployPlan): PresentationDocument {
  const selectedCount = plan.changes.filter((change) => change.defaultSelected).length;
  const unselectedCount = plan.changes.length - selectedCount;
  const addCount = countDeployChanges(plan, 'add');
  const modifyCount = countDeployChanges(plan, 'modify');
  const deleteCount = countDeployChanges(plan, 'delete');
  const destructive = plan.changes.filter((change) =>
    change.change === 'delete' || change.deploymentKind === 'topology-migration');
  const topologyMigrationCount = destructive.filter((change) =>
    change.deploymentKind === 'topology-migration').length;
  const selectedDestructive = destructive.filter((change) => change.defaultSelected).length;
  const issueCounts = countIssues(plan);
  const requiresReview = issueCounts.errors > 0
    || issueCounts.warnings > 0
    || issueCounts.decisions > 0;
  const changeSummary = [
    `${selectedCount} selected ${selectedCount === 1 ? 'change' : 'changes'}`,
    ...(unselectedCount > 0 ? [`${unselectedCount} not selected`] : []),
    ...formatNonZeroChangeCounts(addCount, modifyCount, deleteCount),
  ].join(' · ');
  const status = plan.status === 'failed'
    ? detailText('× Deploy plan failed', 'danger')
    : plan.readyToApply && !requiresReview
      ? detailText('✓ Ready to deploy', 'success')
      : detailText('! Review required before deploy', 'attention');
  const summary = [
    detailText(`Deploy ${plan.scope} configuration`, 'information'),
    '',
    `${detailText('Repository', 'information')}  ${detailText(plan.repositoryPath ?? 'not bound', 'muted')}`,
    `${detailText('Target', 'information')}      ${detailText(plan.targetRoot, 'muted')}`,
    '',
    status,
    `  ${detailText(changeSummary, plan.readyToApply && !requiresReview ? 'information' : 'attention')}`,
    ...(destructive.length === 0
      ? [`  ${detailText('No deletions or topology migrations', 'success')}`]
      : [`  ${detailText(`${formatDestructiveCounts(deleteCount, topologyMigrationCount)} · ${selectedDestructive} selected`, selectedDestructive > 0 ? 'danger' : 'attention')}`]),
    ...(issueCounts.errors === 0 && issueCounts.warnings === 0 && issueCounts.decisions === 0
      ? [`  ${detailText('No errors, warnings, or decisions required', 'success')}`]
      : [`  ${detailText(formatActionableIssueCounts(issueCounts), issueCounts.errors > 0 ? 'danger' : 'attention')}`]),
    ...(plan.linkOutcomes.length > 0 ? [formatLinkOutcomes(plan)] : []),
    ...(issueCounts.notices > 0
      ? [`${detailText('Info', 'information')}        ${detailText(`${issueCounts.notices} ${issueCounts.notices === 1 ? 'notice' : 'notices'} · details included in review`, 'muted')}`]
      : []),
    ...renderCriticalIssues(plan.issues),
    '',
  ];
  if (plan.status === 'failed') summary.push(`Error: ${plan.error.message}`);
  const hasReviewDetails = plan.changes.length > 0
    || plan.linkOutcomes.length > 0
    || plan.issues.some((issue) => issue.details)
    || (plan.status === 'failed' && Boolean(plan.error.technicalDetails));
  return {
    operation: 'deploy',
    title: 'Deploy Plan',
    summary: deployBlocks(summary),
    details: textLines(hasReviewDetails ? renderDeployPlanPlain(plan) : []),
    nextActions: plan.nextActions,
    detailPolicy: 'review',
  };
}

function deployBlocks(lines: string[]): PresentationBlock[] {
  return lines.map((line) => line.length === 0
    ? { kind: 'spacer' }
    : { kind: 'paragraph', content: [{ text: line }], role: deployLineRole(line) });
}

function deployLineRole(line: string): PresentationRole | undefined {
  const trimmed = line.trimStart();
  if (line.startsWith('Deploy ')) return 'information';
  if (trimmed.startsWith('✓') || /No errors|No deletions|already satisfied/u.test(trimmed)) return 'success';
  if (trimmed.startsWith('×') || /failed|deletion|topology migration|blocked/u.test(trimmed)) return 'danger';
  if (trimmed.startsWith('!') || /warning|decision|required|not selected/u.test(trimmed)) return 'attention';
  if (/^(Repository|Target)/u.test(line)) return 'muted';
  if (/^(Skills|Info)/u.test(line)) return 'information';
  return undefined;
}

function countDeployChanges(plan: DeployPlan, kind: DeployPlan['changes'][number]['change']): number {
  return plan.changes.filter((change) => change.change === kind).length;
}

function formatLinkOutcomes(plan: DeployPlan): string {
  const satisfied = plan.linkOutcomes.filter((outcome) =>
    outcome.status === 'satisfied-via-link').length;
  const blocked = plan.linkOutcomes.length - satisfied;
  const summary = blocked === 0
    ? `${satisfied} ${satisfied === 1 ? 'projection' : 'projections'} already satisfied`
    : `${satisfied} satisfied · ${blocked} blocked`;
  return `${detailText('Skills', 'information')}      ${detailText(summary, blocked > 0 ? 'danger' : 'success')}`;
}

function formatNonZeroChangeCounts(add: number, modify: number, remove: number): string[] {
  return [
    ...(add > 0 ? [`${add} add`] : []),
    ...(modify > 0 ? [`${modify} modify`] : []),
    ...(remove > 0 ? [`${remove} delete`] : []),
  ];
}

function formatDestructiveCounts(deletions: number, topologyMigrations: number): string {
  return [
    ...(deletions > 0
      ? [`${deletions} deletion ${deletions === 1 ? 'candidate' : 'candidates'}`]
      : []),
    ...(topologyMigrations > 0
      ? [`${topologyMigrations} topology migration ${topologyMigrations === 1 ? 'candidate' : 'candidates'}`]
      : []),
  ].join(' · ');
}

function countIssues(plan: DeployPlan): {
  errors: number;
  warnings: number;
  decisions: number;
  notices: number;
} {
  const count = (severity: DeployPlan['issues'][number]['severity']): number =>
    plan.issues.filter((issue) => issue.severity === severity).length;
  return {
    errors: count('error'),
    warnings: count('warning'),
    decisions: count('decisionRequired'),
    notices: count('notice'),
  };
}

function formatActionableIssueCounts(counts: ReturnType<typeof countIssues>): string {
  return [
    ...(counts.errors > 0 ? [`${counts.errors} ${counts.errors === 1 ? 'error' : 'errors'}`] : []),
    ...(counts.warnings > 0 ? [`${counts.warnings} ${counts.warnings === 1 ? 'warning' : 'warnings'}`] : []),
    ...(counts.decisions > 0 ? [`${counts.decisions} ${counts.decisions === 1 ? 'decision' : 'decisions'} required`] : []),
  ].join(' · ');
}

export function renderDeployPlanPlain(plan: DeployPlan): string[] {
  const lines = [`Deploy Plan: ${plan.repositoryPath ?? 'not bound'}`];
  for (const outcome of plan.linkOutcomes) {
    lines.push(...renderLinkOutcome(outcome));
  }
  let currentGroup = '';
  for (const change of plan.changes.filter((item) => item.group === 'standard')) {
    const group = `${displayDeployTarget(change)}/${change.capability}`;
    if (group !== currentGroup) {
      lines.push(`${displayDeployTarget(change)} / ${displayCapability(change.capability)}`);
      currentGroup = group;
    }
    lines.push(...renderChange(change));
  }
  const advanced = plan.changes.filter((change) => change.group === 'advanced');
  if (advanced.length > 0) {
    lines.push('Advanced Cleanup (not selected by default)');
    for (const change of advanced) {
      lines.push(`  ${displayDeployTarget(change)} / ${displayCapability(change.capability)}`);
      lines.push(...renderChange(change));
    }
  }
  if (plan.changes.length === 0 && plan.status === 'planned') {
    lines.push('No configuration changes to deploy.');
  }
  lines.push(`Summary: ${plan.changes.length} item(s).`);
  for (const issue of plan.issues) {
    lines.push(renderIssuePlain(issue));
    if (issue.details) {
      for (const detail of issue.details.split('\n')) lines.push(`  ${detail}`);
    }
  }
  if (plan.status === 'failed') {
    lines.push(`Error: ${plan.error.message}`);
    if (plan.error.technicalDetails) lines.push(`Details: ${plan.error.technicalDetails}`);
  }
  for (const action of plan.nextActions) lines.push(`Next: ${action}`);
  return lines;
}

function renderLinkOutcome(outcome: DeployPlan['linkOutcomes'][number]): string[] {
  const state = outcome.status === 'satisfied-via-link'
    ? outcome.ownership === 'managed'
      ? 'Already satisfied projection'
      : 'Satisfied via link'
    : `Blocked (${linkedOutcomeReason(outcome.reason)})`;
  const packages = `${outcome.packageNames.length} Skill ${outcome.packageNames.length === 1 ? 'package' : 'packages'}`;
  const files = `${outcome.affectedFileCount} affected ${outcome.affectedFileCount === 1 ? 'file' : 'files'}`;
  return [
    `${state} · ${outcome.ownership} · ${displayDeployTarget(outcome)} · ${packages} · ${files}`,
    ...outcome.linkPaths.map((linkPath) => `  Link: ${linkPath}`),
    ...(outcome.resolvedPaths?.map((resolvedPath) => `  Resolved target: ${resolvedPath}`) ?? []),
  ];
}

function linkedOutcomeReason(
  reason: DeployPlan['linkOutcomes'][number]['reason'],
): string {
  return reason?.replaceAll('-', ' ') ?? 'unclassified';
}

export function renderDeployResultPlain(result: DeployResult): string[] {
  if (result.status === 'succeeded') {
    const skillChanges = result.changes.filter((change) => change.capability === 'skills');
    const materializations = skillChanges.filter(
      (change) => change.deploymentKind === 'physical-materialization',
    );
    const managedLinks = skillChanges.filter(
      (change) => change.deploymentKind === 'managed-link-projection',
    );
    const migrations = skillChanges.filter(
      (change) => change.deploymentKind === 'topology-migration',
    );
    const copies = skillChanges.filter(
      (change) => change.deploymentKind === 'copy-projection',
    );
    const satisfied = result.linkOutcomes?.filter((outcome) =>
      outcome.status === 'satisfied-via-link' && outcome.ownership === 'managed') ?? [];
    return [
      `Deployed ${result.data?.appliedChangeIds.length ?? 0} selected item(s) from ${result.repositoryPath}.`,
      `Physical materializations: ${materializations.length}`,
      `Managed-link projections: ${managedLinks.length}${formatSurfaceList(managedLinks)}`,
      `Topology migrations: ${migrations.length}${formatSurfaceList(migrations)}`,
      `Copy projections: ${copies.length}${formatSurfaceList(copies)}`,
      ...(satisfied.length > 0
        ? [`Already satisfied projections: ${satisfied.length}${formatSatisfiedSurfaceList(satisfied)}`]
        : []),
    ];
  }
  const lines = [`Deploy ${result.status}.`];
  for (const issue of result.issues) {
    lines.push(renderIssuePlain(issue));
  }
  if (result.status === 'failed') {
    lines.push(`Error: ${result.error.message}`);
    if (result.error.technicalDetails) lines.push(`Details: ${result.error.technicalDetails}`);
  }
  for (const action of result.nextActions) lines.push(`Next: ${action}`);
  return lines;
}

export function renderDeployResultDocument(result: DeployResult): PresentationDocument {
  const full = renderDeployResultPlain(result);
  const overflowSummary = result.status === 'succeeded'
    ? [`Deployed ${result.data?.appliedChangeIds.length ?? 0} selected item(s) from ${result.repositoryPath}.`]
    : [
        `Deploy ${result.status}.`,
        `Issues: ${result.issues.length}`,
        ...(result.status === 'failed' ? [`Error: ${result.error.message}`] : []),
      ];
  return {
    operation: 'deploy',
    title: 'Deploy Result',
    summary: [],
    overflowSummary: textLines(overflowSummary),
    details: textLines(withoutNextActions(full)),
    nextActions: result.nextActions,
    detailPolicy: 'overflow',
  };
}

function renderChange(change: DeployPlan['changes'][number]): string[] {
  const strategy = change.strategy === 'replace-entire-file'
    ? 'replace entire file'
    : 'managed merge';
  const destructive = change.change === 'delete' || change.deploymentKind === 'topology-migration'
    ? ' [destructive]'
    : '';
  const lines = [
    `  [${change.change}] ${change.name} (${change.id}) [${deploymentLabel(change.deploymentKind)}] [${strategy}]${change.defaultSelected ? ' [selected]' : ' [not selected]'}${destructive}`,
  ];
  if (change.preview.kind === 'link') {
    lines.push(`    ${change.preview.targetPath} -> ${change.preview.linkTarget}`);
  } else if (change.preview.kind === 'package') {
    lines.push(`    ${change.preview.targetPath}: replace linked package node`);
    for (const file of change.preview.files) {
      if (file.kind === 'binary') {
        lines.push(`      ${file.targetPath}: binary, ${file.bytes} bytes, sha256 ${file.sha256}`);
      } else {
        lines.push(`      ${file.targetPath}:`);
        for (const line of file.diff.split('\n')) lines.push(`        ${line}`);
      }
    }
  } else if (change.preview.kind === 'binary') {
    lines.push(`    ${change.targetPath}: binary, ${change.preview.bytes} bytes, sha256 ${change.preview.sha256}`);
  } else {
    lines.push(`    ${change.targetPath}:`);
    for (const line of change.preview.diff.split('\n')) lines.push(`      ${line}`);
  }
  return lines;
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
  return target.owner === 'canonical-store'
    ? displaySkillSurface('canonical-store')
    : target.surface ? displaySkillSurface(target.surface) : displayIde(target.ide);
}

function formatSurfaceList(
  changes: Array<CanonicalSkillTarget & { deploymentKind?: string }>,
): string {
  const surfaces = [...new Set(changes.map((change) => displayDeployTarget(change)))].sort();
  return surfaces.length === 0 ? '' : ` (${surfaces.join(', ')})`;
}

function formatSatisfiedSurfaceList(
  outcomes: CanonicalSkillTarget[],
): string {
  const surfaces = [...new Set(outcomes.map((outcome) => displayDeployTarget(outcome)))].sort();
  return surfaces.length === 0 ? '' : ` (${surfaces.join(', ')})`;
}

function displayCapability(capability: string): string {
  if (capability === 'rules') return 'Shared Rules';
  if (capability === 'skills') return 'Skills';
  if (capability === 'mcp') return 'MCP';
  return 'IDE-native Configuration';
}
