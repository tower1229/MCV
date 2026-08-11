import type { DeviceContext } from '../adapters/types.js';
import { askInTerminal, withInterruptsIgnored } from '../cli/prompt.js';
import { recordCaptureSuccess } from '../utils/state.js';
import {
  applyCapturePlan,
  createCapturePlan,
  type CaptureChange,
} from '../operations/capture.js';
import {
  renderCapturePlanDocument,
  renderCaptureResultDocument,
} from '../renderers/capture.js';
import { presentJson } from '../renderers/json.js';
import {
  presentBlocks,
  presentDocument,
  presentOutcome,
  presentReviewReference,
} from '../presentation/output.js';
import { fact, paragraph, status } from '../presentation/builders.js';
import type { Issue } from '../operations/contracts.js';
import {
  buildCaptureReviewModel,
  captureReviewSelection,
  createCaptureReviewDraft,
  setCaptureDecision,
  setCaptureWarningConfirmed,
  summarizeCaptureReview,
  toggleCaptureChange,
} from '../review/capture.js';
import {
  runCaptureReviewTui,
  type CaptureTuiOutcome,
} from '../tui/capture/app.js';

export interface CaptureOptions {
  dryRun?: boolean;
  json?: boolean;
  yes?: boolean;
  verbose?: boolean;
  tui?: boolean;
}

export interface CaptureDependencies {
  confirmCapture?: () => Promise<boolean | undefined>;
  selectConflict?: (repositoryPath: string, candidates: string[]) => Promise<number | undefined>;
  confirmDeletion?: (change: CaptureChange) => Promise<boolean | undefined>;
  confirmWarning?: (issue: Issue & { severity: 'warning' }) => Promise<boolean | undefined>;
  runTui?: typeof runCaptureReviewTui;
  terminal?: {
    stdinIsTTY: boolean;
    stdoutIsTTY: boolean;
    term?: string;
  };
}

