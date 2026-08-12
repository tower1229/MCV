import {
  OPERATION_PROGRESS_STAGE,
  type OperationProgressReporter,
  type OperationProgressStage,
} from '../operations/progress.js';
import { presentProgress } from '../presentation/output.js';

const PROGRESS_LABELS: Record<OperationProgressStage, string> = {
  [OPERATION_PROGRESS_STAGE.inspectingRepository]: 'Inspecting repository',
  [OPERATION_PROGRESS_STAGE.scanningAdapters]: 'Scanning adapters',
  [OPERATION_PROGRESS_STAGE.buildingPlan]: 'Building plan',
  [OPERATION_PROGRESS_STAGE.creatingVerifiedBackup]: 'Creating verified backup',
  [OPERATION_PROGRESS_STAGE.applyingSelectedChanges]: 'Applying selected changes',
  [OPERATION_PROGRESS_STAGE.verifyingResult]: 'Verifying result',
  [OPERATION_PROGRESS_STAGE.rollingBack]: 'Rolling back',
};

export function createTerminalProgressReporter(json: boolean | undefined): OperationProgressReporter | undefined {
  if (json || !process.stdin.isTTY || !process.stdout.isTTY) return undefined;
  return (stage) => presentProgress(PROGRESS_LABELS[stage]);
}
