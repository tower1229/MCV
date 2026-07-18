#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const commander_1 = require("commander");
const init_1 = require("./commands/init");
const program = new commander_1.Command();
program
    .name('mcv')
    .description('Mobile Configuration Vehicle - Personal AI IDE configuration manager')
    .version('0.1.0');
program
    .command('init')
    .description('Initialize a new MCV repository in the current directory')
    .action(() => {
    (0, init_1.initRepository)();
});
program.parse();
