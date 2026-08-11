#!/usr/bin/env node

import { Command, CommanderError, Option } from 'commander';
import { readFileSync, realpathSync } from 'fs';
import * as os from 'os';
import { fileURLToPath } from 'url';
import type { DeviceContext } from './adapters/types.js';
import { discoverConfigurations } from './commands/discover.js';
import {
  captureConfigurations,
  type CaptureDependencies,
} from './commands/capture.js';
import { initRepository } from './commands/init.js';
import {
  deployConfigurations,
  type DeployDependencies,
} from './commands/deploy.js';
import { showStatus } from './commands/status.js';
import { restoreLatestBackup } from './commands/restore.js';
import { bind, migrate, showRepository, unbind } from './commands/binding.js';
import {
  createProfile,
  deleteProfile,
  editProfile,
  listProfiles,
  showProfile,
} from './commands/profile.js';
import {
  openProfileEditor,
  shouldOpenProfileEditor,
} from './commands/profile-editor.js';
import { startMcpServer } from './commands/mcp.js';
import { presentDiagnostic } from './presentation/output.js';
// package.json is the single version source for both npm and the CLI.
const packageVersion = (
  JSON.parse(
    readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
  ) as { version: string }
).version;

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
    .action((options) => {
      validateWriteOutputOptions(initCommand, options);
      initRepository(context, process.cwd(), options);
    });

  const captureCommand = program
    .command('capture')
    .description('Capture local AI IDE configuration into the MCV repository')
    .option('--dry-run', 'Show the capture plan without writing')
    .option('--json', 'Print a machine-readable plan')
    .option('--yes', 'Apply default non-conflicting changes without prompting')
    .option('--verbose', 'Also print complete review details in the terminal')
    .option('--tui', 'Force the dedicated Capture review TUI')
    .option('--no-tui', 'Force line-oriented Capture review')
    .action(async (options) => {
      validateWriteOutputOptions(captureCommand, options);
      validateCaptureTuiOptions(captureCommand, options);
      await captureConfigurations(context, captureDependencies, options);
    });

  const deployCommand = program
    .command('deploy')
    .description('Deploy selected Profiles to the current project or device-global locations')
    .argument('[profiles...]', 'Profile IDs to deploy (unioned and deduplicated)')
    .option('--global', 'Deploy to device-global IDE locations (defaults Profiles to global)')
    .option('--target <path>', 'Project root for project-scope Deploy (default: process.cwd())')
    .option('--dry-run', 'Show the deployment plan without writing')
    .option('--json', 'Print a machine-readable plan')
    .option('--yes', 'Deploy without prompting after a reviewed dry-run')
    .option('--verbose', 'Also print complete review details in the terminal')
    .option('--prune-managed', 'Delete stale MCV-owned files (project Managed Receipt or global inventory) and exact duplicate Skills from the legacy Codex directory')
    .action(async (profiles: string[], options) => {
      validateWriteOutputOptions(deployCommand, options);
      await deployConfigurations(context, deployDependencies, {
        ...options,
        profiles,
      });
    });

  const discoverCommand = program
    .command('discover')
    .description('Detect supported AI IDEs and report their configuration paths')
    .addOption(new Option('--plain', 'Print a one-shot English text report'))
    .addOption(new Option('--json', 'Print one machine-readable report'))
    .option('--verbose', 'Also print complete report details in the terminal')
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
    .option('--verbose', 'Also print complete report details in the terminal')
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
    .option('--global', 'Restore from the latest global Deploy backup')
    .option('--target <path>', 'Project root whose latest Deploy backup to restore (default: process.cwd())')
    .option('--dry-run', 'Show the Restore Plan without writing')
    .option('--yes', 'Restore without prompting after reviewing a dry-run')
    .option('--json', 'Print one machine-readable Restore Plan or Result')
    .option('--verbose', 'Also print complete review details in the terminal')
    .action(async (options) => {
      validateWriteOutputOptions(restoreCommand, options);
      if (options.global && options.target) {
        restoreCommand.error(
          "options '--target' and '--global' cannot be used together",
          { exitCode: 2, code: 'mcv.conflictingRestoreScope' },
        );
      }
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

  const bindCommand = program.command('bind [path]')
    .description('Bind this device to an existing MCV Repository')
    .option('--dry-run', 'Preview the Repository binding without writing')
    .option('--yes', 'Bind without prompting after reviewing a dry-run')
    .addOption(new Option('--json', 'Print one machine-readable Plan or Result'))
    .action((repositoryPath, options) => {
      validateWriteOutputOptions(bindCommand, options);
      bind(context, repositoryPath, options);
    });
  const unbindCommand = program.command('unbind')
    .description('Remove the Repository binding from this device')
    .option('--dry-run', 'Preview removal of the local Repository binding')
    .option('--yes', 'Remove the local binding without prompting after reviewing a dry-run')
    .addOption(new Option('--json', 'Print one machine-readable Plan or Result'))
    .action((options) => {
      validateWriteOutputOptions(unbindCommand, options);
      unbind(context, options);
    });
  const migrateCommand = program.command('migrate [path]').description('Migrate an older repository to the current schema')
    .option('--dry-run', 'Preview migration without writing')
    .option('--yes', 'Migrate without prompting after reviewing a dry-run')
    .option('--json', 'Print one machine-readable Plan or Result')
    .option('--verbose', 'Also print complete review details in the terminal')
    .action((repositoryPath = process.cwd(), options) => {
      validateWriteOutputOptions(migrateCommand, options);
      migrate(context, repositoryPath, options);
    });

  const profileCommand = program
    .command('profile')
    .description('Manage Profiles in the bound MCV Repository')
    .action(async () => {
      if (shouldOpenProfileEditor()) {
        await openProfileEditor(context);
        return;
      }
      profileCommand.help();
    });

  profileCommand
    .command('list')
    .description('List Profiles with asset counts and Unassigned')
    .option('--json', 'Print one machine-readable Profile list report')
    .option('--verbose', 'Also print complete report details in the terminal')
    .action((options) => {
      listProfiles(context, options);
    });

  profileCommand
    .command('show')
    .description('Show one Profile and its Assets')
    .argument('<id>', 'Profile ID')
    .option('--json', 'Print one machine-readable Profile report')
    .option('--verbose', 'Also print complete report details in the terminal')
    .action((id, options) => {
      showProfile(context, id, options);
    });

  profileCommand
    .command('create')
    .description('Create a Profile')
    .argument('<id>', 'Profile ID')
    .option('--title <title>', 'Human-readable title')
    .option('--description <description>', 'Human- and agent-facing description')
    .option('--add <assetIds...>', 'Asset IDs to include')
    .option('--expected-revision <sha256>', 'Fail unless Profiles Revision matches')
    .option('--json', 'Print one machine-readable Result')
    .action((id, options) => {
      createProfile(context, id, {
        title: options.title,
        description: options.description,
        add: options.add,
        expectedRevision: options.expectedRevision,
        json: options.json,
      });
    });

  const profileEditCommand = profileCommand
    .command('edit')
    .description('Update a Profile title, description, or Assets')
    .argument('<id>', 'Profile ID')
    .option('--title <title>', 'Human-readable title')
    .option('--description <description>', 'Human- and agent-facing description')
    .option('--add <assetIds...>', 'Asset IDs to add')
    .option('--remove <assetIds...>', 'Asset IDs to remove')
    .option('--expected-revision <sha256>', 'Fail unless Profiles Revision matches')
    .option('--json', 'Print one machine-readable Result')
    .action(async (id, options) => {
      if (shouldOpenProfileEditor({
        title: options.title,
        description: options.description,
        add: options.add,
        remove: options.remove,
        expectedRevision: options.expectedRevision,
        json: options.json,
      })) {
        await openProfileEditor(context, { initialProfileId: id });
        return;
      }
      if (
        options.title === undefined
        && options.description === undefined
        && !options.add?.length
        && !options.remove?.length
      ) {
        profileEditCommand.error(
          'profile edit requires a TTY, or at least one of --title, --description, --add, or --remove',
          { exitCode: 2, code: 'mcv.missingProfileEdit' },
        );
      }
      editProfile(context, id, {
        title: options.title,
        description: options.description,
        add: options.add,
        remove: options.remove,
        expectedRevision: options.expectedRevision,
        json: options.json,
      });
    });

  profileCommand
    .command('delete')
    .description('Delete a Profile set definition without deleting Assets')
    .argument('<id>', 'Profile ID')
    .option('--expected-revision <sha256>', 'Fail unless Profiles Revision matches')
    .option('--json', 'Print one machine-readable Result')
    .action((id, options) => {
      deleteProfile(context, id, {
        expectedRevision: options.expectedRevision,
        json: options.json,
      });
    });

  program
    .command('mcp', { hidden: true })
    .description('Start the local stdio MCP server for Profile and Asset inspection and mutation')
    .action(async () => {
      await startMcpServer(context);
    });

  program.action(async () => {
    await showStatus(context);
  });

  return program;
}

function validateCaptureTuiOptions(
  command: Command,
  options: { dryRun?: boolean; yes?: boolean; json?: boolean; verbose?: boolean; tui?: boolean },
): void {
  const rawArgs = (command.parent as (Command & { rawArgs?: string[] }) | null)?.rawArgs ?? [];
  const forceTui = rawArgs.includes('--tui');
  const forcePlain = rawArgs.includes('--no-tui');
  if (forceTui && forcePlain) {
    command.error("options '--tui' and '--no-tui' cannot be used together", {
      exitCode: 2,
      code: 'mcv.conflictingCaptureReviewModes',
    });
  }
  if ((forceTui || forcePlain) && (options.dryRun || options.yes || options.json)) {
    command.error("options '--tui' and '--no-tui' are only available for interactive Capture", {
      exitCode: 2,
      code: 'mcv.conflictingCaptureReviewMode',
    });
  }
  if (forceTui && options.verbose) {
    command.error("options '--tui' and '--verbose' cannot be used together", {
      exitCode: 2,
      code: 'mcv.conflictingCaptureReviewMode',
    });
  }
  if (forceTui && (
    !process.stdin.isTTY
    || !process.stdout.isTTY
    || process.env.TERM?.toLowerCase() === 'dumb'
  )) {
    command.error('option --tui requires an interactive terminal with TERM other than dumb', {
      exitCode: 2,
      code: 'mcv.captureTuiUnavailable',
    });
  }
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

export async function runCli(argv: string[] = process.argv): Promise<void> {
  const program = createProgram();
  program.exitOverride();
  applyExitOverride(program);
  try {
    await program.parseAsync(argv);
  } catch (error) {
    if (error instanceof CommanderError) {
      process.exitCode = normalizeCommanderExitCode(error);
      return;
    }
    process.exitCode = 1;
    presentDiagnostic(`MCV failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function applyExitOverride(command: Command): void {
  for (const child of command.commands) {
    child.exitOverride();
    applyExitOverride(child);
  }
}

function normalizeCommanderExitCode(error: CommanderError): number {
  if (error.exitCode === 0) return 0;
  if (error.exitCode === 2 || error.code.startsWith('mcv.')) return 2;
  return error.code.startsWith('commander.') ? 2 : 1;
}

if (isMainModule()) {
  void runCli();
}

function isMainModule(): boolean {
  const entryPoint = process.argv[1];
  if (!entryPoint) return false;

  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(entryPoint);
  } catch {
    return false;
  }
}
