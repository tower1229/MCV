#!/usr/bin/env node

import { Command } from 'commander';
import { initRepository } from './commands/init';

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

program.parse();
