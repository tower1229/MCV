import type { DeviceContext } from '../adapters/types.js';
import {
  runProfileEditor,
  type ProfileEditorOutcome,
  type ProfileEditorDependencies,
  type ProfileEditorRuntime,
} from '../tui/profile/app.js';
import { presentOutcome } from '../presentation/output.js';

export interface OpenProfileEditorOptions {
  initialProfileId?: string;
}

export async function openProfileEditor(
  context: DeviceContext,
  options: OpenProfileEditorOptions = {},
  dependencies: ProfileEditorDependencies = {},
  runtime: ProfileEditorRuntime = {},
): Promise<ProfileEditorOutcome> {
  const outcome = await runProfileEditor(context, options, dependencies, runtime);
  if (outcome.summary) {
    presentOutcome(
      'Profile Result',
      outcome.summary,
      outcome.reason === 'interrupted' ? 'danger' : 'attention',
    );
  }
  if (outcome.reason === 'interrupted') {
    process.exitCode = 130;
  }
  return outcome;
}

export function shouldOpenProfileEditor(options: {
  title?: string;
  description?: string;
  add?: string[];
  remove?: string[];
  expectedRevision?: string;
  json?: boolean;
} = {}): boolean {
  if (options.json) return false;
  if (options.expectedRevision !== undefined) return false;
  if (
    options.title !== undefined
    || options.description !== undefined
    || (options.add?.length ?? 0) > 0
    || (options.remove?.length ?? 0) > 0
  ) {
    return false;
  }
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}
