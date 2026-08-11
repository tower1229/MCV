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
import { renderDeployPlanDocument, renderDeployResultDocument } from '../renderers/deploy.js';
import { presentJson } from '../renderers/json.js';
import { createAdapterDefinitions } from '../adapters/index.js';
import { askInTerminal, withInterruptsIgnored } from '../cli/prompt.js';
import { readManifest, resolveBoundRepository } from '../utils/repository.js';
import {
  presentBlocks,
  presentDiagnostic,
  presentDocument,
  presentOutcome,
} from '../presentation/output.js';
import { issueBlocks } from '../presentation/builders.js';

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
  verbose?: boolean;
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
    presentDiagnostic('options --target and --global cannot be used together');
    process.exitCode = 2;
    return;
  }

  if (profileArgs.length === 0 && !wantsGlobal) {
    presentDiagnostic(
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
        presentJson({
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
        });
      } else {
        presentDiagnostic(validated.error.message);
      }
      process.exitCode = 2;
      return;
    }
    targetRoot = validated.targetRoot;
  }

  const built = buildDeployRequest(repositoryPath, { profileIds, scope, targetRoot });
  if ('error' in built) {
    if (options.json) {
      presentJson({
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
      });
    } else {
      presentDiagnostic(built.error.message);
    }
    process.exitCode = built.error.code === 'deploy.profileNotFound' ? 2 : 1;
    return;
  }
  if (options.pruneManaged === true) {
    built.request.pruneManaged = true;
  }

  const reviewPlan = await createDeployPlan(context, built.request);
  if (options.dryRun) {
    if (options.json) presentJson(reviewPlan);
    else presentDocument(context, renderDeployPlanDocument(reviewPlan), {
      verbose: options.verbose,
    });
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
      presentJson(result);
      if (result.status !== 'succeeded') process.exitCode = result.status === 'blocked' ? 3 : 1;
    } else {
      const manifest = reviewPlan.repositoryPath ? readManifest(reviewPlan.repositoryPath) : undefined;
      const enabled = createAdapterDefinitions().filter(
        ({ targetId }) => manifest?.targets?.[targetId]?.enabled === true,
      );
      const subject = enabled.length === 1 ? `${enabled[0].name} configuration is` : 'Configurations are';
      presentOutcome('Deploy Result', `${subject} already in sync.`, 'success');
      presentBlocks(issueBlocks(reviewPlan.issues.filter((item) => item.severity === 'notice')));
    }
    return;
  }
  if (!options.json && !options.yes) {
    presentDocument(context, renderDeployPlanDocument(reviewPlan), {
      verbose: options.verbose,
    });
  }
  const selectedIds = reviewPlan.status === 'failed'
    ? []
    : reviewPlan.changes
      .filter((change) => change.defaultSelected
        || (options.pruneManaged === true
          && (change.change === 'delete' || change.deploymentKind === 'project-managed-prune')))
      .map((change) => change.id);
  if (!options.yes) {
    if (!process.stdin.isTTY && !dependencies.confirmDeploy) {
      throw new Error('Deploy requires an interactive terminal; use --yes only after reviewing --dry-run.');
    }
    const confirmed = await (dependencies.confirmDeploy
      ?? (() => confirmInTerminal(selectedIds.length)))();
    if (confirmed === undefined) {
      process.exitCode = 130;
      presentOutcome('Deploy Result', 'Deploy interrupted; local configuration was not changed.', 'attention');
      return;
    }
    if (!confirmed) {
      presentOutcome('Deploy Result', 'Deploy cancelled; local configuration was not changed.', 'attention');
      return;
    }
  }
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
  if (options.json) presentJson(result);
  else presentDocument(context, renderDeployResultDocument(result), {
    verbose: options.verbose,
  });
}

async function confirmInTerminal(selectedCount: number): Promise<boolean | undefined> {
  const noun = selectedCount === 1 ? 'change' : 'changes';
  const outcome = await askInTerminal(
    `Deploy · ${selectedCount} selected ${noun} · target: this device · Apply? [y/N] `,
  );
  return outcome.interrupted ? undefined : /^(y|yes)$/i.test(outcome.answer.trim());
}
