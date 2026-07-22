#!/usr/bin/env node

import { Command } from 'commander';
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
import { bind, migrate, unbind } from './commands/binding';
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

  program
    .command('init')
    .description('Initialize a new MCV repository in the current directory')
    .action(async () => {
      const initialized = initRepository(context);
      if (!initialized || !process.stdin.isTTY) return;
      await discoverConfigurations(context);
      const prompt = createInterface({ input: process.stdin, output: process.stdout });
      let shouldCapture = false;
      try {
        const answer = await prompt.question('Capture discovered configuration now? [Y/n] ');
        shouldCapture = !/^(n|no)$/i.test(answer.trim());
      } finally { prompt.close(); }
      if (shouldCapture) await captureConfigurations(context, captureDependencies);
    });

  program
    .command('capture')
    .description('Capture local AI IDE configuration into the MCV repository')
    .option('--dry-run', 'Show the capture plan without writing')
    .option('--json', 'Print a machine-readable plan')
    .option('--yes', 'Apply only safe non-conflicting changes without prompting')
    .option('--verbose', 'Show processed file content in the preview')
    .action(async (options) => {
      await captureConfigurations(context, captureDependencies, options);
    });

  program
    .command('deploy')
    .description('Deploy repository configuration to this device')
    .option('--dry-run', 'Show the deployment plan without writing')
    .option('--json', 'Print a machine-readable plan')
    .option('--yes', 'Deploy without prompting after a reviewed dry-run')
    .option('--prune-managed', 'Delete stale managed files and exact duplicate Skills from the legacy Codex directory')
    .action(async (options) => {
      await deployConfigurations(context, deployDependencies, options);
    });

  program
    .command('discover')
    .description('Detect supported AI IDEs and report their configuration paths')
    .action(async () => {
      await discoverConfigurations(context);
    });

  program
    .command('status')
    .description('Compare local configuration with the last deployment')
    .action(async () => {
      await showStatus(context);
    });

  program
    .command('restore')
    .description('Restore local configuration from the latest deployment backup')
    .action(() => {
      restoreLatestBackup(context);
    });

  program.command('bind <path>').description('Bind this device to an existing MCV repository').action((repositoryPath) => bind(context, repositoryPath));
  program.command('unbind').description('Remove the repository binding from this device').action(() => unbind(context));
  program.command('migrate [path]').description('Migrate a v1 repository to schema v2')
    .option('--dry-run', 'Preview migration without writing')
    .action((repositoryPath = process.cwd(), options) => migrate(context, repositoryPath, options.dryRun === true));

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

if (require.main === module) {
  createProgram().parse();
}
