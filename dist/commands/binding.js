"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.showRepository = showRepository;
exports.bind = bind;
exports.unbind = unbind;
exports.migrate = migrate;
const repository_1 = require("../operations/repository");
const repository_2 = require("../renderers/repository");
const json_1 = require("../renderers/json");
function showRepository(context, options = {}) {
    const report = (0, repository_1.inspectRepository)(context);
    render(report, options, repository_2.renderRepositoryPlain);
    return report;
}
function bind(context, repositoryPath, options = {}) {
    const result = (0, repository_1.applyBindPlan)(context, (0, repository_1.createBindPlan)(context, repositoryPath));
    render(result, options, repository_2.renderBindPlain);
    if (result.status === 'failed')
        process.exitCode = 1;
    return result;
}
function unbind(context, options = {}) {
    const result = (0, repository_1.applyUnbindPlan)(context, (0, repository_1.createUnbindPlan)(context));
    render(result, options, repository_2.renderUnbindPlain);
    if (result.status === 'failed')
        process.exitCode = 1;
    return result;
}
function migrate(context, repositoryPath, options = {}) {
    const plan = (0, repository_1.createMigrationPlan)(context, repositoryPath);
    const contract = options.dryRun || !options.yes
        ? plan
        : (0, repository_1.applyMigrationPlan)(context, plan);
    if (options.json)
        console.log((0, json_1.renderJson)(contract));
    else
        for (const line of (0, repository_2.renderMigrationPlain)(contract))
            console.log(line);
    if (contract.status === 'failed')
        process.exitCode = 1;
    return contract;
}
function render(contract, options, renderPlain) {
    if (options.json) {
        console.log((0, json_1.renderJson)(contract));
        return;
    }
    for (const line of renderPlain(contract))
        console.log(line);
}
