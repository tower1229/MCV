"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.showRepository = showRepository;
exports.bind = bind;
exports.unbind = unbind;
exports.migrate = migrate;
const repository_1 = require("../utils/repository");
const repository_2 = require("../operations/repository");
const repository_3 = require("../renderers/repository");
const json_1 = require("../renderers/json");
function showRepository(context, options = {}) {
    const report = (0, repository_2.inspectRepository)(context);
    render(report, options, repository_3.renderRepositoryPlain);
    return report;
}
function bind(context, repositoryPath, options = {}) {
    const result = (0, repository_2.applyBindPlan)(context, (0, repository_2.createBindPlan)(context, repositoryPath));
    render(result, options, repository_3.renderBindPlain);
    if (result.status === 'failed')
        process.exitCode = 1;
    return result;
}
function unbind(context, options = {}) {
    const result = (0, repository_2.applyUnbindPlan)(context, (0, repository_2.createUnbindPlan)(context));
    render(result, options, repository_3.renderUnbindPlain);
    return result;
}
function migrate(context, repositoryPath, dryRun) {
    const manifest = (0, repository_1.migrateRepository)(context, repositoryPath, dryRun);
    console.log(`${dryRun ? 'Migration preview' : 'Migrated repository'}: schema v${manifest.schemaVersion}`);
}
function render(contract, options, renderPlain) {
    if (options.json) {
        console.log((0, json_1.renderJson)(contract));
        return;
    }
    for (const line of renderPlain(contract))
        console.log(line);
}
