import { migrateRepository } from '../utils/repository';
import type { DeviceContext } from '../adapters/types';
import {
  bindRepository,
  inspectRepository,
  unbindRepository,
  type BindResult,
  type RepositoryReport,
  type UnbindResult,
} from '../operations/repository';
import {
  renderBindPlain,
  renderRepositoryPlain,
  renderUnbindPlain,
} from '../renderers/repository';
import { renderJson } from '../renderers/json';

export interface RepositoryOutputOptions {
  json?: boolean;
  plain?: boolean;
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
  const result = bindRepository(context, repositoryPath);
  render(result, options, renderBindPlain);
  if (result.status === 'failed') process.exitCode = 1;
  return result;
}

export function unbind(
  context: DeviceContext,
  options: RepositoryOutputOptions = {},
): UnbindResult {
  const result = unbindRepository(context);
  render(result, options, renderUnbindPlain);
  return result;
}

export function migrate(context: DeviceContext, repositoryPath: string, dryRun: boolean): void {
  const manifest = migrateRepository(context, repositoryPath, dryRun);
  console.log(`${dryRun ? 'Migration preview' : 'Migrated repository'}: schema v${manifest.schemaVersion}`);
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
