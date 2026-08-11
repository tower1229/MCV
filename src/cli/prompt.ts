import { createInterface } from 'readline/promises';
import { presentPrompt } from '../presentation/output.js';

export type TerminalPromptOutcome =
  | { interrupted: false; answer: string }
  | { interrupted: true };

export async function askInTerminal(question: string): Promise<TerminalPromptOutcome> {
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  const cancellation = new AbortController();
  const handleInterrupt = (): void => cancellation.abort();
  process.once('SIGINT', handleInterrupt);
  prompt.once('SIGINT', handleInterrupt);
  try {
    presentPrompt(question.trimEnd());
    const answer = await prompt.question('', { signal: cancellation.signal });
    return { interrupted: false, answer };
  } catch (error) {
    if (cancellation.signal.aborted || isAbortError(error)) return { interrupted: true };
    throw error;
  } finally {
    process.off('SIGINT', handleInterrupt);
    prompt.off('SIGINT', handleInterrupt);
    prompt.close();
  }
}

export async function withInterruptsIgnored<T>(
  operation: () => Promise<T> | T,
): Promise<T> {
  const ignoreInterrupt = (): void => {};
  process.on('SIGINT', ignoreInterrupt);
  try {
    return await operation();
  } finally {
    process.off('SIGINT', ignoreInterrupt);
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}
