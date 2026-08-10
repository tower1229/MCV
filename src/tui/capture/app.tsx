import {
  render,
  useApp,
  useInput,
  useWindowSize,
  type Instance,
} from 'ink';
import { useEffect, useReducer, useRef, useState } from 'react';
import type { DeviceContext } from '../../adapters/types.js';
import { writeHumanReviewArtifact } from '../../cli/human-output.js';
import {
  applyCapturePlan,
  createCapturePlan,
  type CapturePlan,
  type CaptureResult,
} from '../../operations/capture.js';
import { captureReviewSelection } from '../../review/capture.js';
import { renderCapturePlanDocument } from '../../renderers/capture.js';
import { recordCaptureSuccess } from '../../utils/state.js';
import { preserveTerminalInputMode } from '../terminal-input-mode.js';
import {
  captureTuiReducer,
  createCaptureTuiState,
  type CaptureTuiState,
} from './reducer.js';
import { CaptureTuiView } from './view.js';

export interface CaptureTuiOutcome {
  reason: 'completed' | 'cancelled' | 'interrupted';
  result?: CaptureResult;
  reviewPath?: string;
  summary: string;
}

export interface CaptureTuiDependencies {
  createPlan?: typeof createCapturePlan;
  applyPlan?: typeof applyCapturePlan;
  recordSuccess?: typeof recordCaptureSuccess;
  writeReviewArtifact?: typeof writeHumanReviewArtifact;
}

export interface CaptureTuiRuntime {
  render?: typeof render;
  restoreAfterRenderFailure?: (wasRaw: boolean) => void;
  preserveTerminalInputMode?: (platform: NodeJS.Platform) => () => void;
}

export async function runCaptureReviewTui(
  context: DeviceContext,
  initialPlan: CapturePlan,
  dependencies: CaptureTuiDependencies = {},
  runtime: CaptureTuiRuntime = {},
): Promise<CaptureTuiOutcome> {
  let instance: Instance | undefined;
  const wasRaw = Boolean(process.stdin.isRaw);
  const restoreInputMode = (
    runtime.preserveTerminalInputMode ?? preserveTerminalInputMode
  )(context.platform);
  try {
    instance = (runtime.render ?? render)(
      <CaptureReviewApp
        context={context}
        initialPlan={initialPlan}
        dependencies={dependencies}
      />,
      {
        alternateScreen: true,
        interactive: true,
        exitOnCtrlC: false,
        patchConsole: false,
      },
    );
    return await instance.waitUntilExit() as CaptureTuiOutcome;
  } catch (error) {
    if (!instance) (runtime.restoreAfterRenderFailure ?? restoreAfterRenderFailure)(wasRaw);
    throw error;
  } finally {
    try {
      instance?.unmount();
    } finally {
      restoreInputMode();
    }
  }
}

