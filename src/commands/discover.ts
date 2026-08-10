import type { DeviceContext } from '../adapters/types.js';
import {
  inspectEnvironment,
  type EnvironmentReport,
} from '../operations/environment.js';
import { renderEnvironmentDocument } from '../renderers/environment.js';
import { renderJson } from '../renderers/json.js';
import { presentHumanDocument } from '../cli/human-output.js';

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
    console.log(renderJson(report));
  } else {
    presentHumanDocument(context, renderEnvironmentDocument(report), { verbose: options.verbose });
  }
  return report;
}
