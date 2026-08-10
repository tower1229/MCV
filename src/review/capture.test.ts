import { describe, expect, it } from 'vitest';
import type { CapturePlan } from '../operations/capture.js';
import { shouldUseCaptureTui } from '../commands/capture.js';
import {
  buildCaptureReviewModel,
  captureReviewComplete,
  captureReviewSelection,
  createCaptureReviewDraft,
  setCaptureDecision,
  setCaptureWarningConfirmed,
  summarizeCaptureReview,
  toggleCaptureChange,
} from './capture.js';

describe('Capture review model', () => {
  it('derives defaults, interaction count, and a complete selection', () => {
    const model = buildCaptureReviewModel(plan());
    let draft = createCaptureReviewDraft(model);

    expect(model.interactionCount).toBe(3);
    expect(draft.selectedChangeIds).toEqual(['add']);
    expect(captureReviewComplete(model, draft)).toBe(false);

    draft = setCaptureDecision(model, draft, 'decision-1', 'candidate');
    draft = toggleCaptureChange(model, draft, 'delete');
    draft = setCaptureWarningConfirmed(model, draft, 'warning-1', true);

    expect(captureReviewComplete(model, draft)).toBe(true);
    expect(captureReviewSelection(draft)).toEqual({
      changeIds: ['add', 'candidate', 'delete'],
      confirmedIssueIds: ['warning-1'],
    });
    expect(summarizeCaptureReview(model, draft)).toEqual({
      selectedRepositoryChanges: 3,
      unselectedRepositoryChanges: 0,
      resolvedDecisions: 1,
      skippedDecisions: 0,
      confirmedWarnings: 1,
    });
  });

  it('counts Skip as a resolved decision but not a repository change', () => {
    const model = buildCaptureReviewModel(plan());
    const draft = setCaptureDecision(
      model,
      createCaptureReviewDraft(model),
      'decision-1',
      'skip',
    );

    expect(summarizeCaptureReview(model, draft)).toMatchObject({
      selectedRepositoryChanges: 1,
      unselectedRepositoryChanges: 2,
      resolvedDecisions: 1,
      skippedDecisions: 1,
    });
  });

  it('separates decisions that cannot be resolved inside the active Plan', () => {
    const value = plan();
    value.issues.push({
      severity: 'decisionRequired',
      code: 'capture.externalDecision',
      message: 'Resolve outside this Plan.',
    });
    expect(buildCaptureReviewModel(value).blockingIssues).toEqual([
      expect.objectContaining({ code: 'capture.externalDecision' }),
    ]);
  });

  it('routes only complex interactive reviews to the TUI unless explicitly overridden', () => {
    const review = buildCaptureReviewModel(plan());
    const tty = { stdinIsTTY: true, stdoutIsTTY: true, term: 'xterm-256color' };
    expect(shouldUseCaptureTui(review, {}, tty)).toBe(true);
    expect(shouldUseCaptureTui(review, { tui: false }, tty)).toBe(false);
    expect(shouldUseCaptureTui(review, { verbose: true }, tty)).toBe(false);
    expect(shouldUseCaptureTui(review, { tui: true }, { ...tty, term: 'dumb' })).toBe(false);

    const simple = plan();
    simple.issues = simple.issues.filter((issue) => issue.severity !== 'warning');
    const simpleReview = buildCaptureReviewModel(simple);
    expect(simpleReview.interactionCount).toBe(2);
    simple.changes = simple.changes.filter((change) => change.change !== 'delete');
    const oneItemReview = buildCaptureReviewModel(simple);
    expect(oneItemReview.interactionCount).toBe(1);
    expect(shouldUseCaptureTui(oneItemReview, {}, tty)).toBe(false);
    expect(shouldUseCaptureTui(oneItemReview, { tui: true }, tty)).toBe(true);
  });
});

function plan(): CapturePlan {
  return {
    schemaVersion: 3,
    operation: 'capture',
    status: 'planned',
    readyToApply: false,
    operationId: 'operation-1',
    preconditions: {},
    repositoryPath: '/repo',
    changes: [
      change('add', 'add', true),
      { ...change('delete', 'delete', false), change: 'delete' },
      {
        ...change('candidate', 'candidate', false),
        change: 'conflict',
        decisionGroupId: 'decision-1',
        decision: 'candidate',
        sourceLabel: 'codex / config.toml',
      },
      {
        ...change('skip', 'skip', false),
        change: 'conflict',
        decisionGroupId: 'decision-1',
        decision: 'skip',
        sourceLabel: 'Skip this item',
      },
    ],
    issues: [
      {
        severity: 'decisionRequired',
        code: 'capture.conflict',
        decisionId: 'decision-1',
        message: 'Choose one source.',
      },
      {
        severity: 'warning',
        code: 'capture.warning',
        confirmationId: 'warning-1',
        message: 'Review skipped source.',
      },
    ],
    nextActions: [],
    summary: { parameterizedPathCount: 0, excludedFileCount: 0 },
  };
}

function change(id: string, name: string, defaultSelected: boolean) {
  return {
    id,
    ide: 'shared' as const,
    surface: 'shared',
    itemType: 'file' as const,
    capability: 'native' as const,
    name,
    change: 'add' as const,
    defaultSelected,
    repositoryPaths: [`common/${name}`],
    previews: [],
  };
}
