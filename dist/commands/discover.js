import { inspectEnvironment, } from '../operations/environment.js';
import { renderEnvironmentDocument } from '../renderers/environment.js';
import { presentJson } from '../renderers/json.js';
import { presentDocument } from '../presentation/output.js';
export async function discoverConfigurations(context, options = {}) {
    const report = await inspectEnvironment(context);
    if (options.json) {
        presentJson(report);
    }
    else {
        presentDocument(context, renderEnvironmentDocument(report), { verbose: options.verbose });
    }
    return report;
}
