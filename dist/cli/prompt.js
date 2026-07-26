"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.askInTerminal = askInTerminal;
exports.withInterruptsIgnored = withInterruptsIgnored;
const promises_1 = require("readline/promises");
async function askInTerminal(question) {
    const prompt = (0, promises_1.createInterface)({ input: process.stdin, output: process.stdout });
    const cancellation = new AbortController();
    const handleInterrupt = () => cancellation.abort();
    process.once('SIGINT', handleInterrupt);
    prompt.once('SIGINT', handleInterrupt);
    try {
        const answer = await prompt.question(question, { signal: cancellation.signal });
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
async function withInterruptsIgnored(operation) {
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