export async function captureConfigurations(
  context: DeviceContext,
  dependencies: CaptureDependencies = {},
  options: CaptureOptions = {},
): Promise<void> {
  const capturePlan = await createCapturePlan(context);
  if (options.dryRun) {
    if (options.json) presentJson(capturePlan);
    else presentDocument(context, renderCapturePlanDocument(capturePlan), {
      verbose: options.verbose,
    });
    if (capturePlan.status === 'failed') process.exitCode = 1;
    return;
  }
  if (capturePlan.status === 'failed') {
    const result = await applyCapturePlan(context, capturePlan, { changeIds: [] });
    if (options.json) presentJson(result);
    else presentDocument(context, renderCaptureResultDocument(result), {
      verbose: options.verbose,
    });
    process.exitCode = 1;
    return;
  }
  const review = buildCaptureReviewModel(capturePlan);
  if (shouldUseCaptureTui(review, options, dependencies.terminal)) {
    const outcome = await (dependencies.runTui ?? runCaptureReviewTui)(
      context,
      capturePlan,
    );
    presentCaptureTuiOutcome(context, outcome);
    return;
  }
  if (!options.json && !options.yes) {
    presentDocument(context, renderCapturePlanDocument(capturePlan), {
      verbose: options.verbose,
    });
  }
  let draft = createCaptureReviewDraft(review);
  if (!options.yes) {
    if (!process.stdin.isTTY && !dependencies.confirmCapture) {
      throw new Error('Capture requires an interactive terminal; use --yes only after reviewing --dry-run.');
    }

    if (review.blockingIssues.length > 0) {
      for (const group of review.decisionGroups) {
        const skip = group.choices.find((choice) => choice.decision === 'skip');
        if (skip) draft = setCaptureDecision(review, draft, group.id, skip.id);
      }
      for (const warning of review.warnings) {
        draft = setCaptureWarningConfirmed(review, draft, warning.confirmationId, true);
      }
      const blocked = await applyCapturePlan(context, capturePlan, captureReviewSelection(draft));
      process.exitCode = blocked.status === 'failed' ? 1 : 3;
      presentDocument(context, renderCaptureResultDocument(blocked), {
        verbose: options.verbose,
      });
      return;
    }

    for (let groupIndex = 0; groupIndex < review.decisionGroups.length; groupIndex += 1) {
      const group = review.decisionGroups[groupIndex];
      const choices = group.choices;
      const canChoose = dependencies.selectConflict !== undefined || process.stdin.isTTY;
      let choice: number | undefined;
      let interrupted = false;
      if (dependencies.selectConflict) {
        choice = await dependencies.selectConflict(
          choices[0].repositoryPaths[0],
          choices.map((candidate) => candidate.sourceLabel ?? candidate.id),
        );
      } else if (canChoose) {
        const outcome = await selectConflictInTerminal(
          groupIndex,
          review.decisionGroups.length,
          group.issue?.message ?? `Choose an authoritative source for ${choices[0].name}.`,
          choices[0].repositoryPaths[0],
          choices.map((candidate) => candidate.sourceLabel ?? candidate.id),
        );
        choice = outcome.choice;
        interrupted = outcome.interrupted;
      }
      if (interrupted) {
        process.exitCode = 130;
        presentOutcome('Capture Result', 'Capture interrupted; repository was not changed.', 'attention');
        return;
      }
      const selected = choice === undefined
        ? choices.find((candidate) => candidate.decision === 'skip')
        : choices[choice];
      if (selected) {
        draft = setCaptureDecision(review, draft, group.id, selected.id);
        presentBlocks([fact('Selected', selected.sourceLabel ?? selected.name, 'information')]);
      }
    }

    for (let index = 0; index < review.deletions.length; index += 1) {
      const deletion = review.deletions[index];
      presentBlocks([
        status('danger', `Deletion ${index + 1}/${review.deletions.length}: ${deletion.name}`),
        fact('Target', deletion.repositoryPaths.join(', '), 'muted'),
      ]);
      const include = await resolveDeletionConfirmation(dependencies, deletion);
      if (include === undefined) {
        process.exitCode = 130;
        presentOutcome('Capture Result', 'Capture interrupted; repository was not changed.', 'attention');
        return;
      }
      if (include) draft = toggleCaptureChange(review, draft, deletion.id);
    }

    for (let index = 0; index < review.warnings.length; index += 1) {
      const warning = review.warnings[index];
      presentBlocks([
        status('attention', `Warning ${index + 1}/${review.warnings.length}: ${warning.message}`),
        ...(warning.details ? [paragraph(warning.details)] : []),
      ]);
      const acknowledged = await resolveWarningConfirmation(dependencies, warning);
      if (acknowledged === undefined) {
        process.exitCode = 130;
        presentOutcome('Capture Result', 'Capture interrupted; repository was not changed.', 'attention');
        return;
      }
      if (!acknowledged) {
        presentOutcome('Capture Result', 'Capture cancelled; repository was not changed.', 'attention');
        return;
      }
      draft = setCaptureWarningConfirmed(review, draft, warning.confirmationId, true);
    }

    const summary = summarizeCaptureReview(review, draft);
    presentBlocks([status(
      'success',
      `Ready to apply: ${summary.selectedRepositoryChanges} selected, ${summary.unselectedRepositoryChanges} excluded; `
        + `${summary.resolvedDecisions} decisions resolved (${summary.skippedDecisions} skipped), `
        + `${summary.confirmedWarnings} warnings acknowledged.`,
    )]);
    const confirmed = await (dependencies.confirmCapture
      ? dependencies.confirmCapture()
      : confirmInTerminal(
          summary.selectedRepositoryChanges,
          capturePlan.repositoryPath ?? 'the Repository',
        ));
    if (confirmed === undefined) {
      process.exitCode = 130;
      presentOutcome('Capture Result', 'Capture interrupted; repository was not changed.', 'attention');
      return;
    }
    if (!confirmed) {
      presentOutcome('Capture Result', 'Capture cancelled; repository was not changed.', 'attention');
      return;
    }
  }
  const selection = options.yes
    ? {
        changeIds: capturePlan.changes
          .filter((change) => change.defaultSelected)
          .map((change) => change.id),
        confirmedIssueIds: [],
      }
    : captureReviewSelection(draft);
  const result = await withInterruptsIgnored(() =>
    applyCapturePlan(context, capturePlan, selection, { nonInteractive: options.yes }));
  if (result.status === 'succeeded') {
    recordCaptureSuccess(context);
  } else {
    process.exitCode = result.status === 'blocked' ? 3 : 1;
  }
  if (options.json) presentJson(result);
  else presentDocument(context, renderCaptureResultDocument(result), {
    verbose: options.verbose,
  });
}

