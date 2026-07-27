import { inspectEnvironment, } from '../operations/environment.js';
import { renderEnvironmentPlain } from '../renderers/environment.js';
import { renderJson } from '../renderers/json.js';
export async function discoverConfigurations(context, options = {}) {
    const report = await inspectEnvironment(context);
    if (options.json) {
        console.log(renderJson(report));
    }
    else {
        for (const line of renderEnvironmentPlain(report))
            console.log(line);
    }
    return report;
}
