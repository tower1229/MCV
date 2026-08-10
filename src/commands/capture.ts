import type { DeviceContext } from '../adapters/types.js';
import { askInTerminal, withInterruptsIgnored } from '../cli/prompt.js';
import { recordCaptureSuccess } from '../utils/state.js';
import { applyCapturePlan, createCapturePlan } from '../operations/capture.js';
import { renderCapturePlanDocument, renderCaptureResultDocument } from '../renderers/capture.js';
import { renderJson } from '../renderers/json.js';
import { presentHumanDocument } from '../cli/human-output.js';

export interface CaptureOptions {
  dryRun?: boolean;
  json?: boolean;
  yes?: boolean;
  verbose?: boolean;
}

export interface CaptureDependencies {
  confirmCapture?: () => Promise<boolean | undefined>;
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
    else presentHumanDocument(context, renderCapturePlanDocument(capturePlan), {
      verbose: options.verbose,
    });
    if (capturePlan.status === 'failed') process.exitCode = 1;
    return;
  }
  if (capturePlan.status === 'failed') {
    const result = await applyCapturePlan(context, capturePlan, { changeIds: [] });
    if (options.json) console.log(renderJson(result));
    else presentHumanDocument(context, renderCaptureResultDocument(result), {
      verbose: options.verbose,
    });
    process.exitCode = 1;
    return;
  }
  if (!options.json && !options.yes) {
    presentHumanDocument(context, renderCapturePlanDocument(capturePlan), {
      verbose: options.verbose,
    });
  }
  const changeIds = capturePlan.changes
    .filter((change) => change.defaultSelected)
    .map((change) => change.id);
  if (!options.yes) {
    let interrupted = false;
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
          ? async (name: string, candidates: string[]) => {
              const outcome = await selectConflictInTerminal(name, candidates);
              interrupted = outcome.interrupted;
              return outcome.choice;
            }
          : async () => undefined);
      const choice = await choose(
        choices[0].repositoryPaths[0],
        choices.map((candidate) => candidate.sourceLabel ?? candidate.id),
      );
      if (interrupted) break;
      if (choice !== undefined && choices[choice]?.decision !== 'skip') {
        changeIds.push(choices[choice].id);
      } else if (canChoose) {
        const skip = choices.find((candidate) => candidate.decision === 'skip');
        if (skip) changeIds.push(skip.id);
      }
    }
    if (interrupted) {
      process.exitCode = 130;
      console.log('Capture interrupted; repository was not changed.');
      return;
    }
  }
  if (!options.yes) {
    if (!process.stdin.isTTY && !dependencies.confirmCapture) {
      throw new Error('Capture requires an interactive terminal; use --yes only after reviewing --dry-run.');
    }
    const confirmed = await (dependencies.confirmCapture ?? confirmInTerminal)();
    if (confirmed === undefined) {
      process.exitCode = 130;
      console.log('Capture interrupted; repository was not changed.');
      return;
    }
    if (!confirmed) {
      console.log('Capture cancelled; repository was not changed.');
      return;
    }
  }
  const result = await withInterruptsIgnored(() =>
    applyCapturePlan(context, capturePlan, {
      changeIds,
      confirmedIssueIds: options.yes
        ? []
        : capturePlan.issues
          .filter((issue) => issue.severity === 'warning')
          .map((issue) => issue.confirmationId),
    }, { nonInteractive: options.yes }));
  if (result.status === 'succeeded') {
    recordCaptureSuccess(context);
  } else {
    process.exitCode = result.status === 'blocked' ? 3 : 1;
  }
  if (options.json) console.log(renderJson(result));
  else presentHumanDocument(context, renderCaptureResultDocument(result), {
    verbose: options.verbose,
  });
}

async function confirmInTerminal(): Promise<boolean | undefined> {
  const outcome = await askInTerminal('Write these changes to the repository? [y/N] ');
  return outcome.interrupted ? undefined : /^(y|yes)$/i.test(outcome.answer.trim());
}

async function selectConflictInTerminal(
  name: string,
  candidates: string[],
): Promise<{ interrupted: boolean; choice?: number }> {
  console.log(`Conflict: ${name}`);
  candidates.forEach((candidate, index) => console.log(`  ${index + 1}. ${candidate}`));
  const outcome = await askInTerminal('Choose authoritative source (blank to skip): ');
  if (outcome.interrupted) return { interrupted: true };
  const answer = Number(outcome.answer);
  return Number.isInteger(answer) && answer > 0 && answer <= candidates.length
    ? { interrupted: false, choice: answer - 1 }
    : { interrupted: false };
}
