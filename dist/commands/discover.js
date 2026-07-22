"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.discoverConfigurations = discoverConfigurations;
const environment_1 = require("../operations/environment");
const environment_2 = require("../renderers/environment");
const json_1 = require("../renderers/json");
async function discoverConfigurations(context, options = {}) {
    const report = await (0, environment_1.inspectEnvironment)(context);
    if (options.json) {
        console.log((0, json_1.renderJson)(report));
    }
    else {
        for (const line of (0, environment_2.renderEnvironmentPlain)(report))
            console.log(line);
    }
    return report;
}
