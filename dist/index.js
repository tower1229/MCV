#!/usr/bin/env node
import { Command, CommanderError, Option } from 'commander';
import { readFileSync, realpathSync } from 'fs';
import * as os from 'os';
import { fileURLToPath } from 'url';
import { discoverConfigurations } from './commands/discover.js';
import { captureConfigurations, } from './commands/capture.js';
import { initRepository } from './commands/init.js';
import { deployConfigurations, } from './commands/deploy.js';
import { showStatus } from './commands/status.js';
import { restoreLatestBackup } from './commands/restore.js';
import { bind, migrate, showRepository, unbind } from './commands/binding.js';
import { runTuiShell, } from './tui/shell.js';
// package.json is the single version source for both npm and the CLI.
const packageVersion = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
export function createDefaultDeviceContext() {
    return {
        homeDir: os.homedir(),
        platform: process.platform,
        env: process.env,
    };
}
export function createProgram(context = createDefaultDeviceContext(), captureDependencies = {}, deployDependencies = {}) {
    const program = new Command();
    program
        .name('mcv')
        .description('Mobile Configuration Vehicle - Personal AI IDE configuration manager')
        .version(packageVersion);
    const initCommand = program
        .command('init')
        .description('Initialize a new MCV repository in the current directory')
        .option('--dry-run', 'Preview initialization without writing')
        .option('--yes', 'Initialize without prompting after reviewing a dry-run')
        .option('--json', 'Print one machine-readable Plan or Result')
        .action(async (options) => {
        validateWriteOutputOptions(initCommand, options);
        if (shouldUseWriteTui(options)) {
            await runRepositoryShell(context, {
                operation: 'init',
                path: process.cwd(),
            });
        }
        else {
            initRepository(context, process.cwd(), options);
        }
    });
    const captureCommand = program
        .command('capture')
        .description('Capture local AI IDE configuration into the MCV repository')
        .option('--dry-run', 'Show the capture plan without writing')
        .option('--json', 'Print a machine-readable plan')
        .option('--yes', 'Apply default non-conflicting changes without prompting')
        .option('--verbose', 'Show processed file content in the preview')
        .action(async (options) => {
        validateWriteOutputOptions(captureCommand, options);
        if (shouldUseWriteTui(options)) {
            await runShell(context, 'capture', true);
        }
        else {
            await captureConfigurations(context, captureDependencies, options);
        }
    });
    const deployCommand = program
        .command('deploy')
        .description('Deploy repository configuration to this device')
        .option('--dry-run', 'Show the deployment plan without writing')
        .option('--json', 'Print a machine-readable plan')
        .option('--yes', 'Deploy without prompting after a reviewed dry-run')
        .option('--prune-managed', 'Delete stale managed files and exact duplicate Skills from the legacy Codex directory')
        .action(async (options) => {
        validateWriteOutputOptions(deployCommand, options);
        if (shouldUseWriteTui(options)) {
            await runShell(context, 'deploy', true);
        }
        else {
            await deployConfigurations(context, deployDependencies, options);
        }
    });
    const discoverCommand = program
        .command('discover')
        .description('Detect supported AI IDEs and report their configuration paths')
        .addOption(new Option('--plain', 'Print a one-shot English text report'))
        .addOption(new Option('--json', 'Print one machine-readable report'))
        .action(async (options) => {
        if (options.plain && options.json) {
            discoverCommand.error("options '--plain' and '--json' cannot be used together", { exitCode: 2, code: 'mcv.conflictingOutputModes' });
        }
        if (shouldUseReadOnlyTui(options)) {
            await runShell(context, 'environment', true);
        }
        else {
            await discoverConfigurations(context, options);
        }
    });
    const statusCommand = program
        .command('status')
        .description('Compare local configuration with the last deployment')
        .addOption(new Option('--plain', 'Print a one-shot English text report'))
        .addOption(new Option('--json', 'Print one machine-readable report'))
        .action(async (options) => {
        if (options.plain && options.json) {
            statusCommand.error("options '--plain' and '--json' cannot be used together", { exitCode: 2, code: 'mcv.conflictingOutputModes' });
        }
        if (shouldUseReadOnlyTui(options)) {
            await runShell(context, 'overview', true);
        }
        else {
            await showStatus(context, options);
        }
    });
    const restoreCommand = program
        .command('restore')
        .description('Restore local configuration from the latest deployment backup')
        .option('--dry-run', 'Show the Restore Plan without writing')
        .option('--yes', 'Restore without prompting after reviewing a dry-run')
        .option('--json', 'Print one machine-readable Restore Plan or Result')
        .action(async (options) => {
        validateWriteOutputOptions(restoreCommand, options);
        if (shouldUseWriteTui(options)) {
            await runShell(context, 'restore', true);
        }
        else {
            await restoreLatestBackup(context, {}, options);
        }
    });
    const repositoryCommand = program.command('repo')
        .description('Inspect the current MCV Repository binding')
        .addOption(new Option('--plain', 'Print a one-shot English text report'))
        .addOption(new Option('--json', 'Print one machine-readable report'))
        .action(async (options) => {
        if (options.plain && options.json) {
            repositoryCommand.error("options '--plain' and '--json' cannot be used together", { exitCode: 2, code: 'mcv.conflictingOutputModes' });
        }
        if (shouldUseReadOnlyTui(options)) {
            await runRepositoryShell(context);
        }
        else {
            showRepository(context, options);
        }
    });
    const bindCommand = program.command('bind [path]')
        .description('Bind this device to an existing MCV Repository')
        .option('--dry-run', 'Preview the Repository binding without writing')
        .option('--yes', 'Bind without prompting after reviewing a dry-run')
        .addOption(new Option('--json', 'Print one machine-readable Plan or Result'))
        .action(async (repositoryPath, options) => {
        validateWriteOutputOptions(bindCommand, options);
        if (shouldUseWriteTui(options)) {
            await runRepositoryShell(context, {
                operation: 'bind',
                path: repositoryPath ?? process.cwd(),
            });
        }
        else {
            bind(context, repositoryPath, options);
        }
    });
    const unbindCommand = program.command('unbind')
        .description('Remove the Repository binding from this device')
        .option('--dry-run', 'Preview removal of the local Repository binding')
        .option('--yes', 'Remove the local binding without prompting after reviewing a dry-run')
        .addOption(new Option('--json', 'Print one machine-readable Plan or Result'))
        .action(async (options) => {
        validateWriteOutputOptions(unbindCommand, options);
        if (shouldUseWriteTui(options)) {
            await runRepositoryShell(context, { operation: 'unbind' });
        }
        else {
            unbind(context, options);
        }
    });
    const migrateCommand = program.command('migrate [path]').description('Migrate an older repository to the current schema')
        .option('--dry-run', 'Preview migration without writing')
        .option('--yes', 'Migrate without prompting after reviewing a dry-run')
        .option('--json', 'Print one machine-readable Plan or Result')
        .action(async (repositoryPath = process.cwd(), options) => {
        validateWriteOutputOptions(migrateCommand, options);
        if (shouldUseWriteTui(options)) {
            await runRepositoryShell(context, {
                operation: 'migrate',
                path: repositoryPath,
            });
        }
        else {
            migrate(context, repositoryPath, options);
        }
    });
    program.action(async () => {
        if (!process.stdin.isTTY || !process.stdout.isTTY) {
            program.outputHelp();
            return;
        }
        await runShell(context, 'overview', false);
    });
    return program;
}
function shouldUseReadOnlyTui(options) {
    return Boolean(process.stdin.isTTY
        && process.stdout.isTTY
        && !options.plain
        && !options.json);
}
function shouldUseWriteTui(options) {
    return Boolean(process.stdin.isTTY
        && process.stdout.isTTY
        && !options.dryRun
        && !options.yes
        && !options.json);
}
async function runShell(context, route, direct) {
    const outcome = await runTuiShell(context, route);
    reportShellOutcome(outcome, route, direct);
}
async function runRepositoryShell(context, repositoryEntry) {
    const dependencies = repositoryEntry ? { repositoryEntry } : {};
    const outcome = await runTuiShell(context, 'repository', dependencies);
    reportShellOutcome(outcome, 'repository', true);
}
function reportShellOutcome(outcome, initialRoute, direct) {
    const printNextAction = () => {
        if (outcome.nextAction)
            console.log(`Next: ${outcome.nextAction}`);
    };
    if (outcome.reason === 'interrupted') {
        process.exitCode = 130;
        console.log('MCV interrupted.');
        return;
    }
    if (!direct)
        return;
    if (initialRoute === 'repository') {
        if (outcome.operationStatus === 'blocked')
            process.exitCode = 3;
        else if (outcome.operationStatus === 'failed' || outcome.failureMessage) {
            process.exitCode = 1;
        }
        if (outcome.failureMessage) {
            console.error(`Repository failed: ${outcome.failureMessage}`);
            printNextAction();
            return;
        }
        console.log(outcome.summary ?? 'Repository closed without changes.');
        printNextAction();
        return;
    }
    if (initialRoute === 'capture') {
        if (outcome.operationStatus === 'blocked')
            process.exitCode = 3;
        else if (outcome.operationStatus === 'failed' || outcome.failureMessage) {
            process.exitCode = 1;
        }
        if (outcome.failureMessage) {
            console.error(`Capture failed: ${outcome.failureMessage}`);
            printNextAction();
            return;
        }
        console.log(outcome.summary ?? 'Capture closed without applying changes.');
        printNextAction();
        return;
    }
    if (initialRoute === 'deploy') {
        if (outcome.operationStatus === 'blocked')
            process.exitCode = 3;
        else if (outcome.operationStatus === 'failed' || outcome.failureMessage) {
            process.exitCode = 1;
        }
        if (outcome.failureMessage) {
            console.error(`Deploy failed: ${outcome.failureMessage}`);
            printNextAction();
            return;
        }
        console.log(outcome.summary ?? 'Deploy closed without applying changes.');
        printNextAction();
        return;
    }
    if (initialRoute === 'restore') {
        if (outcome.operationStatus === 'blocked')
            process.exitCode = 3;
        else if (outcome.operationStatus === 'failed' || outcome.failureMessage) {
            process.exitCode = 1;
        }
        if (outcome.failureMessage) {
            console.error(`Restore failed: ${outcome.failureMessage}`);
            printNextAction();
            return;
        }
        console.log(outcome.summary ?? 'Restore closed without applying changes.');
        printNextAction();
        return;
    }
    if (outcome.failureMessage) {
        process.exitCode = 1;
        console.error(`${outcome.route === 'overview' ? 'Overview' : 'Environment Details'} failed: ${outcome.failureMessage}`);
        printNextAction();
        return;
    }
    console.log(outcome.summary ?? `${initialRoute === 'overview' ? 'Overview' : 'Environment Details'} closed before its Report was ready.`);
    printNextAction();
}
function validateWriteOutputOptions(command, options) {
    if (options.dryRun && options.yes) {
        command.error("options '--dry-run' and '--yes' cannot be used together", {
            exitCode: 2,
            code: 'mcv.conflictingWriteModes',
        });
    }
    if (options.json && !options.dryRun && !options.yes) {
        command.error("option '--json' requires '--dry-run' or '--yes'", {
            exitCode: 2,
            code: 'mcv.missingWriteMode',
        });
    }
}
export async function runCli(argv = process.argv) {
    const program = createProgram();
    program.exitOverride();
    for (const command of program.commands)
        command.exitOverride();
    try {
        await program.parseAsync(argv);
    }
    catch (error) {
        if (error instanceof CommanderError) {
            process.exitCode = normalizeCommanderExitCode(error);
            return;
        }
        process.exitCode = 1;
        console.error(`MCV failed: ${error instanceof Error ? error.message : String(error)}`);
    }
}
function normalizeCommanderExitCode(error) {
    if (error.exitCode === 0)
        return 0;
    if (error.exitCode === 2 || error.code.startsWith('mcv.'))
        return 2;
    return error.code.startsWith('commander.') ? 2 : 1;
}
if (isMainModule()) {
    void runCli();
}
function isMainModule() {
    const entryPoint = process.argv[1];
    if (!entryPoint)
        return false;
    try {
        return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(entryPoint);
    }
    catch {
        return false;
    }
}
