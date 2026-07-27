import type { EnvironmentReport } from '../operations/environment.js';
import type { ConfigurationCapability } from '../adapters/types.js';
import type {
  CaptureChange,
  CapturePlan,
  CaptureResult,
} from '../operations/capture.js';
import type {
  BindPlan,
  BindResult,
  InitPlan,
  InitResult,
  MigrationPlan,
  MigrationResult,
  RepositoryReport,
  UnbindPlan,
  UnbindResult,
} from '../operations/repository.js';
import type { StatusReport } from '../operations/status.js';
import type {
  DeployChange,
  DeployPlan,
  DeployResult,
} from '../operations/deploy.js';
import type {
  RestorePlan,
  RestoreResult,
} from '../operations/restore.js';

export type ShellRoute =
  | 'repository'
  | 'overview'
  | 'help'
  | 'environment'
  | 'capture'
  | 'deploy'
  | 'restore';

export type RepositoryMenuAction =
  | 'continue'
  | 'bind-current'
  | 'enter-path'
  | 'init-here'
  | 'migrate'
  | 'rebind'
  | 'unbind';

export type RepositoryOperation = 'bind' | 'init' | 'migrate' | 'unbind';
export type RepositoryPlan = BindPlan | InitPlan | MigrationPlan | UnbindPlan;
type RepositoryPlanStep =
  | { operation: 'bind'; plan: BindPlan }
  | { operation: 'init'; plan: InitPlan }
  | { operation: 'migrate'; plan: MigrationPlan }
  | { operation: 'unbind'; plan: UnbindPlan };
type RepositoryResultStep =
  | { operation: 'bind'; result: BindResult }
  | { operation: 'init'; result: InitResult }
  | { operation: 'migrate'; result: MigrationResult }
  | { operation: 'unbind'; result: UnbindResult };
type RepositoryWorkflowContext = {
  report: RepositoryReport;
  currentDirectory: RepositoryReport;
  resumeRoute: Exclude<ShellRoute, 'repository'>;
};

export type RepositoryWorkflowState =
  | {
    status: 'menu';
    report: RepositoryReport;
    currentDirectory: RepositoryReport;
    cursor: number;
    actions: RepositoryMenuAction[];
    resumeRoute: Exclude<ShellRoute, 'repository'>;
  }
  | {
    status: 'path';
    report: RepositoryReport;
    currentDirectory: RepositoryReport;
    value: string;
    resumeRoute: Exclude<ShellRoute, 'repository'>;
  }
  | ({
    status: 'plan';
    step: RepositoryPlanStep;
  } & RepositoryWorkflowContext)
  | ({
    status: 'applying';
    step: RepositoryPlanStep;
  } & RepositoryWorkflowContext)
  | ({
    status: 'result';
    step: RepositoryResultStep;
  } & RepositoryWorkflowContext);

interface CaptureSelectionState {
  status: 'selection';
  plan: CapturePlan;
  cursor: number;
  selectedIds: string[];
}

interface CaptureDiffState {
  status: 'diff';
  plan: CapturePlan;
  cursor: number;
  selectedIds: string[];
  changeId: string;
}

interface CaptureDecisionState {
  status: 'decision';
  plan: CapturePlan;
  selectedIds: string[];
  groupIndex: number;
  cursor: number;
}

interface CaptureConfirmationState {
  status: 'confirmation';
  plan: CapturePlan;
  selectedIds: string[];
  confirmedIssueCodes: string[];
  warningCursor: number;
}

interface CaptureApplyingState {
  status: 'applying';
  plan: CapturePlan;
  selectedIds: string[];
  confirmedIssueCodes: string[];
}

interface CaptureRegeneratingState {
  status: 'regenerating';
}

interface CaptureResultState {
  status: 'result';
  result: CaptureResult;
}

export type CaptureWorkflowState =
  | CaptureSelectionState
  | CaptureDiffState
  | CaptureDecisionState
  | CaptureConfirmationState
  | CaptureApplyingState
  | CaptureRegeneratingState
  | CaptureResultState;

interface DeploySelectionState {
  status: 'selection';
  plan: DeployPlan;
  cursor: number;
  selectedIds: string[];
  advancedExpanded: boolean;
}

