"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.discoverConfigurations = discoverConfigurations;
const adapters_1 = require("../adapters");
async function discoverConfigurations(context) {
    for (const { adapter } of (0, adapters_1.createAdapterDefinitions)()) {
        const [ide, files] = await Promise.all([
            adapter.detect(context),
            adapter.discoverFiles(context),
        ]);
        console.log(`${ide.name}: ${ide.detected ? 'detected' : 'not detected'}`);
        for (const configPath of [...ide.configDirectories, ...files]) {
            console.log(`[${configPath.exists ? 'found' : 'missing'}] ${configPath.path}`);
        }
    }
}
