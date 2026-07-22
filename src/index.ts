#!/usr/bin/env node

import { Command, Option } from 'commander';
import * as os from 'os';
import type { DeviceContext } from './adapters/types';
import { discoverConfigurations } from './commands/discover';
import {
  captureConfigurations,
  type CaptureDependencies,
} from './commands/capture';
import { initRepository } from './commands/init';
import {
  deployConfigurations,
  type DeployDependencies,
} from './commands/deploy';
import { showStatus } from './commands/status';
import { restoreLatestBackup } from './commands/restore';
import { bind, migrate, showRepository, unbind } from './commands/binding';
import { createInterface } from 'readline/promises';
// package.json is the single version source for both npm and the CLI.
const packageVersion = (require('../package.json') as { version: string }).version;

export function createDefaultDeviceContext(): DeviceContext {
  return {
    homeDir: os.homedir(),
    platform: process.platform,
    env: process.env,
  };
}

export function createProgram(
  context: DeviceContext = createDefaultDeviceContext(),
  captureDependencies: CaptureDependencies = {},
  deployDependencies: DeployDependencies = {},
): Command {
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
      const result = initRepository(context, process.cwd(), options);
      if (result.status !== 'succeeded' || !process.stdin.isTTY) return;
      await discoverConfigurations(context);
      const prompt = createInterface({ input: process.stdin, output: process.stdout });
      let shouldCapture = false;
      try {
        const answer = await prompt.question('Capture discovered configuration now? [Y/n] ');
        shouldCapture = !/^(n|no)$/i.test(answer.trim());
      } finally { prompt.close(); }
      if (shouldCapture) await captureConfigurations(context, captureDependencies);
    });

  const captureCommand = program
    .command('capture')
    .description('Capture local AI IDE configuration into the MCV repository')
    .option('--dry-run', 'Show the capture plan without writing')
    .option('--json', 'Print a machine-readable plan')
    .option('--yes', 'Apply only safe non-conflicting changes without prompting')
    .option('--verbose', 'Show processed file content in the preview')
    .action(async (options) => {
      validateWriteOutputOptions(captureCommand, options);
      await captureConfigurations(context, captureDependencies, options);
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
      await deployConfigurations(context, deployDependencies, options);
    });

  const discoverCommand = program
    .command('discover')
    .description('Detect supported AI IDEs and report their configuration paths')
    .addOption(new Option('--plain', 'Print a one-shot English text report'))
    .addOption(new Option('--json', 'Print one machine-readable report'))
    .action(async (options) => {
      if (options.plain && options.json) {
        discoverCommand.error(
          "options '--plain' and '--json' cannot be used together",
          { exitCode: 2, code: 'mcv.conflictingOutputModes' },
        );
      }
      await discoverConfigurations(context, options);
    });

  const statusCommand = program
    .command('status')
    .description('Compare local configuration with the last deployment')
    .addOption(new Option('--plain', 'Print a one-shot English text report'))
    .addOption(new Option('--json', 'Print one machine-readable report'))
    .action(async (options) => {
      if (options.plain && options.json) {
        statusCommand.error(
          "options '--plain' and '--json' cannot be used together",
          { exitCode: 2, code: 'mcv.conflictingOutputModes' },
        );
      }
      await showStatus(context, options);
    });

  const restoreCommand = program
    .command('restore')
    .description('Restore local configuration from the latest deployment backup')
    .option('--dry-run', 'Show the Restore Plan without writing')
    .option('--yes', 'Restore without prompting after reviewing a dry-run')
    .option('--json', 'Print one machine-readable Restore Plan or Result')
    .action(async (options) => {
      validateWriteOutputOptions(restoreCommand, options);
      await restoreLatestBackup(context, {}, options);
    });

  const repositoryCommand = program.command('repo')
    .description('Inspect the current MCV Repository binding')
    .addOption(new Option('--plain', 'Print a one-shot English text report'))
    .addOption(new Option('--json', 'Print one machine-readable report'))
    .action((options) => {
      if (options.plain && options.json) {
        repositoryCommand.error(
          "options '--plain' and '--json' cannot be used together",
          { exitCode: 2, code: 'mcv.conflictingOutputModes' },
        );
      }
      showRepository(context, options);
    });

  program.command('bind [path]')
    .description('Bind this device to an existing MCV Repository')
    .addOption(new Option('--json', 'Print one machine-readable result'))
    .action((repositoryPath, options) => {
      bind(context, repositoryPath, options);
    });
  program.command('unbind')
    .description('Remove the Repository binding from this device')
    .addOption(new Option('--json', 'Print one machine-readable result'))
    .action((options) => {
      unbind(context, options);
    });
  const migrateCommand = program.command('migrate [path]').description('Migrate a v1 repository to schema v2')
    .option('--dry-run', 'Preview migration without writing')
    .option('--yes', 'Migrate without prompting after reviewing a dry-run')
    .option('--json', 'Print one machine-readable Plan or Result')
    .action((repositoryPath = process.cwd(), options) => {
      validateWriteOutputOptions(migrateCommand, options);
      migrate(context, repositoryPath, options);
    });

  program.action(async () => {
    if (!process.stdin.isTTY) { program.outputHelp(); return; }
    const prompt = createInterface({ input: process.stdin, output: process.stdout });
    let command: string | undefined;
    let repositoryPath: string | undefined;
    try {
      const answer = await prompt.question('MCV: 1) discover 2) capture 3) deploy 4) status 5) restore 6) bind  Select: ');
      if (answer.trim() === '6') {
        repositoryPath = (await prompt.question('Repository path (blank to cancel): ')).trim();
      } else {
        command = ({ '1': 'discover', '2': 'capture', '3': 'deploy', '4': 'status', '5': 'restore' } as Record<string, string>)[answer.trim()];
      }
    } finally { prompt.close(); }
    if (repositoryPath) bind(context, repositoryPath);
    else if (command) await createProgram(context, captureDependencies, deployDependencies).parseAsync(['node', 'mcv', command]);
  });

  return program;
}

function validateWriteOutputOptions(
  command: Command,
  options: { dryRun?: boolean; yes?: boolean; json?: boolean },
): void {
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

if (require.main === module) {
  createProgram().parse();
}
