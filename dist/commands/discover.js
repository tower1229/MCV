import { inspectEnvironment, } from '../operations/environment.js';
import { renderEnvironmentDocument } from '../renderers/environment.js';
import { renderJson } from '../renderers/json.js';
import { presentHumanDocument } from '../cli/human-output.js';
export async function discoverConfigurations(context, options = {}) {
    const report = await inspectEnvironment(context);
    if (options.json) {
        console.log(renderJson(report));
    }
    else {
        presentHumanDocument(context, renderEnvironmentDocument(report), { verbose: options.verbose });
    }
    return report;
}
