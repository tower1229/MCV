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
exports.createProgram = createProgram;
const commander_1 = require("commander");
const os = __importStar(require("os"));
const discover_1 = require("./commands/discover");
const capture_1 = require("./commands/capture");
const init_1 = require("./commands/init");
function createProgram(context = { homeDir: os.homedir() }, captureDependencies = {}) {
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
    program
        .command('capture')
        .description('Capture local AI IDE configuration into the MCV repository')
        .action(async () => {
        await (0, capture_1.captureConfigurations)(context, captureDependencies);
    });
    program
        .command('discover')
        .description('Detect supported AI IDEs and report their configuration paths')
        .action(async () => {
        await (0, discover_1.discoverConfigurations)(context);
    });
    return program;
}
if (require.main === module) {
    createProgram().parse();
}
