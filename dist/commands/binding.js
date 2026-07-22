"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.bind = bind;
exports.unbind = unbind;
exports.migrate = migrate;
const repository_1 = require("../utils/repository");
function bind(context, repositoryPath) {
    (0, repository_1.bindRepository)(context, repositoryPath);
    console.log(`Bound this device to ${repositoryPath}.`);
}
function unbind(context) {
    (0, repository_1.unbindRepository)(context);
    console.log('Removed the MCV repository binding from this device.');
}
function migrate(context, repositoryPath, dryRun) {
    const manifest = (0, repository_1.migrateRepository)(context, repositoryPath, dryRun);
    console.log(`${dryRun ? 'Migration preview' : 'Migrated repository'}: schema v${manifest.schemaVersion}`);
}
