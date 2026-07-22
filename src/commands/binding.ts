import type { DeviceContext } from '../adapters/types';
import {
  applyMigrationPlan,
  applyBindPlan,
  applyUnbindPlan,
  createBindPlan,
  createMigrationPlan,
  createUnbindPlan,
  inspectRepository,
  type BindResult,
  type MigrationPlan,
  type MigrationResult,
  type RepositoryReport,
  type UnbindResult,
} from '../operations/repository';
import {
  renderBindPlain,
  renderMigrationPlain,
  renderRepositoryPlain,
  renderUnbindPlain,
} from '../renderers/repository';
import { renderJson } from '../renderers/json';

export interface RepositoryOutputOptions {
  json?: boolean;
  yes?: boolean;
}

export function showRepository(
  context: DeviceContext,
  options: RepositoryOutputOptions = {},
): RepositoryReport {
  const report = inspectRepository(context);
  render(report, options, renderRepositoryPlain);
  return report;
}

export function bind(
  context: DeviceContext,
  repositoryPath?: string,
  options: RepositoryOutputOptions = {},
): BindResult {
  const result = applyBindPlan(context, createBindPlan(context, repositoryPath));
  render(result, options, renderBindPlain);
  if (result.status === 'failed') process.exitCode = 1;
  return result;
}

export function unbind(
  context: DeviceContext,
  options: RepositoryOutputOptions = {},
): UnbindResult {
  const result = applyUnbindPlan(context, createUnbindPlan(context));
  render(result, options, renderUnbindPlain);
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
  if (options.json) console.log(renderJson(contract));
  else for (const line of renderMigrationPlain(contract)) console.log(line);
  if (contract.status === 'failed') process.exitCode = 1;
  return contract;
}

function render<T extends RepositoryReport | BindResult | UnbindResult>(
  contract: T,
  options: RepositoryOutputOptions,
  renderPlain: (value: T) => string[],
): void {
  if (options.json) {
    console.log(renderJson(contract));
    return;
  }
  for (const line of renderPlain(contract)) console.log(line);
}