interface DeployDiffState {
  status: 'diff';
  plan: DeployPlan;
  cursor: number;
  selectedIds: string[];
  advancedExpanded: boolean;
  changeId: string;
}

interface DeployConfirmationState {
  status: 'confirmation';
  plan: DeployPlan;
  selectedIds: string[];
  confirmedIssueCodes: string[];
  warningCursor: number;
  advancedExpanded: boolean;
}

interface DeployApplyingState {
  status: 'applying';
  plan: DeployPlan;
  selectedIds: string[];
  confirmedIssueCodes: string[];
}

interface DeployRegeneratingState {
  status: 'regenerating';
}

interface DeployResultState {
  status: 'result';
  result: DeployResult;
}

export type DeployWorkflowState =
  | DeploySelectionState
  | DeployDiffState
  | DeployConfirmationState
  | DeployApplyingState
  | DeployRegeneratingState
  | DeployResultState;

export type RestoreWorkflowState =
  | {
    status: 'review';
    plan: RestorePlan;
  }
  | {
    status: 'applying';
    plan: RestorePlan;
  }
  | {
    status: 'regenerating';
  }
  | {
    status: 'result';
    result: RestoreResult;
  };

export type LastDeploySelection = Partial<
  Record<'codex' | 'claude-code' | 'gemini', ConfigurationCapability[]>
>;

type LoadingPage = {
  route: ShellRoute;
  status: 'loading';
};

type ReadyPage =
  | {
    route: 'repository';
    status: 'ready';
    workflow: RepositoryWorkflowState;
  }
  | {
    route: 'overview';
    status: 'ready';
    report: StatusReport;
  }
  | {
    route: 'environment';
    status: 'ready';
    report: EnvironmentReport;
  }
  | {
    route: 'help';
    status: 'ready';
  }
  | {
    route: 'capture';
    status: 'ready';
    workflow: CaptureWorkflowState;
  }
  | {
    route: 'deploy';
    status: 'ready';
    workflow: DeployWorkflowState;
  }
  | {
    route: 'restore';
    status: 'ready';
    workflow: RestoreWorkflowState;
  };

type FailedPage = {
  route: ShellRoute;
  status: 'failure';
  message: string;
};

export interface ShellState {
  page: LoadingPage | ReadyPage | FailedPage;
  reports: {
    overview?: StatusReport;
    environment?: EnvironmentReport;
  };
  captureResult?: CaptureResult;
  deployResult?: DeployResult;
  restoreResult?: RestoreResult;
  repositoryResult?: RepositoryResultStep;
  postInitOnboarding: boolean;
  repositoryResumeRoute: Exclude<ShellRoute, 'repository'>;
  exitReason: 'completed' | 'interrupted' | null;
}

export type ShellAction =
  | {
    type: 'repository.loaded';
    report: RepositoryReport;
    currentDirectory: RepositoryReport;
    resumeRoute: Exclude<ShellRoute, 'repository'>;
  }
  | { type: 'repository.move'; delta: number }
  | { type: 'repository.path'; value: string }
  | { type: 'repository.enterPath' }
  | ({ type: 'repository.plan' } & RepositoryPlanStep)
  | { type: 'repository.apply' }
  | ({ type: 'repository.applied' } & RepositoryResultStep)
  | { type: 'repository.back' }
  | { type: 'onboarding.continue' }
  | { type: 'overview.loaded'; report: StatusReport }
  | { type: 'environment.loaded'; report: EnvironmentReport }
  | { type: 'capture.loaded'; plan: CapturePlan }
  | { type: 'capture.move'; delta: number }
  | { type: 'capture.toggleSelection' }
  | { type: 'capture.openDiff' }
  | { type: 'capture.closeDiff' }
  | { type: 'capture.chooseDecision' }
  | { type: 'capture.toggleWarning' }
  | { type: 'capture.continue' }
  | { type: 'capture.back' }
  | { type: 'capture.apply' }
  | { type: 'capture.applied'; result: CaptureResult }
  | {
    type: 'deploy.loaded';
    plan: DeployPlan;
    lastSelection?: LastDeploySelection;
  }
  | { type: 'deploy.move'; delta: number }
  | { type: 'deploy.toggleSelection' }
  | { type: 'deploy.toggleAdvanced' }
  | { type: 'deploy.openDiff' }
  | { type: 'deploy.closeDiff' }
  | { type: 'deploy.toggleWarning' }
  | { type: 'deploy.continue' }
  | { type: 'deploy.back' }
  | { type: 'deploy.apply' }
  | { type: 'deploy.applied'; result: DeployResult }
  | { type: 'restore.loaded'; plan: RestorePlan }
  | { type: 'restore.apply' }
  | { type: 'restore.applied'; result: RestoreResult }
  | { type: 'page.failed'; route: ShellRoute; message: string }
  | { type: 'navigate'; route: ShellRoute }
  | { type: 'exit' }
  | { type: 'cancel' };

