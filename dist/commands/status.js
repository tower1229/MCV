import { inspectStatus, } from '../operations/status.js';
import { renderJson } from '../renderers/json.js';
import { renderStatusPlain } from '../renderers/status.js';
export async function showStatus(context, options = {}) {
    const report = await inspectStatus(context);
    if (options.json)
        console.log(renderJson({ ...report, changes: [] }));
    else
        for (const line of renderStatusPlain(report))
            console.log(line);
    return report;
}
