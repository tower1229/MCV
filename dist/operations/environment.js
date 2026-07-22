"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.inspectEnvironment = inspectEnvironment;
const adapters_1 = require("../adapters");
const contracts_1 = require("./contracts");
async function inspectEnvironment(context) {
    const environments = await Promise.all((0, adapters_1.createAdapterDefinitions)().map(async ({ adapter }) => {
        const [ide, configFiles] = await Promise.all([
            adapter.detect(context),
            adapter.discoverFiles(context),
        ]);
        return {
            id: ide.id,
            name: ide.name,
            detected: ide.detected,
            configDirectories: ide.configDirectories,
            configFiles,
        };
    }));
    return {
        schemaVersion: contracts_1.OPERATION_SCHEMA_VERSION,
        operation: 'discover',
        status: 'reported',
        ready: true,
        environments,
        issues: [],
        nextActions: [],
    };
}
