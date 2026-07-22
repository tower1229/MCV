import type { DeviceContext } from '../adapters/types';
import {
  inspectEnvironment,
  type EnvironmentReport,
} from '../operations/environment';
import { renderEnvironmentPlain } from '../renderers/environment';
import { renderJson } from '../renderers/json';

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
