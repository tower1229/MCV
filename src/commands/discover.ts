import type { DeviceContext } from '../adapters/types.js';
import {
  inspectEnvironment,
  type EnvironmentReport,
} from '../operations/environment.js';
import { renderEnvironmentPlain } from '../renderers/environment.js';
import { renderJson } from '../renderers/json.js';

export interface DiscoverOptions {
  json?: boolean;
  plain?: boolean;
}

export async function discoverConfigurations(
  context: DeviceContext,
  options: DiscoverOptions = {},
): Promise<EnvironmentReport> {
  const report = await inspectEnvironment(context);
  if (options.json) {
    console.log(renderJson(report));
  } else {
    for (const line of renderEnvironmentPlain(report)) console.log(line);
  }
  return report;
}
