import type { DeployPlan, DeployResult } from '../operations/deploy.js';
import type { CanonicalSkillTarget } from '../core/canonical-skill-device-layout.js';
import { renderIssuePlain } from './color.js';

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
    const materializations = result.changes.filter(
      (change) => change.deploymentKind === 'physical-materialization',
    ).length;
    const managedLinks = result.changes.filter(
      (change) => change.deploymentKind === 'managed-link-projection',
    ).length;
    const copies = result.changes.filter(
      (change) => change.deploymentKind === 'copy-projection',
    ).length;
    const satisfied = result.linkOutcomes?.filter((outcome) =>
      outcome.status === 'satisfied-via-link' && outcome.ownership === 'managed').length ?? 0;
    return [
      `Deployed ${result.data?.appliedChangeIds.length ?? 0} selected item(s) from ${result.repositoryPath}.`,
      `Physical materializations: ${materializations}`,
      `Managed-link projections: ${managedLinks}`,
      `Copy projections: ${copies}`,
      ...(satisfied > 0 ? [`Already satisfied projections: ${satisfied}`] : []),
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

function renderChange(change: DeployPlan['changes'][number]): string[] {
  const strategy = change.strategy === 'replace-entire-file'
    ? 'replace entire file'
    : 'managed merge';
  const lines = [
    `  [${change.change}] ${change.name} (${change.id}) [${deploymentLabel(change.deploymentKind)}] [${strategy}]${change.defaultSelected ? ' [selected]' : ' [not selected]'}`,
  ];
  if (change.preview.kind === 'link') {
    lines.push(`    ${change.preview.targetPath} -> ${change.preview.linkTarget}`);
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
    case 'copy-projection': return 'Copy projection';
    default: return 'Ordinary file';
  }
}

function displayIde(ide: string): string {
  if (ide === 'claude-code') return 'Claude Code';
  return ide.charAt(0).toUpperCase() + ide.slice(1);
}

function displayDeployTarget(target: CanonicalSkillTarget): string {
  return target.owner === 'canonical-store'
    ? 'Canonical Device Skill Store'
    : displayIde(target.ide);
}

function displayCapability(capability: string): string {
  if (capability === 'rules') return 'Shared Rules';
  if (capability === 'skills') return 'Skills';
  if (capability === 'mcp') return 'MCP';
  return 'IDE-native Configuration';
}
