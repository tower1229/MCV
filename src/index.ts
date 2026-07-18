#!/usr/bin/env node

import { Command } from 'commander';
import * as os from 'os';
import type { DeviceContext } from './adapters/types';
import { discoverConfigurations } from './commands/discover';
import { initRepository } from './commands/init';

export function createProgram(
  context: DeviceContext = { homeDir: os.homedir() },
): Command {
  const program = new Command();

  program
    .name('mcv')
    .description('Mobile Configuration Vehicle - Personal AI IDE configuration manager')
    .version('0.1.0');

  program
    .command('init')
    .description('Initialize a new MCV repository in the current directory')
    .action(() => {
      initRepository();
    });

  program
    .command('discover')
    .description('Detect supported AI IDEs and report their configuration paths')
    .action(async () => {
      await discoverConfigurations(context);
    });

  return program;
}

if (require.main === module) {
  createProgram().parse();
}
