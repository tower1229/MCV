"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deployConfigurations = deployConfigurations;
const promises_1 = require("readline/promises");
const adapters_1 = require("../adapters");
const repository_1 = require("../utils/repository");
const deploy_1 = require("../operations/deploy");
const deploy_2 = require("../renderers/deploy");
const json_1 = require("../renderers/json");
async function deployConfigurations(context, dependencies = {}, options = {}) {
    const reviewPlan = await (0, deploy_1.createDeployPlan)(context);
    if (options.dryRun) {
        if (options.json)
            console.log((0, json_1.renderJson)(reviewPlan));
        else
            for (const line of (0, deploy_2.renderDeployPlanPlain)(reviewPlan))
                console.log(line);
        if (reviewPlan.status === 'failed')
            process.exitCode = 1;
        return;
    }
    if (reviewPlan.status !== 'failed' && reviewPlan.changes.length === 0) {
        if (options.json) {
            const result = await (0, deploy_1.applyDeployPlan)(context, reviewPlan, { changeIds: [] }, { nonInteractive: options.yes });
            console.log((0, json_1.renderJson)(result));
            if (result.status !== 'succeeded')
                process.exitCode = result.status === 'blocked' ? 3 : 1;
        }
        else {
            const manifest = reviewPlan.repositoryPath ? (0, repository_1.readManifest)(reviewPlan.repositoryPath) : undefined;
            const enabled = (0, adapters_1.createAdapterDefinitions)().filter(({ targetId }) => manifest?.targets?.[targetId]?.enabled === true);
            const subject = enabled.length === 1 ? `${enabled[0].name} configuration is` : 'Configurations are';
            console.log(`${subject} already in sync.`);
        }
        return;
    }
    if (!options.json && !options.yes) {
        for (const line of (0, deploy_2.renderDeployPlanPlain)(reviewPlan))
            console.log(line);
    }
    if (!options.yes) {
        if (!process.stdin.isTTY && !dependencies.confirmDeploy) {
            throw new Error('Deploy requires an interactive terminal; use --yes only after reviewing --dry-run.');
        }
        const confirmed = await (dependencies.confirmDeploy ?? confirmInTerminal)();
        if (!confirmed) {
            console.log('Deploy cancelled; local configuration was not changed.');
            return;
        }
    }
    const selectedIds = reviewPlan.status === 'failed'
        ? []
        : reviewPlan.changes
            .filter((change) => change.defaultSelected
            || (options.pruneManaged === true && change.change === 'delete'))
            .map((change) => change.id);
    const result = await (0, deploy_1.applyDeployPlan)(context, reviewPlan, {
        changeIds: selectedIds,
        confirmedIssueCodes: options.yes
            ? []
            : reviewPlan.issues
                .filter((issue) => issue.severity === 'warning')
                .map((issue) => issue.code),
    }, { nonInteractive: options.yes });
    if (result.status !== 'succeeded')
        process.exitCode = result.status === 'blocked' ? 3 : 1;
    if (options.json)
        console.log((0, json_1.renderJson)(result));
    else
        for (const line of (0, deploy_2.renderDeployResultPlain)(result))
            console.log(line);
}
async function confirmInTerminal() {
    const prompt = (0, promises_1.createInterface)({ input: process.stdin, output: process.stdout });
    try {
        const answer = await prompt.question('Write these changes to this device? [y/N] ');
        return /^(y|yes)$/i.test(answer.trim());
    }
    finally {
        prompt.close();
    }
}
