import type { DeployPlan, DeployResult } from '../operations/deploy.js';
import { renderIssuePlain } from './color.js';

export function renderDeployPlanPlain(plan: DeployPlan): string[] {
  const lines = [`Deploy Plan: ${plan.repositoryPath ?? 'not bound'}`];
  for (const outcome of plan.linkOutcomes) {
    lines.push(...renderLinkOutcome(outcome));
  }
  let currentGroup = '';
  for (const change of plan.changes.filter((item) => item.group === 'standard')) {
    const group = `${change.ide}/${change.capability}`;
    if (group !== currentGroup) {
      lines.push(`${displayIde(change.ide)} / ${displayCapability(change.capability)}`);
      currentGroup = group;
    }
    lines.push(...renderChange(change));
  }
  const advanced = plan.changes.filter((change) => change.group === 'advanced');
  if (advanced.length > 0) {
    lines.push('Advanced Cleanup (not selected by default)');
    for (const change of advanced) {
      lines.push(`  ${displayIde(change.ide)} / ${displayCapability(change.capability)}`);
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
    ? 'Satisfied via link'
    : `Blocked (${linkedOutcomeReason(outcome.reason)})`;
  const packages = `${outcome.packageNames.length} Skill ${outcome.packageNames.length === 1 ? 'package' : 'packages'}`;
  const files = `${outcome.affectedFileCount} affected ${outcome.affectedFileCount === 1 ? 'file' : 'files'}`;
  return [
    `${state} · ${outcome.ownership} · ${displayIde(outcome.ide)} · ${packages} · ${files}`,
    `  ${outcome.linkPath}${outcome.resolvedPath ? ` -> ${outcome.resolvedPath}` : ''}`,
  ];
}

function linkedOutcomeReason(
  reason: DeployPlan['linkOutcomes'][number]['reason'],
): string {
  return reason?.replaceAll('-', ' ') ?? 'unclassified';
}

export function renderDeployResultPlain(result: DeployResult): string[] {
  if (result.status === 'succeeded') {
    return [`Deployed ${result.data?.appliedChangeIds.length ?? 0} selected item(s) from ${result.repositoryPath}.`];
  }
  const lines = [`Deploy ${result.status}.`];
  for (const issue of result.issues) {
    lines.push(renderIssuePlain(issue));
  }
  if (result.status === 'failed') lines.push(`Error: ${result.error.message}`);
  for (const action of result.nextActions) lines.push(`Next: ${action}`);
  return lines;
}

function renderChange(change: DeployPlan['changes'][number]): string[] {
  const strategy = change.strategy === 'replace-entire-file'
    ? 'replace entire file'
    : 'managed merge';
  const lines = [
    `  [${change.change}] ${change.name} (${change.id}) [${strategy}]${change.defaultSelected ? ' [selected]' : ' [not selected]'}`,
  ];
  if (change.preview.kind === 'binary') {
    lines.push(`    ${change.targetPath}: binary, ${change.preview.bytes} bytes, sha256 ${change.preview.sha256}`);
  } else {
    lines.push(`    ${change.targetPath}:`);
    for (const line of change.preview.diff.split('\n')) lines.push(`      ${line}`);
  }
  return lines;
}

function displayIde(ide: string): string {
  if (ide === 'claude-code') return 'Claude Code';
  return ide.charAt(0).toUpperCase() + ide.slice(1);
}

function displayCapability(capability: string): string {
  if (capability === 'rules') return 'Shared Rules';
  if (capability === 'skills') return 'Skills';
  if (capability === 'mcp') return 'MCP';
  return 'IDE-native Configuration';
}
