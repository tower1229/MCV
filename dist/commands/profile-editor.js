import { runProfileEditor, } from '../tui/profile/app.js';
export async function openProfileEditor(context, options = {}, dependencies = {}, runtime = {}) {
    const outcome = await runProfileEditor(context, options, dependencies, runtime);
    if (outcome.summary) {
        console.log(outcome.summary);
    }
    if (outcome.reason === 'interrupted') {
        process.exitCode = 130;
    }
    return outcome;
}
export function shouldOpenProfileEditor(options = {}) {
    if (options.json)
        return false;
    if (options.expectedRevision !== undefined)
        return false;
    if (options.title !== undefined
        || options.description !== undefined
        || (options.add?.length ?? 0) > 0
        || (options.remove?.length ?? 0) > 0) {
        return false;
    }
    return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}