export function createInitialShellState(route: ShellRoute): ShellState {
  return {
    page: route === 'help'
      ? { route, status: 'ready' }
      : { route, status: 'loading' },
    reports: {},
    postInitOnboarding: false,
    repositoryResumeRoute: route === 'repository' ? 'overview' : route,
    exitReason: null,
  };
}

export function shellReducer(state: ShellState, action: ShellAction): ShellState {
  switch (action.type) {
    case 'repository.loaded':
      return {
        ...state,
        repositoryResumeRoute: action.resumeRoute,
        page: {
          route: 'repository',
          status: 'ready',
          workflow: {
            status: 'menu',
            report: action.report,
            currentDirectory: action.currentDirectory,
            cursor: 0,
            actions: repositoryMenuActions(
              action.report,
              action.currentDirectory,
            ),
            resumeRoute: action.resumeRoute,
          },
        },
      };
    case 'repository.move':
      return updateRepositoryWorkflow(state, (workflow) => {
        if (workflow.status !== 'menu') return workflow;
        return {
          ...workflow,
          cursor: wrapIndex(
            workflow.cursor + action.delta,
            workflow.actions.length,
          ),
        };
      });
    case 'repository.path':
      return updateRepositoryWorkflow(state, (workflow) =>
        workflow.status === 'path'
          ? { ...workflow, value: action.value }
          : workflow);
    case 'repository.enterPath':
      return updateRepositoryWorkflow(state, (workflow) =>
        workflow.status === 'menu'
          ? {
            status: 'path',
            report: workflow.report,
            currentDirectory: workflow.currentDirectory,
            value: '',
            resumeRoute: workflow.resumeRoute,
          }
          : workflow);
    case 'repository.plan':
      return updateRepositoryWorkflow(state, (workflow) => ({
        status: 'plan',
        step: action,
        report: workflow.report,
        currentDirectory: workflow.currentDirectory,
        resumeRoute: workflow.resumeRoute,
      }));
    case 'repository.apply':
      return updateRepositoryWorkflow(state, (workflow) =>
        workflow.status === 'plan' && workflow.step.plan.status === 'planned'
          ? { ...workflow, status: 'applying' }
          : workflow);
    case 'repository.applied': {
      const stateWithRepositoryResult: ShellState = {
        ...state,
        repositoryResult: {
          operation: action.operation,
          result: action.result,
        } as RepositoryResultStep,
      };
      if (action.result.status === 'succeeded') {
        if (action.operation === 'init') {
          return {
            ...stateWithRepositoryResult,
            page: { route: 'environment', status: 'loading' },
            postInitOnboarding: true,
          };
        }
        if (
          action.operation === 'bind'
          && state.page.route === 'repository'
          && state.page.status === 'ready'
        ) {
          return {
            ...stateWithRepositoryResult,
            page: {
              route: state.page.workflow.resumeRoute,
              status: 'loading',
            },
          };
        }
        return {
          ...stateWithRepositoryResult,
          page: { route: 'repository', status: 'loading' },
        };
      }
      return updateRepositoryWorkflow(stateWithRepositoryResult, (workflow) => ({
        status: 'result',
        step: action,
        report: workflow.report,
        currentDirectory: workflow.currentDirectory,
        resumeRoute: workflow.resumeRoute,
      }));
    }
    case 'repository.back':
      return updateRepositoryWorkflow(state, (workflow) => ({
        status: 'menu',
        report: workflow.report,
        currentDirectory: workflow.currentDirectory,
        cursor: 0,
        actions: repositoryMenuActions(
          workflow.report,
          workflow.currentDirectory,
        ),
        resumeRoute: workflow.resumeRoute,
      }));
    case 'onboarding.continue':
      if (
        !state.postInitOnboarding
        || state.page.route !== 'environment'
        || state.page.status !== 'ready'
      ) return state;
      return {
        ...state,
        page: { route: 'capture', status: 'loading' },
        postInitOnboarding: false,
      };
    case 'overview.loaded':
      if (state.page.route !== 'overview') return state;
      return {
        ...state,
        reports: {
          ...state.reports,
          overview: action.report,
        },
        page: {
          route: 'overview',
          status: 'ready',
          report: action.report,
        },
      };
    case 'environment.loaded':
      if (state.page.route !== 'environment') return state;
      return {
        ...state,
        reports: {
          ...state.reports,
          environment: action.report,
        },
        page: {
          route: 'environment',
          status: 'ready',
          report: action.report,
        },
      };
    case 'capture.loaded':
      if (state.page.route !== 'capture') return state;
      if (action.plan.status === 'failed') {
        return {
          ...state,
          page: {
            route: 'capture',
            status: 'failure',
            message: action.plan.error.message,
          },
        };
      }
      return {
        ...state,
        page: {
          route: 'capture',
          status: 'ready',
          workflow: {
            status: 'selection',
            plan: action.plan,
            cursor: 0,
            selectedIds: action.plan.changes
              .filter((change) =>
                change.defaultSelected && change.change !== 'delete')
              .map((change) => change.id),
          },
        },
      };
    case 'capture.move':
      return updateCaptureWorkflow(state, (workflow) =>
        moveCaptureCursor(workflow, action.delta));
    case 'capture.toggleSelection':
      return updateCaptureWorkflow(state, toggleCaptureSelection);
    case 'capture.openDiff':
      return updateCaptureWorkflow(state, openCaptureDiff);
    case 'capture.closeDiff':
      return updateCaptureWorkflow(state, closeCaptureDiff);
    case 'capture.chooseDecision':
      return updateCaptureWorkflow(state, chooseCaptureDecision);
    case 'capture.toggleWarning':
      return updateCaptureWorkflow(state, toggleCaptureWarning);
    case 'capture.continue':
      return updateCaptureWorkflow(state, continueCaptureWorkflow);
    case 'capture.back':
      return updateCaptureWorkflow(state, backCaptureWorkflow);
    case 'capture.apply':
      return updateCaptureWorkflow(state, beginCaptureApply);
    case 'capture.applied':
      if (
        state.page.route !== 'capture'
        || state.page.status !== 'ready'
        || state.page.workflow.status !== 'applying'
      ) return state;
      if (
        action.result.status === 'failed'
        && action.result.error.code === 'operation.stalePlan'
      ) {
        return {
          ...state,
          page: {
            route: 'capture',
            status: 'ready',
            workflow: { status: 'regenerating' },
          },
        };
      }
      return {
        ...state,
        captureResult: action.result,
        page: {
          route: 'capture',
          status: 'ready',
          workflow: {
            status: 'result',
            result: action.result,
          },
        },
      };
    case 'deploy.loaded':
      if (state.page.route !== 'deploy') return state;
      if (action.plan.status === 'failed') {
        return {
          ...state,
          page: {
            route: 'deploy',
            status: 'failure',
            message: action.plan.error.message,
          },
        };
      }
      return {
        ...state,
        page: {
          route: 'deploy',
          status: 'ready',
          workflow: {
            status: 'selection',
            plan: action.plan,
            cursor: 0,
            selectedIds: initialDeploySelection(
              action.plan,
              action.lastSelection,
            ),
            advancedExpanded: false,
          },
        },
      };
    case 'deploy.move':
      return updateDeployWorkflow(state, (workflow) =>
        moveDeployCursor(workflow, action.delta));
    case 'deploy.toggleSelection':
      return updateDeployWorkflow(state, toggleDeploySelection);
    case 'deploy.toggleAdvanced':
      return updateDeployWorkflow(state, toggleDeployAdvanced);
    case 'deploy.openDiff':
      return updateDeployWorkflow(state, openDeployDiff);
    case 'deploy.closeDiff':
      return updateDeployWorkflow(state, closeDeployDiff);
    case 'deploy.toggleWarning':
      return updateDeployWorkflow(state, toggleDeployWarning);
    case 'deploy.continue':
      return updateDeployWorkflow(state, continueDeployWorkflow);
    case 'deploy.back':
      return updateDeployWorkflow(state, backDeployWorkflow);
    case 'deploy.apply':
      return updateDeployWorkflow(state, beginDeployApply);
    case 'deploy.applied':
      if (
        state.page.route !== 'deploy'
        || state.page.status !== 'ready'
        || state.page.workflow.status !== 'applying'
      ) return state;
      if (
        action.result.status === 'failed'
        && action.result.error.code === 'operation.stalePlan'
      ) {
        return {
          ...state,
          page: {
            route: 'deploy',
            status: 'ready',
            workflow: { status: 'regenerating' },
          },
        };
      }
      return {
        ...state,
        deployResult: action.result,
        page: {
          route: 'deploy',
          status: 'ready',
          workflow: {
            status: 'result',
            result: action.result,
          },
        },
      };
    case 'restore.loaded':
      if (state.page.route !== 'restore') return state;
      return {
        ...state,
        page: {
          route: 'restore',
          status: 'ready',
          workflow: {
            status: 'review',
            plan: action.plan,
          },
        },
      };
    case 'restore.apply':
      return updateRestoreWorkflow(state, (workflow) =>
        workflow.status === 'review'
          && workflow.plan.status === 'planned'
          && workflow.plan.readyToApply
          && !workflow.plan.issues.some((issue) => issue.severity === 'error')
          ? { status: 'applying', plan: workflow.plan }
          : workflow);
    case 'restore.applied':
      if (
        state.page.route !== 'restore'
        || state.page.status !== 'ready'
        || state.page.workflow.status !== 'applying'
      ) return state;
      if (
        action.result.status === 'failed'
        && action.result.error.code === 'operation.stalePlan'
      ) {
        return {
          ...state,
          page: {
            route: 'restore',
            status: 'ready',
            workflow: { status: 'regenerating' },
          },
        };
      }
      return {
        ...state,
        restoreResult: action.result,
        page: {
          route: 'restore',
          status: 'ready',
          workflow: {
            status: 'result',
            result: action.result,
          },
        },
      };
    case 'page.failed':
      if (state.page.route !== action.route) return state;
      return {
        ...state,
        page: {
          route: action.route,
          status: 'failure',
          message: action.message,
        },
      };
    case 'navigate':
      return {
        ...state,
        ...(action.route === 'repository' && state.page.route !== 'repository'
          ? { repositoryResumeRoute: state.page.route }
          : {}),
        page: action.route === 'help'
          ? { route: 'help', status: 'ready' }
          : { route: action.route, status: 'loading' },
      };
    case 'exit':
      return { ...state, exitReason: 'completed' };
    case 'cancel':
      if (
        state.page.status === 'ready'
        && (
          state.page.route === 'capture'
          || state.page.route === 'deploy'
          || state.page.route === 'restore'
        )
        && state.page.workflow.status === 'applying'
      ) return state;
      return { ...state, exitReason: 'interrupted' };
  }
}

