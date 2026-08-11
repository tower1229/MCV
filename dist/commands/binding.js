import { applyMigrationPlan, applyBindPlan, applyUnbindPlan, createBindPlan, createMigrationPlan, createUnbindPlan, inspectRepository, } from '../operations/repository.js';
import { renderBindDocument, renderMigrationDocument, renderRepositoryDocument, renderUnbindDocument, } from '../renderers/repository.js';
import { presentJson } from '../renderers/json.js';
import { presentDocument } from '../presentation/output.js';
export function showRepository(context, options = {}) {
    const report = inspectRepository(context);
    render(context, report, options, renderRepositoryDocument);
    return report;
}
export function bind(context, repositoryPath, options = {}) {
    const plan = createBindPlan(context, repositoryPath);
    const contract = options.dryRun || !options.yes
        ? plan
        : applyBindPlan(context, plan);
    render(context, contract, options, renderBindDocument);
    if (contract.status === 'failed')
        process.exitCode = 1;
    return contract;
}
export function unbind(context, options = {}) {
    const plan = createUnbindPlan(context);
    const contract = options.dryRun || !options.yes
        ? plan
        : applyUnbindPlan(context, plan);
    render(context, contract, options, renderUnbindDocument);
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
        presentJson(contract);
    else
        presentDocument(context, renderMigrationDocument(contract), {
            verbose: options.verbose,
        });
    if (contract.status === 'failed')
        process.exitCode = 1;
    return contract;
}
function render(context, contract, options, renderDocument) {
    if (options.json) {
        presentJson(contract);
        return;
    }
    presentDocument(context, renderDocument(contract), { verbose: options.verbose });
}
