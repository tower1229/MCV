import { inspectStatus, } from '../operations/status.js';
import { renderJson } from '../renderers/json.js';
import { renderStatusDocument } from '../renderers/status.js';
import { presentHumanDocument } from '../cli/human-output.js';
export async function showStatus(context, options = {}) {
    const report = await inspectStatus(context);
    if (options.json)
        console.log(renderJson(report));
    else
        presentHumanDocument(context, renderStatusDocument(report), { verbose: options.verbose });
    return report;
}