function updateRepositoryWorkflow(
  state: ShellState,
  update: (workflow: RepositoryWorkflowState) => RepositoryWorkflowState,
): ShellState {
  if (state.page.route !== 'repository' || state.page.status !== 'ready') {
    return state;
  }
  return {
    ...state,
    page: {
      ...state.page,
      workflow: update(state.page.workflow),
    },
  };
}

function repositoryMenuActions(
  report: RepositoryReport,
  currentDirectory: RepositoryReport,
): RepositoryMenuAction[] {
  if (report.valid) return ['continue', 'rebind', 'unbind'];
  if (
    report.issues.some((issue) => issue.code === 'repository.migrationRequired')
  ) {
    return ['migrate', 'rebind', 'unbind'];
  }
  if (
    report.issues.some((issue) =>
      issue.code === 'repository.idMismatch'
      || issue.code === 'repository.invalidManifest')
    && report.repositoryPath
  ) {
    return ['rebind', 'unbind'];
  }
  if (currentDirectory.valid) {
    return ['bind-current', 'enter-path'];
  }
  if (
    currentDirectory.issues.some((issue) =>
      issue.code === 'repository.migrationRequired')
  ) {
    return ['migrate', 'enter-path'];
  }
  return ['init-here', 'enter-path'];
}

function updateCaptureWorkflow(
  state: ShellState,
  update: (workflow: CaptureWorkflowState) => CaptureWorkflowState,
): ShellState {
  if (state.page.route !== 'capture' || state.page.status !== 'ready') return state;
  return {
    ...state,
    page: {
      ...state.page,
      workflow: update(state.page.workflow),
    },
  };
}

