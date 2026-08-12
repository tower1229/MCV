import { applyMigrationPlan, applyBindPlan, applyUnbindPlan, createBindPlan, createMigrationPlan, createUnbindPlan, inspectRepository, } from '../operations/repository.js';
import { renderBindDocument, renderMigrationDocument, renderRepositoryDocument, renderUnbindDocument, } from '../renderers/repository.js';
import { presentJson } from '../renderers/json.js';
import { presentDocument } from '../presentation/output.js';
import { askInTerminal } from '../cli/prompt.js';
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
export async function bindInteractively(context, repositoryPath) {
    const plan = createBindPlan(context, repositoryPath);
    render(context, plan, {}, renderBindDocument);
    if (plan.status === 'failed') {
        process.exitCode = 1;
        return plan;
    }
    const confirmed = await confirmLifecycle('Bind', plan.changes.length, plan.repositoryPath);
    if (confirmed === undefined)
        process.exitCode = 130;
    if (!confirmed)
        return plan;
    const result = applyBindPlan(context, plan);
    render(context, result, {}, renderBindDocument);
    if (result.status === 'failed')
        process.exitCode = 1;
    return result;
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
export async function unbindInteractively(context) {
    const plan = createUnbindPlan(context);
    render(context, plan, {}, renderUnbindDocument);
    if (plan.status === 'failed') {
        process.exitCode = 1;
        return plan;
    }
    const confirmed = await confirmLifecycle('Unbind', plan.changes.length, plan.repositoryPath);
    if (confirmed === undefined)
        process.exitCode = 130;
    if (!confirmed)
        return plan;
    const result = applyUnbindPlan(context, plan);
    render(context, result, {}, renderUnbindDocument);
    if (result.status === 'failed')
        process.exitCode = 1;
    return result;
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
export async function migrateInteractively(context, repositoryPath) {
    const plan = createMigrationPlan(context, repositoryPath);
    presentDocument(context, renderMigrationDocument(plan));
    if (plan.status === 'failed') {
        process.exitCode = 1;
        return plan;
    }
    const confirmed = await confirmLifecycle('Migrate', plan.changes.length, plan.repositoryPath);
    if (confirmed === undefined)
        process.exitCode = 130;
    if (!confirmed)
        return plan;
    const result = applyMigrationPlan(context, plan);
    presentDocument(context, renderMigrationDocument(result));
    if (result.status === 'failed')
        process.exitCode = 1;
    return result;
}
function render(context, contract, options, renderDocument) {
    if (options.json) {
        presentJson(contract);
        return;
    }
    presentDocument(context, renderDocument(contract), { verbose: options.verbose });
}
async function confirmLifecycle(operation, changeCount, repositoryPath) {
    const outcome = await askInTerminal(`${operation} · ${changeCount} changes · Repository: ${repositoryPath ?? 'not bound'} · Apply? [y/N] `);
    return outcome.interrupted ? undefined : /^(y|yes)$/i.test(outcome.answer.trim());
}
