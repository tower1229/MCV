import { createInterface } from 'readline/promises';
import type { DeviceContext } from '../adapters/types';
import {
  applyRestorePlan,
  createRestorePlan,
} from '../operations/restore';
import { renderJson } from '../renderers/json';
import { renderRestorePlanPlain, renderRestoreResultPlain } from '../renderers/restore';

export interface RestoreDependencies {
  confirmRestore?: () => Promise<boolean>;
}

export interface RestoreOptions {
  dryRun?: boolean;
  json?: boolean;
  yes?: boolean;
}

export async function restoreLatestBackup(
  context: DeviceContext,
  dependencies: RestoreDependencies = {},
  options: RestoreOptions = {},
): Promise<void> {
  const reviewPlan = createRestorePlan(context);
  if (options.dryRun) {
    if (options.json) console.log(renderJson(reviewPlan));
    else for (const line of renderRestorePlanPlain(reviewPlan)) console.log(line);
    if (reviewPlan.status === 'failed') process.exitCode = 1;
    return;
  }

  if (reviewPlan.status === 'failed') {
    const result = applyRestorePlan(context, reviewPlan, { changeIds: [] });
    process.exitCode = 1;
    if (options.json) console.log(renderJson(result));
    else for (const line of renderRestoreResultPlain(result)) console.log(line);
    return;
  }

  const cancellation = new AbortController();
  const handleInterrupt = (): void => cancellation.abort();
  process.on('SIGINT', handleInterrupt);
  try {
    if (!options.json && !options.yes) {
      for (const line of renderRestorePlanPlain(reviewPlan)) console.log(line);
    }
    if (!options.yes) {
      if (!process.stdin.isTTY && !dependencies.confirmRestore) {
        throw new Error('Restore requires an interactive terminal; use --yes only after reviewing --dry-run.');
      }
      let confirmed = false;
      try {
        confirmed = await (dependencies.confirmRestore
          ? dependencies.confirmRestore()
          : confirmInTerminal(cancellation));
      } catch (error) {
        if (!cancellation.signal.aborted && !isAbortError(error)) throw error;
      }
      if (cancellation.signal.aborted) {
        const result = applyRestorePlan(context, reviewPlan, {
          changeIds: reviewPlan.changes.map((change) => change.id),
        }, { signal: cancellation.signal });
        process.exitCode = 130;
        for (const line of renderRestoreResultPlain(result)) console.log(line);
        return;
      }
      if (!confirmed) {
        console.log('Restore cancelled; local configuration was not changed.');
        return;
      }
    }

    await new Promise<void>((resolve) => setImmediate(resolve));
    const result = applyRestorePlan(
      context,
      reviewPlan,
      { changeIds: reviewPlan.changes.map((change) => change.id) },
      { signal: cancellation.signal, nonInteractive: options.yes },
    );
    if (result.issues.some((issue) => issue.code === 'restore.cancelled')) process.exitCode = 130;
    else if (result.status !== 'succeeded') process.exitCode = result.status === 'blocked' ? 3 : 1;
    if (options.json) console.log(renderJson(result));
    else for (const line of renderRestoreResultPlain(result)) console.log(line);
    await new Promise<void>((resolve) => setImmediate(resolve));
  } finally {
    process.off('SIGINT', handleInterrupt);
  }
}

async function confirmInTerminal(cancellation: AbortController): Promise<boolean> {
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  const handleInterrupt = (): void => cancellation.abort();
  prompt.once('SIGINT', handleInterrupt);
  try {
    const answer = await prompt.question(
      'Restore every file in this Plan? [y/N] ',
      { signal: cancellation.signal },
    );
    return /^(y|yes)$/i.test(answer.trim());
  } finally {
    prompt.off('SIGINT', handleInterrupt);
    prompt.close();
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}