function updateDeployWorkflow(
  state: ShellState,
  update: (workflow: DeployWorkflowState) => DeployWorkflowState,
): ShellState {
  if (state.page.route !== 'deploy' || state.page.status !== 'ready') return state;
  return {
    ...state,
    page: {
      ...state.page,
      workflow: update(state.page.workflow),
    },
  };
}

function updateRestoreWorkflow(
  state: ShellState,
  update: (workflow: RestoreWorkflowState) => RestoreWorkflowState,
): ShellState {
  if (state.page.route !== 'restore' || state.page.status !== 'ready') {
    return state;
  }
  return {
    ...state,
    page: {
      ...state.page,
      workflow: update(state.page.workflow),
    },
  };
}

function moveCaptureCursor(
  workflow: CaptureWorkflowState,
  delta: number,
): CaptureWorkflowState {
  if (workflow.status === 'selection') {
    return {
      ...workflow,
      cursor: wrapIndex(workflow.cursor + delta, workflow.plan.changes.length),
    };
  }
  if (workflow.status === 'decision') {
    return {
      ...workflow,
      cursor: wrapIndex(
        workflow.cursor + delta,
        currentDecisionChoices(workflow).length,
      ),
    };
  }
  if (workflow.status === 'confirmation') {
    return {
      ...workflow,
      warningCursor: wrapIndex(
        workflow.warningCursor + delta,
        captureWarnings(workflow.plan).length,
      ),
    };
  }
  return workflow;
}

