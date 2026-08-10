import { createInterface } from 'readline/promises';
import { applyRestorePlan, createRestorePlan, } from '../operations/restore.js';
import { renderJson } from '../renderers/json.js';
import { renderRestorePlanDocument, renderRestoreResultDocument } from '../renderers/restore.js';
import { presentHumanDocument } from '../cli/human-output.js';
export async function restoreLatestBackup(context, dependencies = {}, options = {}) {
    if (options.global === true && typeof options.target === 'string' && options.target.length > 0) {
        console.error('options --target and --global cannot be used together');
        process.exitCode = 2;
        return;
    }
    const reviewPlan = createRestorePlan(context, options.global === true
        ? { scope: 'global' }
        : { scope: 'project', targetRoot: options.target ?? process.cwd() });
    if (options.dryRun) {
        if (options.json)
            console.log(renderJson(reviewPlan));
        else
            presentHumanDocument(context, renderRestorePlanDocument(reviewPlan), {
                verbose: options.verbose,
            });
        if (reviewPlan.status === 'failed')
            process.exitCode = 1;
        return;
    }
    if (reviewPlan.status === 'failed') {
        const result = applyRestorePlan(context, reviewPlan, { changeIds: [] });
        process.exitCode = 1;
        if (options.json)
            console.log(renderJson(result));
        else
            presentHumanDocument(context, renderRestoreResultDocument(result), {
                verbose: options.verbose,
            });
        return;
    }
    const cancellation = new AbortController();
    const handleInterrupt = () => cancellation.abort();
    process.on('SIGINT', handleInterrupt);
    try {
        if (!options.json && !options.yes) {
            presentHumanDocument(context, renderRestorePlanDocument(reviewPlan), {
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
                    : confirmInTerminal(cancellation));
            }
            catch (error) {
                if (!cancellation.signal.aborted && !isAbortError(error))
                    throw error;
            }
            if (cancellation.signal.aborted) {
                const result = applyRestorePlan(context, reviewPlan, {
                    changeIds: reviewPlan.changes.map((change) => change.id),
                }, { signal: cancellation.signal });
                process.exitCode = 130;
                presentHumanDocument(context, renderRestoreResultDocument(result), {
                    verbose: options.verbose,
                });
                return;
            }
            if (!confirmed) {
                console.log('Restore cancelled; local configuration was not changed.');
                return;
            }
        }
        await new Promise((resolve) => setImmediate(resolve));
        const result = applyRestorePlan(context, reviewPlan, { changeIds: reviewPlan.changes.map((change) => change.id) }, { signal: cancellation.signal, nonInteractive: options.yes });
        if (result.issues.some((issue) => issue.code === 'restore.cancelled'))
            process.exitCode = 130;
        else if (result.status !== 'succeeded')
            process.exitCode = result.status === 'blocked' ? 3 : 1;
        if (options.json)
            console.log(renderJson(result));
        else
            presentHumanDocument(context, renderRestoreResultDocument(result), {
                verbose: options.verbose,
            });
        await new Promise((resolve) => setImmediate(resolve));
    }
    finally {
        process.off('SIGINT', handleInterrupt);
    }
}
async function confirmInTerminal(cancellation) {
    const prompt = createInterface({ input: process.stdin, output: process.stdout });
    const handleInterrupt = () => cancellation.abort();
    prompt.once('SIGINT', handleInterrupt);
    try {
        const answer = await prompt.question('Restore every file in this Plan? [y/N] ', { signal: cancellation.signal });
        return /^(y|yes)$/i.test(answer.trim());
    }
    finally {
        prompt.off('SIGINT', handleInterrupt);
        prompt.close();
    }
}
function isAbortError(error) {
    return error instanceof Error && error.name === 'AbortError';
}
