import type { DeviceContext } from '../adapters/types.js';
import {
  inspectStatus,
  type StatusReport,
} from '../operations/status.js';
import { renderJson } from '../renderers/json.js';
import { renderStatusDocument } from '../renderers/status.js';
import { presentHumanDocument } from '../cli/human-output.js';

export interface StatusOptions {
  json?: boolean;
  plain?: boolean;
  verbose?: boolean;
}

export async function showStatus(
  context: DeviceContext,
  options: StatusOptions = {},
): Promise<StatusReport> {
  const report = await inspectStatus(context);
  if (options.json) console.log(renderJson(report));
  else presentHumanDocument(context, renderStatusDocument(report), { verbose: options.verbose });
  return report;
}
