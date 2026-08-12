import { askInTerminal } from '../cli/prompt.js';
import type { DeviceContext } from '../adapters/types.js';
import {
  applyRestorePlan,
  createRestorePlan,
} from '../operations/restore.js';
import { presentJson } from '../renderers/json.js';
import { renderRestorePlanDocument, renderRestoreResultDocument } from '../renderers/restore.js';
import { presentDiagnostic, presentDocument, presentOutcome } from '../presentation/output.js';
import { createTerminalProgressReporter } from './progress.js';

export interface RestoreDependencies {
  confirmRestore?: () => Promise<boolean>;
}

export interface RestoreOptions {
  dryRun?: boolean;
  json?: boolean;
  yes?: boolean;
  global?: boolean;
  target?: string;
  verbose?: boolean;
}

export async function restoreLatestBackup(
  context: DeviceContext,
  dependencies: RestoreDependencies = {},
  options: RestoreOptions = {},
): Promise<void> {
  const onProgress = createTerminalProgressReporter(options.json);
  if (options.global === true && typeof options.target === 'string' && options.target.length > 0) {
    presentDiagnostic('options --target and --global cannot be used together');
    process.exitCode = 2;
    return;
  }
  const reviewPlan = createRestorePlan(context, options.global === true
    ? { scope: 'global', onProgress }
    : { scope: 'project', targetRoot: options.target ?? process.cwd(), onProgress });
  if (options.dryRun) {
    if (options.json) presentJson(reviewPlan);
    else presentDocument(context, renderRestorePlanDocument(reviewPlan), {
      verbose: options.verbose,
    });
    if (reviewPlan.status === 'failed') process.exitCode = 1;
    return;
  }

  if (reviewPlan.status === 'failed') {
    const result = applyRestorePlan(context, reviewPlan, { changeIds: [] });
    process.exitCode = 1;
    if (options.json) presentJson(result);
    else presentDocument(context, renderRestoreResultDocument(result), {
      verbose: options.verbose,
    });
    return;
  }

  const cancellation = new AbortController();
  const handleInterrupt = (): void => cancellation.abort();
  process.on('SIGINT', handleInterrupt);
  try {
    if (!options.json && !options.yes) {
      presentDocument(context, renderRestorePlanDocument(reviewPlan), {
        verbose: options.verbose,
      });
    }
    if (!options.yes) {
      if (!process.stdin.isTTY && !dependencies.confirmRestore) {
        throw new Error('Restore requires an interactive terminal; use --yes only after reviewing --dry-run.');
      }
      let confirmed = false;
      try {
        confirmed = await (dependencies.confirmRestore
          ? dependencies.confirmRestore()
        : confirmInTerminal(
            cancellation,
            reviewPlan.changes.length,
            options.global === true ? 'device-global locations' : options.target ?? process.cwd(),
          ));
      } catch (error) {
        if (!cancellation.signal.aborted && !isAbortError(error)) throw error;
      }
      if (cancellation.signal.aborted) {
        const result = applyRestorePlan(context, reviewPlan, {
          changeIds: reviewPlan.changes.map((change) => change.id),
        }, { signal: cancellation.signal });
        process.exitCode = 130;
        presentDocument(context, renderRestoreResultDocument(result), {
          verbose: options.verbose,
        });
        return;
      }
      if (!confirmed) {
        presentOutcome('Restore Result', 'Restore cancelled; local configuration was not changed.', 'attention');
        return;
      }
    }

    await new Promise<void>((resolve) => setImmediate(resolve));
    const result = applyRestorePlan(
      context,
      reviewPlan,
      { changeIds: reviewPlan.changes.map((change) => change.id) },
      { signal: cancellation.signal, nonInteractive: options.yes, onProgress },
    );
    if (result.issues.some((issue) => issue.code === 'restore.cancelled')) process.exitCode = 130;
    else if (result.status !== 'succeeded') process.exitCode = result.status === 'blocked' ? 3 : 1;
    if (options.json) presentJson(result);
    else presentDocument(context, renderRestoreResultDocument(result), {
      verbose: options.verbose,
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
  } finally {
    process.off('SIGINT', handleInterrupt);
  }
}

async function confirmInTerminal(
  cancellation: AbortController,
  selectedCount: number,
  targetRoot: string,
): Promise<boolean> {
  const outcome = await askInTerminal(
    `Restore · ${selectedCount} selected changes · target: ${targetRoot} · Apply? [y/N] `,
  );
  if (outcome.interrupted) {
    cancellation.abort();
    const error = new Error('Restore interrupted.');
    error.name = 'AbortError';
    throw error;
  }
  return /^(y|yes)$/i.test(outcome.answer.trim());
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}