function toggleCaptureSelection(
  workflow: CaptureWorkflowState,
): CaptureWorkflowState {
  if (workflow.status !== 'selection') return workflow;
  const change = workflow.plan.changes[workflow.cursor];
  if (!change || change.decisionGroupId) return workflow;
  return {
    ...workflow,
    selectedIds: toggleId(workflow.selectedIds, change.id),
  };
}

function openCaptureDiff(
  workflow: CaptureWorkflowState,
): CaptureWorkflowState {
  if (workflow.status !== 'selection') return workflow;
  const change = workflow.plan.changes[workflow.cursor];
  if (!change) return workflow;
  return {
    status: 'diff',
    plan: workflow.plan,
    cursor: workflow.cursor,
    selectedIds: workflow.selectedIds,
    changeId: change.id,
  };
}

function closeCaptureDiff(
  workflow: CaptureWorkflowState,
): CaptureWorkflowState {
  if (workflow.status !== 'diff') return workflow;
  return {
    status: 'selection',
    plan: workflow.plan,
    cursor: workflow.cursor,
    selectedIds: workflow.selectedIds,
  };
}

function chooseCaptureDecision(
  workflow: CaptureWorkflowState,
): CaptureWorkflowState {
  if (workflow.status !== 'decision') return workflow;
  const choices = currentDecisionChoices(workflow);
  const choice = choices[workflow.cursor];
  if (!choice?.decisionGroupId) return workflow;
  const groupIds = new Set(choices.map((item) => item.id));
  return {
    ...workflow,
    selectedIds: [
      ...workflow.selectedIds.filter((id) => !groupIds.has(id)),
      choice.id,
    ],
  };
}

function toggleCaptureWarning(
  workflow: CaptureWorkflowState,
): CaptureWorkflowState {
  if (workflow.status !== 'confirmation') return workflow;
  const warning = captureWarnings(workflow.plan)[workflow.warningCursor];
  if (!warning) return workflow;
  return {
    ...workflow,
    confirmedIssueCodes: toggleId(
      workflow.confirmedIssueCodes,
      warning.code,
    ),
  };
}

