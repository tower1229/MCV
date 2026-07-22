#!/usr/bin/env node
"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.createDefaultDeviceContext = createDefaultDeviceContext;
exports.createProgram = createProgram;
const commander_1 = require("commander");
const os = __importStar(require("os"));
const discover_1 = require("./commands/discover");
const capture_1 = require("./commands/capture");
const init_1 = require("./commands/init");
const deploy_1 = require("./commands/deploy");
const status_1 = require("./commands/status");
const restore_1 = require("./commands/restore");
const binding_1 = require("./commands/binding");
const promises_1 = require("readline/promises");
// package.json is the single version source for both npm and the CLI.
const packageVersion = require('../package.json').version;
function createDefaultDeviceContext() {
    return {
        homeDir: os.homedir(),
        platform: process.platform,
        env: process.env,
    };
}
function createProgram(context = createDefaultDeviceContext(), captureDependencies = {}, deployDependencies = {}) {
    const program = new commander_1.Command();
    program
        .name('mcv')
        .description('Mobile Configuration Vehicle - Personal AI IDE configuration manager')
        .version(packageVersion);
    program
        .command('init')
        .description('Initialize a new MCV repository in the current directory')
        .action(async () => {
        const initialized = (0, init_1.initRepository)(context);
        if (!initialized || !process.stdin.isTTY)
            return;
        await (0, discover_1.discoverConfigurations)(context);
        const prompt = (0, promises_1.createInterface)({ input: process.stdin, output: process.stdout });
        let shouldCapture = false;
        try {
            const answer = await prompt.question('Capture discovered configuration now? [Y/n] ');
            shouldCapture = !/^(n|no)$/i.test(answer.trim());
        }
        finally {
            prompt.close();
        }
        if (shouldCapture)
            await (0, capture_1.captureConfigurations)(context, captureDependencies);
    });
    program
        .command('capture')
        .description('Capture local AI IDE configuration into the MCV repository')
        .option('--dry-run', 'Show the capture plan without writing')
        .option('--json', 'Print a machine-readable plan')
        .option('--yes', 'Apply only safe non-conflicting changes without prompting')
        .option('--verbose', 'Show processed file content in the preview')
        .action(async (options) => {
        await (0, capture_1.captureConfigurations)(context, captureDependencies, options);
    });
    program
        .command('deploy')
        .description('Deploy repository configuration to this device')
        .option('--dry-run', 'Show the deployment plan without writing')
        .option('--json', 'Print a machine-readable plan')
        .option('--yes', 'Deploy without prompting after a reviewed dry-run')
        .option('--prune-managed', 'Delete stale managed files and exact duplicate Skills from the legacy Codex directory')
        .action(async (options) => {
        await (0, deploy_1.deployConfigurations)(context, deployDependencies, options);
    });
    const discoverCommand = program
        .command('discover')
        .description('Detect supported AI IDEs and report their configuration paths')
        .addOption(new commander_1.Option('--plain', 'Print a one-shot English text report'))
        .addOption(new commander_1.Option('--json', 'Print one machine-readable report'))
        .action(async (options) => {
        if (options.plain && options.json) {
            discoverCommand.error("options '--plain' and '--json' cannot be used together", { exitCode: 2, code: 'mcv.conflictingOutputModes' });
        }
        await (0, discover_1.discoverConfigurations)(context, options);
    });
    program
        .command('status')
        .description('Compare local configuration with the last deployment')
        .action(async () => {
        await (0, status_1.showStatus)(context);
    });
    program
        .command('restore')
        .description('Restore local configuration from the latest deployment backup')
        .action(() => {
        (0, restore_1.restoreLatestBackup)(context);
    });
    const repositoryCommand = program.command('repo')
        .description('Inspect the current MCV Repository binding')
        .addOption(new commander_1.Option('--plain', 'Print a one-shot English text report'))
        .addOption(new commander_1.Option('--json', 'Print one machine-readable report'))
        .action((options) => {
        if (options.plain && options.json) {
            repositoryCommand.error("options '--plain' and '--json' cannot be used together", { exitCode: 2, code: 'mcv.conflictingOutputModes' });
        }
        (0, binding_1.showRepository)(context, options);
    });
    program.command('bind [path]')
        .description('Bind this device to an existing MCV Repository')
        .addOption(new commander_1.Option('--json', 'Print one machine-readable result'))
        .action((repositoryPath, options) => {
        (0, binding_1.bind)(context, repositoryPath, options);
    });
    program.command('unbind')
        .description('Remove the Repository binding from this device')
        .addOption(new commander_1.Option('--json', 'Print one machine-readable result'))
        .action((options) => {
        (0, binding_1.unbind)(context, options);
    });
    program.command('migrate [path]').description('Migrate a v1 repository to schema v2')
        .option('--dry-run', 'Preview migration without writing')
        .action((repositoryPath = process.cwd(), options) => (0, binding_1.migrate)(context, repositoryPath, options.dryRun === true));
    program.action(async () => {
        if (!process.stdin.isTTY) {
            program.outputHelp();
            return;
        }
        const prompt = (0, promises_1.createInterface)({ input: process.stdin, output: process.stdout });
        let command;
        let repositoryPath;
        try {
            const answer = await prompt.question('MCV: 1) discover 2) capture 3) deploy 4) status 5) restore 6) bind  Select: ');
            if (answer.trim() === '6') {
                repositoryPath = (await prompt.question('Repository path (blank to cancel): ')).trim();
            }
            else {
                command = { '1': 'discover', '2': 'capture', '3': 'deploy', '4': 'status', '5': 'restore' }[answer.trim()];
            }
        }
        finally {
            prompt.close();
        }
        if (repositoryPath)
            (0, binding_1.bind)(context, repositoryPath);
        else if (command)
            await createProgram(context, captureDependencies, deployDependencies).parseAsync(['node', 'mcv', command]);
    });
    return program;
}
if (require.main === module) {
    createProgram().parse();
}
