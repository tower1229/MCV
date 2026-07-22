import { createInterface } from 'readline/promises';
import type { DeviceContext } from '../adapters/types';
import { readState, writeState } from '../utils/state';
import { applyCapturePlan, createCapturePlan } from '../operations/capture';
import { renderCapturePlanPlain, renderCaptureResultPlain } from '../renderers/capture';
import { renderJson } from '../renderers/json';

export interface CaptureOptions {
  dryRun?: boolean;
  json?: boolean;
  yes?: boolean;
  verbose?: boolean;
}

export interface CaptureDependencies {
  confirmCapture?: () => Promise<boolean>;
  selectConflict?: (repositoryPath: string, candidates: string[]) => Promise<number | undefined>;
}

export async function captureConfigurations(
  context: DeviceContext,
  dependencies: CaptureDependencies = {},
  options: CaptureOptions = {},
): Promise<void> {
  const capturePlan = await createCapturePlan(context);
  if (options.dryRun) {
    if (options.json) console.log(renderJson(capturePlan));
    else for (const line of renderCapturePlanPlain(capturePlan)) console.log(line);
    if (capturePlan.status === 'failed') process.exitCode = 1;
    return;
  }
  if (capturePlan.status === 'failed') {
    const result = await applyCapturePlan(context, capturePlan, { changeIds: [] });
    if (options.json) console.log(renderJson(result));
    else for (const line of renderCaptureResultPlain(result)) console.log(line);
    process.exitCode = 1;
    return;
  }
  if (!options.json && !options.yes) {
    for (const line of renderCapturePlanPlain(capturePlan)) console.log(line);
  }
  const changeIds = capturePlan.changes
    .filter((change) => change.defaultSelected)
    .map((change) => change.id);
  if (!options.yes) {
    const decisionGroups = new Map<string, typeof capturePlan.changes>();
    for (const change of capturePlan.changes) {
      if (!change.decisionGroupId) continue;
      decisionGroups.set(
        change.decisionGroupId,
        [...(decisionGroups.get(change.decisionGroupId) ?? []), change],
      );
    }
    for (const choices of decisionGroups.values()) {
      const canChoose = dependencies.selectConflict !== undefined || process.stdin.isTTY;
      const choose = dependencies.selectConflict
        ?? (canChoose
          ? (name: string, candidates: string[]) => selectConflictInTerminal(name, candidates)
          : async () => undefined);
      const choice = await choose(
        choices[0].repositoryPaths[0],
        choices.map((candidate) => candidate.sourceLabel ?? candidate.id),
      );
      if (choice !== undefined && choices[choice]?.decision !== 'skip') {
        changeIds.push(choices[choice].id);
      } else if (canChoose) {
        const skip = choices.find((candidate) => candidate.decision === 'skip');
        if (skip) changeIds.push(skip.id);
      }
    }
  }
  if (!options.yes) {
    if (!process.stdin.isTTY && !dependencies.confirmCapture) {
      throw new Error('Capture requires an interactive terminal; use --yes only after reviewing --dry-run.');
    }
    const confirmed = await (dependencies.confirmCapture ?? confirmInTerminal)();
    if (!confirmed) {
      console.log('Capture cancelled; repository was not changed.');
      return;
    }
  }
  const result = await applyCapturePlan(context, capturePlan, {
    changeIds,
    confirmedIssueCodes: options.yes
      ? []
      : capturePlan.issues
        .filter((issue) => issue.severity === 'warning')
        .map((issue) => issue.code),
  }, { nonInteractive: options.yes });
  if (result.status === 'succeeded') {
    const state = readState(context);
    state.lastOperation = { kind: 'capture', time: new Date().toISOString(), success: true };
    writeState(context, state);
  } else {
    process.exitCode = result.status === 'blocked' ? 3 : 1;
  }
  if (options.json) console.log(renderJson(result));
  else for (const line of renderCaptureResultPlain(result)) console.log(line);
}

async function confirmInTerminal(): Promise<boolean> {
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  try { return /^(y|yes)$/i.test((await prompt.question('Write these changes to the repository? [y/N] ')).trim()); }
  finally { prompt.close(); }
}

async function selectConflictInTerminal(name: string, candidates: string[]): Promise<number | undefined> {
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  try {
    console.log(`Conflict: ${name}`);
    candidates.forEach((candidate, index) => console.log(`  ${index + 1}. ${candidate}`));
    const answer = Number(await prompt.question('Choose authoritative source (blank to skip): '));
    return Number.isInteger(answer) && answer > 0 && answer <= candidates.length ? answer - 1 : undefined;
  } finally { prompt.close(); }
}
