import type { CapturePlan, CaptureResult } from '../operations/capture.js';
import type { SkillProjection } from '../core/skills.js';
import type { PresentationDocument } from '../presentation/contracts.js';
import { textLines } from '../presentation/builders.js';
import { renderIssuePlain } from './color.js';
import { renderCriticalIssues, summarizeIssues, withoutNextActions } from './human-document.js';

export function renderCapturePlanDocument(plan: CapturePlan): PresentationDocument {
  const changeCounts = {
    add: plan.changes.filter((change) => change.change === 'add').length,
    modify: plan.changes.filter((change) => change.change === 'modify').length,
    delete: plan.changes.filter((change) => change.change === 'delete').length,
    conflict: plan.changes.filter((change) => change.change === 'conflict').length,
  };
  const selectedCount = plan.changes.filter((change) => change.defaultSelected).length;
  const summary = [
    `Capture Plan: ${plan.repositoryPath ?? 'not bound'}`,
    `Changes: ${plan.changes.length} (${changeCounts.add} add, ${changeCounts.modify} modify, ${changeCounts.delete} delete, ${changeCounts.conflict} conflict).`,
    `Selection: ${selectedCount} selected, ${plan.changes.length - selectedCount} not selected.`,
    ...(changeCounts.delete > 0
      ? [`[destructive] Deletes: ${changeCounts.delete} (not selected by default).`]
      : []),
    summarizeIssues(plan.issues),
    ...renderCriticalIssues(plan.issues),
  ];
  if (plan.status === 'failed') summary.push(`Error: ${plan.error.message}`);
  const hasReviewDetails = plan.changes.length > 0
    || plan.issues.some((issue) => issue.details)
    || (plan.status === 'failed' && Boolean(plan.error.technicalDetails));
  return {
    operation: 'capture',
    title: 'Capture Plan',
    summary: textLines(summary),
    details: textLines(hasReviewDetails ? renderCapturePlanPlain(plan) : []),
    nextActions: [
      ...(plan.changes.length > 0 ? ['Review the complete diff before confirming Capture.'] : []),
      ...plan.nextActions,
    ],
    detailPolicy: 'review',
  };
}

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
    if (change.sourceLabel) lines.push(`    Source: ${change.sourceLabel}`);
    if (change.contributingProjections && change.contributingProjections.length > 0) {
      lines.push(`    Projections: ${formatContributingProjections(change.contributingProjections)}`);
    }
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
    `Summary: ${plan.changes.length} item(s), ${plan.summary.parameterizedPathCount} path(s) parameterized, ${plan.summary.excludedFileCount} file(s) excluded.`,
  );
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

export function renderCaptureResultPlain(result: CaptureResult): string[] {
  if (result.status === 'succeeded') {
    const appliedCount = result.changes.length > 0
      ? result.changes.filter((change) => change.decision !== 'skip').length
      : result.data?.appliedChangeIds.length ?? 0;
    const lines = [
      `Captured ${appliedCount} selected item(s) into ${result.repositoryPath}.`,
    ];
    const newUnassignedCount = result.data?.newUnassignedCount ?? 0;
    if (newUnassignedCount > 0) {
      const ids = result.data?.newUnassignedAssetIds ?? [];
      lines.push(
        `New Unassigned: ${newUnassignedCount} asset(s) (${ids.join(', ')}).`,
      );
    }
    for (const action of result.nextActions) lines.push(`Next: ${action}`);
    return lines;
  }
  const lines = [
    ...result.issues.map(renderIssuePlain),
  ];
  if (result.status === 'failed') {
    lines.push(`Error: ${result.error.message}`);
    if (result.error.technicalDetails) lines.push(`Details: ${result.error.technicalDetails}`);
  }
  lines.push(...result.nextActions.map((action) => `Next: ${action}`));
  return lines;
}

export function renderCaptureResultDocument(result: CaptureResult): PresentationDocument {
  const full = renderCaptureResultPlain(result);
  const overflowSummary = result.status === 'succeeded'
    ? [
        `Captured ${result.changes.length > 0
          ? result.changes.filter((change) => change.decision !== 'skip').length
          : result.data?.appliedChangeIds.length ?? 0} selected item(s) into ${result.repositoryPath}.`,
        `New Unassigned: ${result.data?.newUnassignedCount ?? 0} asset(s).`,
      ]
    : [
        `Capture ${result.status}.`,
        `Issues: ${result.issues.length}`,
        ...(result.status === 'failed' ? [`Error: ${result.error.message}`] : []),
      ];
  return {
    operation: 'capture',
    title: 'Capture Result',
    summary: [],
    overflowSummary: textLines(overflowSummary),
    details: textLines(withoutNextActions(full)),
    nextActions: result.nextActions,
    detailPolicy: 'overflow',
  };
}

export function formatContributingProjections(projections: SkillProjection[]): string {
  return projections
    .map((projection) => `${projection.surface} (${projection.ownership})`)
    .join(', ');
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
