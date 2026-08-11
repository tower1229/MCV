import type { CapturePlan, CaptureResult } from '../operations/capture.js';
import type { SkillProjection } from '../core/skills.js';
import type { PresentationBlock, PresentationDocument, PresentationRole } from '../presentation/contracts.js';
import { fact, issueBlocks, status } from '../presentation/builders.js';
import { renderPresentationDocument } from '../presentation/render.js';

export function renderCapturePlanDocument(plan: CapturePlan): PresentationDocument {
  const counts = {
    add: plan.changes.filter((change) => change.change === 'add').length,
    modify: plan.changes.filter((change) => change.change === 'modify').length,
    delete: plan.changes.filter((change) => change.change === 'delete').length,
    conflict: plan.changes.filter((change) => change.change === 'conflict').length,
  };
  const selected = plan.changes.filter((change) => change.defaultSelected).length;
  const summary: PresentationBlock[] = [
    status(plan.status === 'failed' ? 'danger' : plan.readyToApply ? 'success' : 'decision',
      plan.status === 'failed' ? 'Capture Plan failed.' : plan.readyToApply ? 'Capture Plan is ready.' : 'Capture Plan requires review.'),
    fact('Repository', plan.repositoryPath ?? 'not bound', 'muted'),
    fact('Changes', `${plan.changes.length} · ${counts.add} add · ${counts.modify} modify · ${counts.delete} delete · ${counts.conflict} conflict`, 'information'),
    fact('Selection', `${selected} selected · ${plan.changes.length - selected} excluded`, 'information'),
    ...(counts.delete ? [status('danger', `${counts.delete} deletion candidate(s), not selected by default.`)] : []),
    ...issueBlocks(plan.issues),
  ];
  if (plan.status === 'failed') summary.push(status('danger', plan.error.message));
  return {
    operation: 'capture',
    title: 'Capture Plan',
    summary,
    details: capturePlanDetails(plan),
    nextActions: [
      ...(plan.changes.length ? ['Review the complete diff before confirming Capture.'] : []),
      ...plan.nextActions,
    ],
    detailPolicy: 'review',
  };
}

function capturePlanDetails(plan: CapturePlan): PresentationBlock[] {
  const blocks: PresentationBlock[] = [fact('Repository', plan.repositoryPath ?? 'not bound', 'muted')];
  for (const change of plan.changes) {
    const role: PresentationRole = change.change === 'delete' ? 'danger'
      : change.change === 'conflict' ? 'decision' : 'attention';
    const children: PresentationBlock[] = [
      status(role, `${change.change}: ${change.name}`),
      fact('ID', change.id, 'muted'),
      fact('Selection', change.defaultSelected ? 'selected' : 'not selected', change.defaultSelected ? 'information' : 'muted'),
      ...(change.sourceLabel ? [fact('Source', change.sourceLabel, 'muted')] : []),
      ...(change.contributingProjections?.length ? [fact('Projections', formatContributingProjections(change.contributingProjections), 'muted')] : []),
    ];
    for (const preview of change.previews) {
      children.push(preview.kind === 'binary'
        ? fact('Binary', `${preview.repositoryPath} · ${preview.bytes} bytes · sha256 ${preview.sha256}`, 'muted')
        : { kind: 'section', title: preview.repositoryPath, blocks: [{ kind: 'diff', lines: preview.diff.split('\n').map(classifyDiffLine) }] });
    }
    blocks.push({ kind: 'section', title: `${displayIde(change.ide)} / ${displayItemType(change.itemType)}`, blocks: children });
  }
  if (!plan.changes.length && plan.status === 'planned') blocks.push(status('success', 'No configuration changes to capture.'));
  blocks.push(fact('Summary', `${plan.changes.length} item(s) · ${plan.summary.parameterizedPathCount} path(s) parameterized · ${plan.summary.excludedFileCount} file(s) excluded`, 'information'));
  blocks.push(...issueBlocks(plan.issues));
  if (plan.status === 'failed') {
    blocks.push(status('danger', plan.error.message));
    if (plan.error.technicalDetails) blocks.push({ kind: 'literal', text: plan.error.technicalDetails });
  }
  return blocks;
}

export function renderCaptureResultDocument(result: CaptureResult): PresentationDocument {
  const applied = result.data?.appliedChangeIds.length
    ?? result.changes.filter((change) => change.decision !== 'skip').length;
  const details: PresentationBlock[] = [
    status(result.status === 'succeeded' ? 'success' : result.status === 'failed' ? 'danger' : 'attention',
      result.status === 'succeeded' ? `Captured ${applied} selected item(s).` : `Capture ${result.status}; Repository was not changed.`),
    fact('Repository', result.repositoryPath ?? 'not bound', 'muted'),
    ...(result.data?.newUnassignedCount ? [fact('New Unassigned', `${result.data.newUnassignedCount} asset(s) · ${result.data.newUnassignedAssetIds.join(', ')}`, 'information')] : []),
    ...issueBlocks(result.issues),
  ];
  if (result.status === 'failed') {
    details.push(status('danger', result.error.message));
    if (result.error.technicalDetails) details.push({ kind: 'literal', text: result.error.technicalDetails });
  }
  return {
    operation: 'capture', title: 'Capture Result', summary: [],
    overflowSummary: details.slice(0, 3), details, nextActions: result.nextActions, detailPolicy: 'overflow',
  };
}

export function renderCapturePlanPlain(plan: CapturePlan): string[] {
  return renderPresentationDocument(renderCapturePlanDocument(plan), 'details', { color: false }).split('\n');
}

export function renderCaptureResultPlain(result: CaptureResult): string[] {
  return renderPresentationDocument(renderCaptureResultDocument(result), 'details', { color: false }).split('\n');
}

function classifyDiffLine(text: string): { kind: 'metadata' | 'context' | 'add' | 'remove'; text: string } {
  if (text.startsWith('+++') || text.startsWith('---') || text.startsWith('@@')) return { kind: 'metadata', text };
  if (text.startsWith('+')) return { kind: 'add', text };
  if (text.startsWith('-')) return { kind: 'remove', text };
  return { kind: 'context', text };
}

export function formatContributingProjections(projections: SkillProjection[]): string {
  return projections.map((projection) => `${projection.surface} (${projection.ownership})`).join(', ');
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
