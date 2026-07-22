import type { CapturePlan } from '../operations/capture';

export function renderCapturePlanPlain(plan: CapturePlan): string[] {
  const lines = [`Capture Plan: ${plan.repositoryPath ?? 'not bound'}`];
  let currentGroup = '';
  for (const change of plan.changes) {
    const group = `${change.ide} / ${change.itemType}`;
    if (group !== currentGroup) {
      lines.push(`${displayIde(change.ide)} / ${displayItemType(change.itemType)}`);
      currentGroup = group;
    }
    lines.push(
      `  [${change.change}] ${change.name} (${change.id})${change.defaultSelected ? ' [selected]' : ' [not selected]'}`,
    );
    for (const preview of change.previews) {
      if (preview.kind === 'binary') {
        lines.push(
          `    ${preview.repositoryPath}: binary, ${preview.bytes} bytes, sha256 ${preview.sha256}`,
        );
        continue;
      }
      lines.push(`    ${preview.repositoryPath}:`);
      for (const line of preview.diff.split('\n')) lines.push(`      ${line}`);
    }
  }
  if (plan.changes.length === 0 && plan.status === 'planned') {
    lines.push('No configuration changes to capture.');
  }
  lines.push(
    `Summary: ${plan.changes.length} item(s), ${plan.summary.sensitiveFieldCount} sensitive field(s) replaced, ${plan.summary.parameterizedPathCount} path(s) parameterized, ${plan.summary.excludedFileCount} file(s) excluded.`,
  );
  for (const issue of plan.issues) {
    lines.push(`[${issue.severity}] ${issue.code}: ${issue.message}`);
  }
  for (const action of plan.nextActions) lines.push(`Next: ${action}`);
  return lines;
}

function displayIde(ide: string): string {
  if (ide === 'shared') return 'Shared';
  if (ide === 'claude-code') return 'Claude Code';
  return ide.charAt(0).toUpperCase() + ide.slice(1);
}

function displayItemType(itemType: string): string {
  if (itemType === 'mcp') return 'MCP';
  return itemType.charAt(0).toUpperCase() + itemType.slice(1);
}
