export const OPERATION_PROGRESS_STAGE = {
  inspectingRepository: 'inspecting-repository',
  scanningAdapters: 'scanning-adapters',
  buildingPlan: 'building-plan',
  creatingVerifiedBackup: 'creating-verified-backup',
  applyingSelectedChanges: 'applying-selected-changes',
  verifyingResult: 'verifying-result',
  rollingBack: 'rolling-back',
} as const;

export type OperationProgressStage =
  typeof OPERATION_PROGRESS_STAGE[keyof typeof OPERATION_PROGRESS_STAGE];

export type OperationProgressReporter = (stage: OperationProgressStage) => void;

export interface OperationProgressOptions {
  onProgress?: OperationProgressReporter;
}
