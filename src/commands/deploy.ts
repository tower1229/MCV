import type { DeviceContext } from '../adapters/types.js';
import { GLOBAL_PROFILE_ID } from '../profiles/contracts.js';
import {
  buildDeployRequest,
  createDeployPlan,
  applyDeployPlan,
  type DeployApplyOptions,
  type DeploySelection,
} from '../operations/deploy.js';
import { validateProjectTargetRoot } from '../core/project-target.js';
import { renderDeployPlanPlain, renderDeployResultPlain } from '../renderers/deploy.js';
import { renderJson } from '../renderers/json.js';
import { createAdapterDefinitions } from '../adapters/index.js';
import { askInTerminal, withInterruptsIgnored } from '../cli/prompt.js';
import { readManifest, resolveBoundRepository } from '../utils/repository.js';

export interface DeployDependencies {
  confirmDeploy?: () => Promise<boolean | undefined>;
}

export interface DeployOptions {
  dryRun?: boolean;
  json?: boolean;
  yes?: boolean;
  pruneManaged?: boolean;
  global?: boolean;
  target?: string;
  profiles?: string[];
}

export async function deployConfigurations(
  context: DeviceContext,
  dependencies: DeployDependencies = {},
  options: DeployOptions = {},
): Promise<void> {
  const profileArgs = options.profiles ?? [];
  const wantsGlobal = options.global === true;
  const hasTarget = typeof options.target === 'string' && options.target.length > 0;

  if (wantsGlobal && hasTarget) {
    console.error('options --target and --global cannot be used together');
    process.exitCode = 2;
    return;
  }

  if (profileArgs.length === 0 && !wantsGlobal) {
    console.error(
      'Specify one or more Profile IDs, or use --global to deploy the built-in global Profile to device-global locations.\n'
      + 'Examples: mcv deploy dev\n'
      + '          mcv deploy --global\n'
      + '          mcv deploy global --global',
    );
    process.exitCode = 2;
    return;
  }

  const repositoryPath = resolveBoundRepository(context);
  const profileIds = profileArgs.length > 0 ? profileArgs : [GLOBAL_PROFILE_ID];
  const scope = wantsGlobal ? 'global' : 'project';
  let targetRoot: string;
  if (wantsGlobal) {
    targetRoot = context.homeDir;
  } else {
    const rawTarget = typeof options.target === 'string' ? options.target : process.cwd();
    const validated = validateProjectTargetRoot(rawTarget, context, {
      boundRepositoryPath: repositoryPath,
    });
    if (!validated.ok) {
      if (options.json) {
        console.log(renderJson({
          schemaVersion: 3,
          operation: 'deploy',
          status: 'failed',
          repositoryPath,
          changes: [],
          issues: [{
            severity: 'error',
            code: validated.error.code,
            message: validated.error.message,
          }],
          nextActions: validated.error.nextActions,
          error: validated.error,
        }));
      } else {
        console.error(validated.error.message);
      }
      process.exitCode = 2;
      return;
    }
    targetRoot = validated.targetRoot;
  }

  const built = buildDeployRequest(repositoryPath, { profileIds, scope, targetRoot });
  if ('error' in built) {
    if (options.json) {
      console.log(renderJson({
        schemaVersion: 3,
        operation: 'deploy',
        status: 'failed',
        repositoryPath,
        changes: [],
        issues: [{
          severity: 'error',
          code: built.error.code,
          message: built.error.message,
        }],
        nextActions: built.error.nextActions,
        error: built.error,
      }));
    } else {
      console.error(built.error.message);
    }
    process.exitCode = built.error.code === 'deploy.profileNotFound' ? 2 : 1;
    return;
  }

  const reviewPlan = await createDeployPlan(context, built.request);
  if (options.dryRun) {
    if (options.json) console.log(renderJson(reviewPlan));
    else for (const line of renderDeployPlanPlain(reviewPlan)) console.log(line);
    if (reviewPlan.status === 'failed') process.exitCode = 1;
    return;
  }
  if (reviewPlan.status !== 'failed' && reviewPlan.changes.length === 0) {
    if (options.json) {
      const result = await withInterruptsIgnored(() =>
        applyDeployPlan(
          context,
          reviewPlan,
          { changeIds: [] },
          { nonInteractive: options.yes },
        ));
      console.log(renderJson(result));
      if (result.status !== 'succeeded') process.exitCode = result.status === 'blocked' ? 3 : 1;
    } else {
      const manifest = reviewPlan.repositoryPath ? readManifest(reviewPlan.repositoryPath) : undefined;
      const enabled = createAdapterDefinitions().filter(
        ({ targetId }) => manifest?.targets?.[targetId]?.enabled === true,
      );
      const subject = enabled.length === 1 ? `${enabled[0].name} configuration is` : 'Configurations are';
      console.log(`${subject} already in sync.`);
      for (const issue of reviewPlan.issues.filter((item) => item.severity === 'notice')) {
        console.log(issue.message);
      }
    }
    return;
  }
  if (!options.json && !options.yes) {
    for (const line of renderDeployPlanPlain(reviewPlan)) console.log(line);
  }
  if (!options.yes) {
    if (!process.stdin.isTTY && !dependencies.confirmDeploy) {
      throw new Error('Deploy requires an interactive terminal; use --yes only after reviewing --dry-run.');
    }
    const confirmed = await (dependencies.confirmDeploy ?? confirmInTerminal)();
    if (confirmed === undefined) {
      process.exitCode = 130;
      console.log('Deploy interrupted; local configuration was not changed.');
      return;
    }
    if (!confirmed) {
      console.log('Deploy cancelled; local configuration was not changed.');
      return;
    }
  }
  const selectedIds = reviewPlan.status === 'failed'
    ? []
    : reviewPlan.changes
      .filter((change) => change.defaultSelected
        || (options.pruneManaged === true && change.change === 'delete'))
      .map((change) => change.id);
  const selection: DeploySelection = {
    changeIds: selectedIds,
    confirmedIssueIds: options.yes
      ? []
      : reviewPlan.issues
        .filter((issue) => issue.severity === 'warning')
        .map((issue) => issue.confirmationId),
  };
  const applyOptions: DeployApplyOptions = { nonInteractive: options.yes };
  const result = await withInterruptsIgnored(() =>
    applyDeployPlan(context, reviewPlan, selection, applyOptions));
  if (result.status !== 'succeeded') process.exitCode = result.status === 'blocked' ? 3 : 1;
  if (options.json) console.log(renderJson(result));
  else for (const line of renderDeployResultPlain(result)) console.log(line);
}

async function confirmInTerminal(): Promise<boolean | undefined> {
  const outcome = await askInTerminal('Write these changes to this device? [y/N] ');
  return outcome.interrupted ? undefined : /^(y|yes)$/i.test(outcome.answer.trim());
}
