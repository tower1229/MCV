"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.captureConfigurations = captureConfigurations;
const prompt_1 = require("../cli/prompt");
const state_1 = require("../utils/state");
const capture_1 = require("../operations/capture");
const capture_2 = require("../renderers/capture");
const json_1 = require("../renderers/json");
async function captureConfigurations(context, dependencies = {}, options = {}) {
    const capturePlan = await (0, capture_1.createCapturePlan)(context);
    if (options.dryRun) {
        if (options.json)
            console.log((0, json_1.renderJson)(capturePlan));
        else
            for (const line of (0, capture_2.renderCapturePlanPlain)(capturePlan))
                console.log(line);
        if (capturePlan.status === 'failed')
            process.exitCode = 1;
        return;
    }
    if (capturePlan.status === 'failed') {
        const result = await (0, capture_1.applyCapturePlan)(context, capturePlan, { changeIds: [] });
        if (options.json)
            console.log((0, json_1.renderJson)(result));
        else
            for (const line of (0, capture_2.renderCaptureResultPlain)(result))
                console.log(line);
        process.exitCode = 1;
        return;
    }
    if (!options.json && !options.yes) {
        for (const line of (0, capture_2.renderCapturePlanPlain)(capturePlan))
            console.log(line);
    }
    const changeIds = capturePlan.changes
        .filter((change) => change.defaultSelected)
        .map((change) => change.id);
    if (!options.yes) {
        let interrupted = false;
        const decisionGroups = new Map();
        for (const change of capturePlan.changes) {
            if (!change.decisionGroupId)
                continue;
            decisionGroups.set(change.decisionGroupId, [...(decisionGroups.get(change.decisionGroupId) ?? []), change]);
        }
        for (const choices of decisionGroups.values()) {
            const canChoose = dependencies.selectConflict !== undefined || process.stdin.isTTY;
            const choose = dependencies.selectConflict
                ?? (canChoose
                    ? async (name, candidates) => {
                        const outcome = await selectConflictInTerminal(name, candidates);
                        interrupted = outcome.interrupted;
                        return outcome.choice;
                    }
                    : async () => undefined);
            const choice = await choose(choices[0].repositoryPaths[0], choices.map((candidate) => candidate.sourceLabel ?? candidate.id));
            if (interrupted)
                break;
            if (choice !== undefined && choices[choice]?.decision !== 'skip') {
                changeIds.push(choices[choice].id);
            }
            else if (canChoose) {
                const skip = choices.find((candidate) => candidate.decision === 'skip');
                if (skip)
                    changeIds.push(skip.id);
            }
        }
        if (interrupted) {
            process.exitCode = 130;
            console.log('Capture interrupted; repository was not changed.');
            return;
        }
    }
    if (!options.yes) {
        if (!process.stdin.isTTY && !dependencies.confirmCapture) {
            throw new Error('Capture requires an interactive terminal; use --yes only after reviewing --dry-run.');
        }
        const confirmed = await (dependencies.confirmCapture ?? confirmInTerminal)();
        if (confirmed === undefined) {
            process.exitCode = 130;
            console.log('Capture interrupted; repository was not changed.');
            return;
        }
        if (!confirmed) {
            console.log('Capture cancelled; repository was not changed.');
            return;
        }
    }
    const result = await (0, prompt_1.withInterruptsIgnored)(() => (0, capture_1.applyCapturePlan)(context, capturePlan, {
        changeIds,
        confirmedIssueCodes: options.yes
            ? []
            : capturePlan.issues
                .filter((issue) => issue.severity === 'warning')
                .map((issue) => issue.code),
    }, { nonInteractive: options.yes }));
    if (result.status === 'succeeded') {
        const state = (0, state_1.readState)(context);
        state.lastOperation = { kind: 'capture', time: new Date().toISOString(), success: true };
        (0, state_1.writeState)(context, state);
    }
    else {
        process.exitCode = result.status === 'blocked' ? 3 : 1;
    }
    if (options.json)
        console.log((0, json_1.renderJson)(result));
    else
        for (const line of (0, capture_2.renderCaptureResultPlain)(result))
            console.log(line);
}
async function confirmInTerminal() {
    const outcome = await (0, prompt_1.askInTerminal)('Write these changes to the repository? [y/N] ');
    return outcome.interrupted ? undefined : /^(y|yes)$/i.test(outcome.answer.trim());
}
async function selectConflictInTerminal(name, candidates) {
    console.log(`Conflict: ${name}`);
    candidates.forEach((candidate, index) => console.log(`  ${index + 1}. ${candidate}`));
    const outcome = await (0, prompt_1.askInTerminal)('Choose authoritative source (blank to skip): ');
    if (outcome.interrupted)
        return { interrupted: true };
    const answer = Number(outcome.answer);
    return Number.isInteger(answer) && answer > 0 && answer <= candidates.length
        ? { interrupted: false, choice: answer - 1 }
        : { interrupted: false };
}
