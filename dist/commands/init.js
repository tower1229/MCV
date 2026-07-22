"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.initRepository = initRepository;
const repository_1 = require("../operations/repository");
const json_1 = require("../renderers/json");
const repository_2 = require("../renderers/repository");
function initRepository(context, targetDir = process.cwd(), options = {}) {
    const plan = (0, repository_1.createInitPlan)(context, targetDir);
    if (options.dryRun || !options.yes) {
        render(plan, options);
        return plan;
    }
    const result = plan.issues.some((issue) => issue.severity !== 'notice')
        ? blockedInitResult(plan)
        : (0, repository_1.applyInitPlan)(context, plan);
    render(result, options);
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
function render(contract, options) {
    if (options.json) {
        console.log((0, json_1.renderJson)(contract));
        return;
    }
    for (const line of (0, repository_2.renderInitPlain)(contract))
        console.log(line);
}