function continueCaptureWorkflow(
  workflow: CaptureWorkflowState,
): CaptureWorkflowState {
  if (workflow.status === 'selection') {
    if (workflow.plan.issues.some((issue) => issue.severity === 'error')) {
      return workflow;
    }
    const groups = captureDecisionGroups(workflow.plan);
    if (groups.length > 0) {
      return {
        status: 'decision',
        plan: workflow.plan,
        selectedIds: workflow.selectedIds,
        groupIndex: 0,
        cursor: 0,
      };
    }
    if (hasUnresolvedDecisionIssue(workflow.plan)) return workflow;
    return createCaptureConfirmation(workflow.plan, workflow.selectedIds);
  }
  if (workflow.status === 'decision') {
    const choices = currentDecisionChoices(workflow);
    if (!choices.some((choice) => workflow.selectedIds.includes(choice.id))) {
      return workflow;
    }
    const nextGroup = workflow.groupIndex + 1;
    if (nextGroup < captureDecisionGroups(workflow.plan).length) {
      return {
        ...workflow,
        groupIndex: nextGroup,
        cursor: 0,
      };
    }
    return createCaptureConfirmation(workflow.plan, workflow.selectedIds);
  }
  return workflow;
}

function backCaptureWorkflow(
  workflow: CaptureWorkflowState,
): CaptureWorkflowState {
  if (workflow.status === 'diff') return closeCaptureDiff(workflow);
  if (workflow.status === 'decision' || workflow.status === 'confirmation') {
    return {
      status: 'selection',
      plan: workflow.plan,
      cursor: 0,
      selectedIds: workflow.selectedIds,
    };
  }
  return workflow;
}

function beginCaptureApply(
  workflow: CaptureWorkflowState,
): CaptureWorkflowState {
  if (workflow.status !== 'confirmation') return workflow;
  const warnings = captureWarnings(workflow.plan);
  const allWarningsConfirmed = warnings.every((warning) =>
    workflow.confirmedIssueCodes.includes(warning.code));
  if (!allWarningsConfirmed) return workflow;
  if (workflow.plan.issues.some((issue) => issue.severity === 'error')) {
    return workflow;
  }
  return {
    status: 'applying',
    plan: workflow.plan,
    selectedIds: workflow.selectedIds,
    confirmedIssueCodes: workflow.confirmedIssueCodes,
  };
}

function createCaptureConfirmation(
  plan: CapturePlan,
  selectedIds: string[],
): CaptureConfirmationState {
  return {
    status: 'confirmation',
    plan,
    selectedIds,
    confirmedIssueCodes: [],
    warningCursor: 0,
  };
}

export function captureDecisionGroups(plan: CapturePlan): CaptureChange[][] {
  const groups = new Map<string, CaptureChange[]>();
  for (const change of plan.changes) {
    if (!change.decisionGroupId) continue;
    groups.set(
      change.decisionGroupId,
      [...(groups.get(change.decisionGroupId) ?? []), change],
    );
  }
  return [...groups.values()];
}

export function captureWarnings(plan: CapturePlan) {
  return plan.issues.filter((issue) => issue.severity === 'warning');
}

function currentDecisionChoices(
  workflow: CaptureDecisionState,
): CaptureChange[] {
  return captureDecisionGroups(workflow.plan)[workflow.groupIndex] ?? [];
}

function hasUnresolvedDecisionIssue(plan: CapturePlan): boolean {
  return plan.issues.some((issue) => issue.severity === 'decisionRequired')
    && captureDecisionGroups(plan).length === 0;
}

function toggleId(ids: string[], id: string): string[] {
  return ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id];
}

function wrapIndex(index: number, length: number): number {
  if (length === 0) return 0;
  return ((index % length) + length) % length;
}

function initialDeploySelection(
  plan: DeployPlan,
  lastSelection?: LastDeploySelection,
): string[] {
  return plan.changes
    .filter((change) => {
      if (change.group === 'advanced' || change.change === 'delete') return false;
      if (!lastSelection) return change.defaultSelected;
      return lastSelection[change.ide]?.includes(change.capability) === true;
    })
    .map((change) => change.id);
}

export function deployVisibleChanges(
  workflow: Pick<DeploySelectionState, 'plan' | 'advancedExpanded'>,
): DeployChange[] {
  return workflow.plan.changes.filter(
    (change) => change.group === 'standard' || workflow.advancedExpanded,
  );
}

