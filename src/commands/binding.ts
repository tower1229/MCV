import type { DeviceContext } from '../adapters/types.js';
import {
  applyMigrationPlan,
  applyBindPlan,
  applyUnbindPlan,
  createBindPlan,
  createMigrationPlan,
  createUnbindPlan,
  inspectRepository,
  type BindPlan,
  type BindResult,
  type MigrationPlan,
  type MigrationResult,
  type RepositoryReport,
  type UnbindPlan,
  type UnbindResult,
} from '../operations/repository.js';
import {
  renderBindDocument,
  renderMigrationDocument,
  renderRepositoryDocument,
  renderUnbindDocument,
} from '../renderers/repository.js';
import { presentJson } from '../renderers/json.js';
import { presentDocument } from '../presentation/output.js';
import { askInTerminal } from '../cli/prompt.js';

export interface RepositoryOutputOptions {
  dryRun?: boolean;
  json?: boolean;
  yes?: boolean;
  verbose?: boolean;
}

export function showRepository(
  context: DeviceContext,
  options: RepositoryOutputOptions = {},
): RepositoryReport {
  const report = inspectRepository(context);
  render(context, report, options, renderRepositoryDocument);
  return report;
}

export function bind(
  context: DeviceContext,
  repositoryPath?: string,
  options: RepositoryOutputOptions = {},
): BindPlan | BindResult {
  const plan = createBindPlan(context, repositoryPath);
  const contract = options.dryRun || !options.yes
    ? plan
    : applyBindPlan(context, plan);
  render(context, contract, options, renderBindDocument);
  if (contract.status === 'failed') process.exitCode = 1;
  return contract;
}

export async function bindInteractively(
  context: DeviceContext,
  repositoryPath: string,
): Promise<BindPlan | BindResult> {
  const plan = createBindPlan(context, repositoryPath);
  render(context, plan, {}, renderBindDocument);
  if (plan.status === 'failed') {
    process.exitCode = 1;
    return plan;
  }
  const confirmed = await confirmLifecycle('Bind', plan.changes.length, plan.repositoryPath);
  if (confirmed === undefined) process.exitCode = 130;
  if (!confirmed) return plan;
  const result = applyBindPlan(context, plan);
  render(context, result, {}, renderBindDocument);
  if (result.status === 'failed') process.exitCode = 1;
  return result;
}

export function unbind(
  context: DeviceContext,
  options: RepositoryOutputOptions = {},
): UnbindPlan | UnbindResult {
  const plan = createUnbindPlan(context);
  const contract = options.dryRun || !options.yes
    ? plan
    : applyUnbindPlan(context, plan);
  render(context, contract, options, renderUnbindDocument);
  if (contract.status === 'failed') process.exitCode = 1;
  return contract;
}

export async function unbindInteractively(
  context: DeviceContext,
): Promise<UnbindPlan | UnbindResult> {
  const plan = createUnbindPlan(context);
  render(context, plan, {}, renderUnbindDocument);
  if (plan.status === 'failed') {
    process.exitCode = 1;
    return plan;
  }
  const confirmed = await confirmLifecycle('Unbind', plan.changes.length, plan.repositoryPath);
  if (confirmed === undefined) process.exitCode = 130;
  if (!confirmed) return plan;
  const result = applyUnbindPlan(context, plan);
  render(context, result, {}, renderUnbindDocument);
  if (result.status === 'failed') process.exitCode = 1;
  return result;
}

export function migrate(
  context: DeviceContext,
  repositoryPath: string,
  options: RepositoryOutputOptions & { dryRun?: boolean } = {},
): MigrationPlan | MigrationResult {
  const plan = createMigrationPlan(context, repositoryPath);
  const contract = options.dryRun || !options.yes
    ? plan
    : applyMigrationPlan(context, plan);
  if (options.json) presentJson(contract);
  else presentDocument(context, renderMigrationDocument(contract), {
    verbose: options.verbose,
  });
  if (contract.status === 'failed') process.exitCode = 1;
  return contract;
}

export async function migrateInteractively(
  context: DeviceContext,
  repositoryPath: string,
): Promise<MigrationPlan | MigrationResult> {
  const plan = createMigrationPlan(context, repositoryPath);
  presentDocument(context, renderMigrationDocument(plan));
  if (plan.status === 'failed') {
    process.exitCode = 1;
    return plan;
  }
  const confirmed = await confirmLifecycle('Migrate', plan.changes.length, plan.repositoryPath);
  if (confirmed === undefined) process.exitCode = 130;
  if (!confirmed) return plan;
  const result = applyMigrationPlan(context, plan);
  presentDocument(context, renderMigrationDocument(result));
  if (result.status === 'failed') process.exitCode = 1;
  return result;
}

function render<T extends RepositoryReport | BindPlan | BindResult | UnbindPlan | UnbindResult>(
  context: DeviceContext,
  contract: T,
  options: RepositoryOutputOptions,
  renderDocument: (value: T) => ReturnType<typeof renderRepositoryDocument>,
): void {
  if (options.json) {
    presentJson(contract);
    return;
  }
  presentDocument(context, renderDocument(contract), { verbose: options.verbose });
}

async function confirmLifecycle(
  operation: string,
  changeCount: number,
  repositoryPath: string | null,
): Promise<boolean | undefined> {
  const outcome = await askInTerminal(
    `${operation} · ${changeCount} changes · Repository: ${repositoryPath ?? 'not bound'} · Apply? [y/N] `,
  );
  return outcome.interrupted ? undefined : /^(y|yes)$/i.test(outcome.answer.trim());
}
