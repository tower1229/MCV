import { applyMigrationPlan, applyBindPlan, applyUnbindPlan, createBindPlan, createMigrationPlan, createUnbindPlan, inspectRepository, } from '../operations/repository.js';
import { renderBindPlain, renderMigrationPlain, renderRepositoryPlain, renderUnbindPlain, } from '../renderers/repository.js';
import { renderJson } from '../renderers/json.js';
export function showRepository(context, options = {}) {
    const report = inspectRepository(context);
    render(report, options, renderRepositoryPlain);
    return report;
}
export function bind(context, repositoryPath, options = {}) {
    const plan = createBindPlan(context, repositoryPath);
    const contract = options.dryRun || !options.yes
        ? plan
        : applyBindPlan(context, plan);
    render(contract, options, renderBindPlain);
    if (contract.status === 'failed')
        process.exitCode = 1;
    return contract;
}
export function unbind(context, options = {}) {
    const plan = createUnbindPlan(context);
    const contract = options.dryRun || !options.yes
        ? plan
        : applyUnbindPlan(context, plan);
    render(contract, options, renderUnbindPlain);
    if (contract.status === 'failed')
        process.exitCode = 1;
    return contract;
}
export function migrate(context, repositoryPath, options = {}) {
    const plan = createMigrationPlan(context, repositoryPath);
    const contract = options.dryRun || !options.yes
        ? plan
        : applyMigrationPlan(context, plan);
    if (options.json)
        console.log(renderJson(contract));
    else
        for (const line of renderMigrationPlain(contract))
            console.log(line);
    if (contract.status === 'failed')
        process.exitCode = 1;
    return contract;
}
function render(contract, options, renderPlain) {
    if (options.json) {
        console.log(renderJson(contract));
        return;
    }
    for (const line of renderPlain(contract))
        console.log(line);
}