export function deployWarnings(plan: DeployPlan) {
  return plan.issues.filter((issue) => issue.severity === 'warning');
}

function moveDeployCursor(
  workflow: DeployWorkflowState,
  delta: number,
): DeployWorkflowState {
  if (workflow.status === 'selection') {
    return {
      ...workflow,
      cursor: wrapIndex(
        workflow.cursor + delta,
        deployVisibleChanges(workflow).length,
      ),
    };
  }
  if (workflow.status === 'confirmation') {
    return {
      ...workflow,
      warningCursor: wrapIndex(
        workflow.warningCursor + delta,
        deployWarnings(workflow.plan).length,
      ),
    };
  }
  return workflow;
}

function toggleDeploySelection(
  workflow: DeployWorkflowState,
): DeployWorkflowState {
  if (workflow.status !== 'selection') return workflow;
  const change = deployVisibleChanges(workflow)[workflow.cursor];
  if (!change) return workflow;
  return {
    ...workflow,
    selectedIds: toggleId(workflow.selectedIds, change.id),
  };
}

function toggleDeployAdvanced(
  workflow: DeployWorkflowState,
): DeployWorkflowState {
  if (workflow.status !== 'selection') return workflow;
  return {
    ...workflow,
    cursor: 0,
    advancedExpanded: !workflow.advancedExpanded,
  };
}

function openDeployDiff(
  workflow: DeployWorkflowState,
): DeployWorkflowState {
  if (workflow.status !== 'selection') return workflow;
  const change = deployVisibleChanges(workflow)[workflow.cursor];
  if (!change) return workflow;
  return {
    status: 'diff',
    plan: workflow.plan,
    cursor: workflow.cursor,
    selectedIds: workflow.selectedIds,
    advancedExpanded: workflow.advancedExpanded,
    changeId: change.id,
  };
}

function closeDeployDiff(
  workflow: DeployWorkflowState,
): DeployWorkflowState {
  if (workflow.status !== 'diff') return workflow;
  return {
    status: 'selection',
    plan: workflow.plan,
    cursor: workflow.cursor,
    selectedIds: workflow.selectedIds,
    advancedExpanded: workflow.advancedExpanded,
  };
}

function toggleDeployWarning(
  workflow: DeployWorkflowState,
): DeployWorkflowState {
  if (workflow.status !== 'confirmation') return workflow;
  const warning = deployWarnings(workflow.plan)[workflow.warningCursor];
  if (!warning) return workflow;
  return {
    ...workflow,
    confirmedIssueCodes: toggleId(
      workflow.confirmedIssueCodes,
      warning.code,
    ),
  };
}

function continueDeployWorkflow(
  workflow: DeployWorkflowState,
): DeployWorkflowState {
  if (workflow.status !== 'selection') return workflow;
  if (workflow.plan.issues.some((issue) =>
    issue.severity === 'decisionRequired' || issue.severity === 'error')) {
    return workflow;
  }
  return {
    status: 'confirmation',
    plan: workflow.plan,
    selectedIds: workflow.selectedIds,
    confirmedIssueCodes: [],
    warningCursor: 0,
    advancedExpanded: workflow.advancedExpanded,
  };
}

function backDeployWorkflow(
  workflow: DeployWorkflowState,
): DeployWorkflowState {
  if (workflow.status === 'diff') return closeDeployDiff(workflow);
  if (workflow.status !== 'confirmation') return workflow;
  return {
    status: 'selection',
    plan: workflow.plan,
    cursor: 0,
    selectedIds: workflow.selectedIds,
    advancedExpanded: workflow.advancedExpanded,
  };
}

function beginDeployApply(
  workflow: DeployWorkflowState,
): DeployWorkflowState {
  if (workflow.status !== 'confirmation') return workflow;
  if (workflow.plan.issues.some((issue) =>
    issue.severity === 'decisionRequired' || issue.severity === 'error')) {
    return workflow;
  }
  if (!deployWarnings(workflow.plan).every((warning) =>
    workflow.confirmedIssueCodes.includes(warning.code))) {
    return workflow;
  }
  return {
    status: 'applying',
    plan: workflow.plan,
    selectedIds: workflow.selectedIds,
    confirmedIssueCodes: workflow.confirmedIssueCodes,
  };
}
