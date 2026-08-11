import { inspectStatus, } from '../operations/status.js';
import { presentJson } from '../renderers/json.js';
import { renderStatusDocument } from '../renderers/status.js';
import { presentDocument } from '../presentation/output.js';
export async function showStatus(context, options = {}) {
    const report = await inspectStatus(context);
    if (options.json)
        presentJson(report);
    else
        presentDocument(context, renderStatusDocument(report), { verbose: options.verbose });
    return report;
}
