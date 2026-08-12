import { applyInitPlan, createInitPlan, } from '../operations/repository.js';
import { presentJson } from '../renderers/json.js';
import { renderInitDocument } from '../renderers/repository.js';
import { presentDocument } from '../presentation/output.js';
import { askInTerminal } from '../cli/prompt.js';
export function initRepository(context, targetDir = process.cwd(), options = {}) {
    const plan = createInitPlan(context, targetDir);
    if (options.dryRun || !options.yes) {
        render(context, plan, options);
        return plan;
    }
    const result = plan.issues.some((issue) => issue.severity !== 'notice')
        ? blockedInitResult(plan)
        : applyInitPlan(context, plan);
    render(context, result, options);
    if (result.status === 'failed')
        process.exitCode = 1;
    if (result.status === 'blocked')
        process.exitCode = 3;
    return result;
}
export async function initRepositoryInteractively(context, targetDir = process.cwd()) {
    const plan = createInitPlan(context, targetDir);
    render(context, plan, {});
    if (plan.status === 'failed') {
        process.exitCode = 1;
        return plan;
    }
    const outcome = await askInTerminal(`Init · ${plan.changes.length} changes · Repository: ${plan.repositoryPath ?? targetDir} · Apply? [y/N] `);
    if (outcome.interrupted) {
        process.exitCode = 130;
        return plan;
    }
    if (!/^(y|yes)$/i.test(outcome.answer.trim()))
        return plan;
    const result = applyInitPlan(context, plan);
    render(context, result, {});
    if (result.status === 'failed')
        process.exitCode = 1;
    if (result.status === 'blocked')
        process.exitCode = 3;
    return result;
}
function blockedInitResult(plan) {
    return {
        schemaVersion: plan.schemaVersion,
        operation: 'init',
        status: 'blocked',
        repositoryPath: plan.repositoryPath,
        changes: [],
        issues: plan.issues,
        nextActions: ['Review the Init Plan interactively before applying it.'],
    };
}
function render(context, contract, options) {
    if (options.json) {
        presentJson(contract);
        return;
    }
    presentDocument(context, renderInitDocument(contract));
}
