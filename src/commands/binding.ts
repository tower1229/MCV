import type { DeviceContext } from '../adapters/types';
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
} from '../operations/repository';
import {
  renderBindPlain,
  renderMigrationPlain,
  renderRepositoryPlain,
  renderUnbindPlain,
} from '../renderers/repository';
import { renderJson } from '../renderers/json';

export interface RepositoryOutputOptions {
  dryRun?: boolean;
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
): BindPlan | BindResult {
  const plan = createBindPlan(context, repositoryPath);
  const contract = options.dryRun || !options.yes
    ? plan
    : applyBindPlan(context, plan);
  render(contract, options, renderBindPlain);
  if (contract.status === 'failed') process.exitCode = 1;
  return contract;
}

export function unbind(
  context: DeviceContext,
  options: RepositoryOutputOptions = {},
): UnbindPlan | UnbindResult {
  const plan = createUnbindPlan(context);
  const contract = options.dryRun || !options.yes
    ? plan
    : applyUnbindPlan(context, plan);
  render(contract, options, renderUnbindPlain);
  if (contract.status === 'failed') process.exitCode = 1;
  return contract;
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

function render<T extends RepositoryReport | BindPlan | BindResult | UnbindPlan | UnbindResult>(
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
