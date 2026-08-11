import { applyInitPlan, createInitPlan, } from '../operations/repository.js';
import { presentJson } from '../renderers/json.js';
import { renderInitDocument } from '../renderers/repository.js';
import { presentDocument } from '../presentation/output.js';
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
