import { createInterface } from 'readline/promises';
import { createAdapterDefinitions } from '../adapters';
import type { DeviceContext } from '../adapters/types';
import { readManifest } from '../utils/repository';
import { applyDeployPlan, createDeployPlan } from '../operations/deploy';
import { renderDeployPlanPlain, renderDeployResultPlain } from '../renderers/deploy';
import { renderJson } from '../renderers/json';

export interface DeployDependencies {
  confirmDeploy?: () => Promise<boolean>;
}

export interface DeployOptions { dryRun?: boolean; json?: boolean; yes?: boolean; pruneManaged?: boolean; }

export async function deployConfigurations(
  context: DeviceContext,
  dependencies: DeployDependencies = {},
  options: DeployOptions = {},
): Promise<void> {
  const reviewPlan = await createDeployPlan(context);
  if (options.dryRun) {
    if (options.json) console.log(renderJson(reviewPlan));
    else for (const line of renderDeployPlanPlain(reviewPlan)) console.log(line);
    if (reviewPlan.status === 'failed') process.exitCode = 1;
    return;
  }
  if (reviewPlan.status !== 'failed' && reviewPlan.changes.length === 0) {
    if (options.json) {
      const result = await applyDeployPlan(context, reviewPlan, { changeIds: [] }, { nonInteractive: options.yes });
      console.log(renderJson(result));
      if (result.status !== 'succeeded') process.exitCode = result.status === 'blocked' ? 3 : 1;
    } else {
      const manifest = reviewPlan.repositoryPath ? readManifest(reviewPlan.repositoryPath) : undefined;
      const enabled = createAdapterDefinitions().filter(
        ({ targetId }) => manifest?.targets?.[targetId]?.enabled === true,
      );
      const subject = enabled.length === 1 ? `${enabled[0].name} configuration is` : 'Configurations are';
      console.log(`${subject} already in sync.`);
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
  const result = await applyDeployPlan(context, reviewPlan, {
    changeIds: selectedIds,
    confirmedIssueCodes: options.yes
      ? []
      : reviewPlan.issues
        .filter((issue) => issue.severity === 'warning')
        .map((issue) => issue.code),
  }, { nonInteractive: options.yes });
  if (result.status !== 'succeeded') process.exitCode = result.status === 'blocked' ? 3 : 1;
  if (options.json) console.log(renderJson(result));
  else for (const line of renderDeployResultPlain(result)) console.log(line);
}

async function confirmInTerminal(): Promise<boolean> {
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await prompt.question('Write these changes to this device? [y/N] ');
    return /^(y|yes)$/i.test(answer.trim());
  } finally {
    prompt.close();
  }
}
