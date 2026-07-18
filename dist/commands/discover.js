"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.discoverConfigurations = discoverConfigurations;
const claude_code_1 = require("../adapters/claude-code");
async function discoverConfigurations(context) {
    const adapter = new claude_code_1.ClaudeCodeAdapter();
    const [ide, files] = await Promise.all([
        adapter.detect(context),
        adapter.discoverFiles(context),
    ]);
    console.log(`${ide.name}: ${ide.detected ? 'detected' : 'not detected'}`);
    for (const configPath of [...ide.configDirectories, ...files]) {
        console.log(`[${configPath.exists ? 'found' : 'missing'}] ${configPath.path}`);
    }
}