export function shouldUseCaptureTui(
  review: ReturnType<typeof buildCaptureReviewModel>,
  options: CaptureOptions,
  terminal: CaptureDependencies['terminal'] = {
    stdinIsTTY: Boolean(process.stdin.isTTY),
    stdoutIsTTY: Boolean(process.stdout.isTTY),
    term: process.env.TERM,
  },
): boolean {
  if (options.dryRun || options.yes || options.json || options.verbose || options.tui === false) {
    return false;
  }
  if (review.blockingIssues.length > 0) return false;
  const available = terminal.stdinIsTTY
    && terminal.stdoutIsTTY
    && terminal.term?.toLowerCase() !== 'dumb';
  if (!available) return false;
  return options.tui === true || review.interactionCount >= 2;
}

function presentCaptureTuiOutcome(context: DeviceContext, outcome: CaptureTuiOutcome): void {
  if (outcome.reviewPath) presentReviewReference(outcome.reviewPath);
  if (outcome.reason === 'interrupted') {
    presentOutcome('Capture Result', outcome.presentation.text, 'danger');
    process.exitCode = 130;
    return;
  }
  if (!outcome.result) {
    presentOutcome('Capture Result', outcome.presentation.text, 'attention');
    return;
  }
  if (outcome.result.status !== 'succeeded') {
    process.exitCode = outcome.result.status === 'blocked' ? 3 : 1;
  }
  presentDocument(context, renderCaptureResultDocument(outcome.result));
}

async function confirmInTerminal(
  selectedCount: number,
  repositoryPath: string,
): Promise<boolean | undefined> {
  const outcome = await askInTerminal(
    `Apply ${selectedCount} selected repository change(s) to ${repositoryPath}? [y/N] `,
  );
  return outcome.interrupted ? undefined : /^(y|yes)$/i.test(outcome.answer.trim());
}

async function confirmDeletionInTerminal(): Promise<boolean | undefined> {
  const outcome = await askInTerminal('Include this deletion? [y/N] ');
  return outcome.interrupted ? undefined : /^(y|yes)$/i.test(outcome.answer.trim());
}

async function confirmWarningInTerminal(): Promise<boolean | undefined> {
  const outcome = await askInTerminal('Acknowledge this warning and continue? [y/N] ');
  return outcome.interrupted ? undefined : /^(y|yes)$/i.test(outcome.answer.trim());
}

function resolveDeletionConfirmation(
  dependencies: CaptureDependencies,
  deletion: CaptureChange,
): Promise<boolean | undefined> {
  if (dependencies.confirmDeletion) return dependencies.confirmDeletion(deletion);
  return process.stdin.isTTY ? confirmDeletionInTerminal() : Promise.resolve(false);
}

function resolveWarningConfirmation(
  dependencies: CaptureDependencies,
  warning: Issue & { severity: 'warning' },
): Promise<boolean | undefined> {
  if (dependencies.confirmWarning) return dependencies.confirmWarning(warning);
  return process.stdin.isTTY ? confirmWarningInTerminal() : Promise.resolve(false);
}

async function selectConflictInTerminal(
  groupIndex: number,
  groupCount: number,
  message: string,
  name: string,
  candidates: string[],
): Promise<{ interrupted: boolean; choice?: number }> {
  presentBlocks([
    status('decision', `Decision ${groupIndex + 1}/${groupCount}: ${message}`),
    fact('Target', name, 'muted'),
    { kind: 'list', items: candidates.map((candidate, index) => ({ text: `${index + 1}. ${candidate}` })) },
  ]);
  while (true) {
    const outcome = await askInTerminal('Choose authoritative source (blank to skip): ');
    if (outcome.interrupted) return { interrupted: true };
    if (outcome.answer.trim() === '') return { interrupted: false };
    const answer = Number(outcome.answer);
    if (Number.isInteger(answer) && answer > 0 && answer <= candidates.length) {
      return { interrupted: false, choice: answer - 1 };
    }
    presentBlocks([status('decision', `Invalid choice. Enter 1-${candidates.length}, or leave blank to skip.`)]);
  }
}
