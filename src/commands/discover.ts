import type { DeviceContext } from '../adapters/types.js';
import {
  inspectEnvironment,
  type EnvironmentReport,
} from '../operations/environment.js';
import { renderEnvironmentDocument } from '../renderers/environment.js';
import { presentJson } from '../renderers/json.js';
import { presentDocument } from '../presentation/output.js';

export interface DiscoverOptions {
  json?: boolean;
  plain?: boolean;
  verbose?: boolean;
}

export async function discoverConfigurations(
  context: DeviceContext,
  options: DiscoverOptions = {},
): Promise<EnvironmentReport> {
  const report = await inspectEnvironment(context);
  if (options.json) {
    presentJson(report);
  } else {
    presentDocument(context, renderEnvironmentDocument(report), { verbose: options.verbose });
  }
  return report;
}
