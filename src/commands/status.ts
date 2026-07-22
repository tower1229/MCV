import type { DeviceContext } from '../adapters/types';
import {
  inspectStatus,
  type StatusReport,
} from '../operations/status';
import { renderJson } from '../renderers/json';
import { renderStatusPlain } from '../renderers/status';

export interface StatusOptions {
  json?: boolean;
  plain?: boolean;
}

export async function showStatus(
  context: DeviceContext,
  options: StatusOptions = {},
): Promise<StatusReport> {
  const report = await inspectStatus(context);
  if (options.json) console.log(renderJson(report));
  else for (const line of renderStatusPlain(report)) console.log(line);
  return report;
}
