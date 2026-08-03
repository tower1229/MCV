import type { DeviceContext } from '../adapters/types.js';
import {
  inspectStatus,
  type StatusReport,
} from '../operations/status.js';
import { renderJson } from '../renderers/json.js';
import { renderStatusPlain } from '../renderers/status.js';

export interface StatusOptions {
  json?: boolean;
  plain?: boolean;
}

export async function showStatus(
  context: DeviceContext,
  options: StatusOptions = {},
): Promise<StatusReport> {
  const report = await inspectStatus(context);
  if (options.json) console.log(renderJson({ ...report, changes: [] }));
  else for (const line of renderStatusPlain(report)) console.log(line);
  return report;
}