function CaptureReviewApp({
  context,
  initialPlan,
  dependencies,
}: {
  context: DeviceContext;
  initialPlan: CapturePlan;
  dependencies: CaptureTuiDependencies;
}) {
  const [state, dispatch] = useReducer(captureTuiReducer, initialPlan, createCaptureTuiState);
  const [reviewPath, setReviewPath] = useState(() =>
    writeReview(context, initialPlan, dependencies.writeReviewArtifact));
  const { exit } = useApp();
  const windowSize = useWindowSize();
  const stateRef = useRef(state);
  const applyInFlightRef = useRef(false);
  const exitingRef = useRef(false);
  stateRef.current = state;

  useEffect(() => {
    if (state.status !== 'applying' || applyInFlightRef.current) return;
    applyInFlightRef.current = true;
    const apply = dependencies.applyPlan ?? applyCapturePlan;
    const create = dependencies.createPlan ?? createCapturePlan;
    void apply(
      context,
      state.model.plan,
      captureReviewSelection(state.draft),
    ).then(async (result) => {
      if (result.status === 'failed' && result.error.code === 'operation.stalePlan') {
        dispatch({ type: 'regenerating' });
        const regenerated = await create(context);
        setReviewPath(writeReview(context, regenerated, dependencies.writeReviewArtifact));
        dispatch({ type: 'regenerated', plan: regenerated });
        applyInFlightRef.current = false;
        return;
      }
      if (result.status === 'succeeded') {
        (dependencies.recordSuccess ?? recordCaptureSuccess)(context);
      }
      dispatch({ type: 'applied', result });
      applyInFlightRef.current = false;
    }).catch((error: unknown) => {
      finish({
        reason: 'interrupted',
        reviewPath,
        summary: error instanceof Error ? error.message : String(error),
      });
    });
  }, [context, dependencies, reviewPath, state]);

  useInput((input, key) => {
    const current = stateRef.current;
    if (key.ctrl && input === 'c') {
      if (current.status !== 'applying' && current.status !== 'regenerating') {
        finish({
          reason: 'interrupted',
          reviewPath,
          summary: 'Capture interrupted; repository was not changed.',
        });
      }
      return;
    }
    if (current.status === 'applying' || current.status === 'regenerating') return;
    if (current.status === 'result') {
      if (key.return || input === 'q') finish(resultOutcome(current, reviewPath));
      return;
    }
    if (key.escape) {
      if (current.status === 'diff') dispatch({ type: 'closeDiff' });
      else finish(cancelledOutcome(reviewPath));
      return;
    }
    if (input === 'q') {
      finish(cancelledOutcome(reviewPath));
      return;
    }
    if (key.upArrow) dispatch({ type: 'move', delta: -1 });
    else if (key.downArrow) dispatch({ type: 'move', delta: 1 });
    else if (key.leftArrow) dispatch({ type: 'back' });
    else if (key.rightArrow) dispatch({ type: 'openDiff' });
    else if (input === ' ') dispatch({ type: 'toggle' });
    else if (input === 'n') dispatch({ type: 'continue' });
    else if (key.return) {
      if (current.status === 'changes') dispatch({ type: 'openDiff' });
      else if (current.status === 'final') dispatch({ type: 'apply' });
      else dispatch({ type: 'continue' });
    }
  });

  function finish(outcome: CaptureTuiOutcome): void {
    if (exitingRef.current) return;
    exitingRef.current = true;
    exit(outcome);
  }

  return (
    <CaptureTuiView
      state={state}
      columns={windowSize.columns}
      rows={windowSize.rows}
      reviewPath={reviewPath}
    />
  );
}

function writeReview(
  context: DeviceContext,
  plan: CapturePlan,
  write: typeof writeHumanReviewArtifact = writeHumanReviewArtifact,
): string | undefined {
  const document = renderCapturePlanDocument(plan);
  if (document.details.length === 0) return undefined;
  try {
    return write(context, document);
  } catch {
    return undefined;
  }
}

function resultOutcome(state: CaptureTuiState, reviewPath?: string): CaptureTuiOutcome {
  const result = state.result;
  if (!result) return { reason: 'completed', reviewPath, summary: 'Capture finished.' };
  if (result.status === 'succeeded') {
    const applied = result.changes.filter((change) => change.decision !== 'skip').length;
    return {
      reason: 'completed',
      result,
      reviewPath,
      summary: `Captured ${applied} selected item(s) into ${result.repositoryPath}.`,
    };
  }
  return {
    reason: 'completed',
    result,
    reviewPath,
    summary: `Capture ${result.status}; repository was not changed.`,
  };
}

function cancelledOutcome(reviewPath?: string): CaptureTuiOutcome {
  return {
    reason: 'cancelled',
    reviewPath,
    summary: 'Capture cancelled; repository was not changed.',
  };
}

function restoreAfterRenderFailure(wasRaw: boolean): void {
  if (process.stdin.isTTY && typeof process.stdin.setRawMode === 'function') {
    process.stdin.setRawMode(wasRaw);
  }
  process.stdout.write('\u001b[?25h\u001b[?1049l');
}
