"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.restoreLatestBackup = restoreLatestBackup;
const promises_1 = require("readline/promises");
const restore_1 = require("../operations/restore");
const json_1 = require("../renderers/json");
const restore_2 = require("../renderers/restore");
async function restoreLatestBackup(context, dependencies = {}, options = {}) {
    const reviewPlan = (0, restore_1.createRestorePlan)(context);
    if (options.dryRun) {
        if (options.json)
            console.log((0, json_1.renderJson)(reviewPlan));
        else
            for (const line of (0, restore_2.renderRestorePlanPlain)(reviewPlan))
                console.log(line);
        if (reviewPlan.status === 'failed')
            process.exitCode = 1;
        return;
    }
    if (reviewPlan.status === 'failed') {
        const result = (0, restore_1.applyRestorePlan)(context, reviewPlan, { changeIds: [] });
        process.exitCode = 1;
        if (options.json)
            console.log((0, json_1.renderJson)(result));
        else
            for (const line of (0, restore_2.renderRestoreResultPlain)(result))
                console.log(line);
        return;
    }
    const cancellation = new AbortController();
    const handleInterrupt = () => cancellation.abort();
    process.on('SIGINT', handleInterrupt);
    try {
        if (!options.json && !options.yes) {
            for (const line of (0, restore_2.renderRestorePlanPlain)(reviewPlan))
                console.log(line);
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
                const result = (0, restore_1.applyRestorePlan)(context, reviewPlan, {
                    changeIds: reviewPlan.changes.map((change) => change.id),
                }, { signal: cancellation.signal });
                process.exitCode = 130;
                for (const line of (0, restore_2.renderRestoreResultPlain)(result))
                    console.log(line);
                return;
            }
            if (!confirmed) {
                console.log('Restore cancelled; local configuration was not changed.');
                return;
            }
        }
        await new Promise((resolve) => setImmediate(resolve));
        const result = (0, restore_1.applyRestorePlan)(context, reviewPlan, { changeIds: reviewPlan.changes.map((change) => change.id) }, { signal: cancellation.signal, nonInteractive: options.yes });
        if (result.issues.some((issue) => issue.code === 'restore.cancelled'))
            process.exitCode = 130;
        else if (result.status !== 'succeeded')
            process.exitCode = result.status === 'blocked' ? 3 : 1;
        if (options.json)
            console.log((0, json_1.renderJson)(result));
        else
            for (const line of (0, restore_2.renderRestoreResultPlain)(result))
                console.log(line);
        await new Promise((resolve) => setImmediate(resolve));
    }
    finally {
        process.off('SIGINT', handleInterrupt);
    }
}
async function confirmInTerminal(cancellation) {
    const prompt = (0, promises_1.createInterface)({ input: process.stdin, output: process.stdout });
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
