"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.showStatus = showStatus;
const status_1 = require("../operations/status");
const json_1 = require("../renderers/json");
const status_2 = require("../renderers/status");
async function showStatus(context, options = {}) {
    const report = await (0, status_1.inspectStatus)(context);
    if (options.json)
        console.log((0, json_1.renderJson)(report));
    else
        for (const line of (0, status_2.renderStatusPlain)(report))
            console.log(line);
    return report;
}
