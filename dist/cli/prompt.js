import { createInterface } from 'readline/promises';
import { presentPrompt } from '../presentation/output.js';
export async function askInTerminal(question) {
    if (typeof process.stdin.ref === 'function')
        process.stdin.ref();
    const prompt = createInterface({ input: process.stdin, output: process.stdout });
    const cancellation = new AbortController();
    const handleInterrupt = () => cancellation.abort();
    process.once('SIGINT', handleInterrupt);
    prompt.once('SIGINT', handleInterrupt);
    try {
        presentPrompt(question.trimEnd());
        const answer = await prompt.question('', { signal: cancellation.signal });
        return { interrupted: false, answer };
    }
    catch (error) {
        if (cancellation.signal.aborted || isAbortError(error))
            return { interrupted: true };
        throw error;
    }
    finally {
        process.off('SIGINT', handleInterrupt);
        prompt.off('SIGINT', handleInterrupt);
        prompt.close();
    }
}
export async function withInterruptsIgnored(operation) {
    const ignoreInterrupt = () => { };
    process.on('SIGINT', ignoreInterrupt);
    try {
        return await operation();
    }
    finally {
        process.off('SIGINT', ignoreInterrupt);
    }
}
function isAbortError(error) {
    return error instanceof Error && error.name === 'AbortError';
}
