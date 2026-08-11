import type { DeviceContext } from '../adapters/types.js';
import {
  applyInitPlan,
  createInitPlan,
  type InitPlan,
  type InitResult,
} from '../operations/repository.js';
import { presentJson } from '../renderers/json.js';
import { renderInitDocument } from '../renderers/repository.js';
import { presentDocument } from '../presentation/output.js';

export interface InitOptions {
  dryRun?: boolean;
  yes?: boolean;
  json?: boolean;
}

export function initRepository(
  context: DeviceContext,
  targetDir: string = process.cwd(),
  options: InitOptions = {},
): InitPlan | InitResult {
  const plan = createInitPlan(context, targetDir);
  if (options.dryRun || !options.yes) {
    render(context, plan, options);
    return plan;
  }

  const result = plan.issues.some((issue) => issue.severity !== 'notice')
    ? blockedInitResult(plan)
    : applyInitPlan(context, plan);
  render(context, result, options);
  if (result.status === 'failed') process.exitCode = 1;
  if (result.status === 'blocked') process.exitCode = 3;
  return result;
}

function blockedInitResult(plan: InitPlan): InitResult {
  return {
    schemaVersion: plan.schemaVersion,
    operation: 'init',
    status: 'blocked',
    repositoryPath: plan.repositoryPath,
    changes: [],
    issues: plan.issues,
    nextActions: ['Review the Init Plan interactively before applying it.'],
  };
}

function render(context: DeviceContext, contract: InitPlan | InitResult, options: InitOptions): void {
  if (options.json) {
    presentJson(contract);
    return;
  }
  presentDocument(context, renderInitDocument(contract));
}
