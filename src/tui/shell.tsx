import {
  render,
  useApp,
  useInput,
  useWindowSize,
  type Instance,
} from 'ink';
import { useEffect, useReducer, useRef } from 'react';
import type { DeviceContext } from '../adapters/types.js';
import {
  applyCapturePlan,
  createCapturePlan,
  type CapturePlan,
  type CaptureResult,
} from '../operations/capture.js';
import {
  inspectEnvironment,
  type EnvironmentReport,
} from '../operations/environment.js';
import {
  inspectStatus,
  type StatusReport,
} from '../operations/status.js';
import {
  applyDeployPlan,
  createDeployPlan,
  type DeployPlan,
  type DeployResult,
} from '../operations/deploy.js';
import {
  applyRestorePlan,
  createRestorePlan,
  type RestorePlan,
  type RestoreResult,
} from '../operations/restore.js';
import {
  applyBindPlan,
  applyInitPlan,
  applyMigrationPlan,
  applyUnbindPlan,
  createBindPlan,
  createInitPlan,
  createMigrationPlan,
  createUnbindPlan,
  inspectRepository,
  type BindPlan,
  type BindResult,
  type InitPlan,
  type InitResult,
  type MigrationPlan,
  type MigrationResult,
  type RepositoryReport,
  type UnbindPlan,
  type UnbindResult,
} from '../operations/repository.js';
import { readState, recordCaptureSuccess } from '../utils/state.js';
import {
  createInitialShellState,
  shellReducer,
  type RepositoryWorkflowState,
  type ShellRoute,
  type ShellState,
} from './shell-state.js';
import {
  maximumPageScrollOffset,
  ShellView,
} from './shell-view.js';
import { normalizeShellInteraction } from './interaction-intent.js';
import { primaryDestinationIdForAccelerator } from './overview-navigation.js';
import { preserveTerminalInputMode } from './terminal-input-mode.js';

export interface ShellDependencies {
  repositoryEntry?: RepositoryEntry;
  inspectRepository?: (
    context: DeviceContext,
    explicitPath?: string,
  ) => RepositoryReport;
  inspectOverview?: (context: DeviceContext) => Promise<StatusReport>;
  inspectEnvironment?: (context: DeviceContext) => Promise<EnvironmentReport>;
  createCapturePlan?: (context: DeviceContext) => Promise<CapturePlan>;
  applyCapturePlan?: (
    context: DeviceContext,
    plan: CapturePlan,
    selection: {
      changeIds: string[];
      confirmedIssueIds?: string[];
    },
  ) => Promise<CaptureResult>;
  recordCaptureSuccess?: (context: DeviceContext) => void;
  createDeployPlan?: (context: DeviceContext) => Promise<DeployPlan>;
  applyDeployPlan?: (
    context: DeviceContext,
    plan: DeployPlan,
    selection: {
      changeIds: string[];
      confirmedIssueIds?: string[];
    },
  ) => Promise<DeployResult>;
  createRestorePlan?: (context: DeviceContext) => RestorePlan;
  applyRestorePlan?: (
    context: DeviceContext,
    plan: RestorePlan,
    selection: { changeIds: string[] },
  ) => RestoreResult | Promise<RestoreResult>;
  createBindPlan?: (context: DeviceContext, path?: string) => BindPlan;
  applyBindPlan?: (context: DeviceContext, plan: BindPlan) => BindResult;
  createInitPlan?: (context: DeviceContext, path?: string) => InitPlan;
  applyInitPlan?: (context: DeviceContext, plan: InitPlan) => InitResult;
  createMigrationPlan?: (
    context: DeviceContext,
    path?: string,
  ) => MigrationPlan;
  applyMigrationPlan?: (
    context: DeviceContext,
    plan: MigrationPlan,
  ) => MigrationResult;
  createUnbindPlan?: (context: DeviceContext) => UnbindPlan;
  applyUnbindPlan?: (
    context: DeviceContext,
    plan: UnbindPlan,
  ) => UnbindResult;
}

export type RepositoryEntry =
  | { operation: 'init'; path: string }
  | { operation: 'bind'; path: string }
  | { operation: 'unbind' }
  | { operation: 'migrate'; path: string };

export interface ShellOutcome {
  reason: 'completed' | 'interrupted';
  route: ShellRoute;
  summary?: string;
  failureMessage?: string;
  nextAction?: string;
  operationStatus?: 'succeeded' | 'blocked' | 'failed';
}

export interface ShellRuntime {
  render?: typeof render;
  restoreAfterRenderFailure?: (wasRaw: boolean) => void;
  preserveTerminalInputMode?: (
    platform: NodeJS.Platform,
  ) => () => void;
}

export async function runTuiShell(
  context: DeviceContext,
  initialRoute: ShellRoute,
  dependencies: ShellDependencies = {},
  runtime: ShellRuntime = {},
): Promise<ShellOutcome> {
  let instance: Instance | undefined;
  const wasRaw = Boolean(process.stdin.isRaw);
  const restoreInputMode = (
    runtime.preserveTerminalInputMode ?? preserveTerminalInputMode
  )(context.platform);

  try {
    instance = (runtime.render ?? render)(
      <Shell
        context={context}
        initialRoute={initialRoute}
        dependencies={dependencies}
      />,
      {
        alternateScreen: true,
        interactive: true,
        exitOnCtrlC: false,
        patchConsole: false,
      },
    );
    return await instance.waitUntilExit() as ShellOutcome;
  } catch (error) {
    if (!instance) {
      (runtime.restoreAfterRenderFailure ?? restoreAfterRenderFailure)(wasRaw);
    }
    throw error;
  } finally {
    try {
      instance?.unmount();
    } finally {
      restoreInputMode();
    }
  }
}

interface ShellProps {
  context: DeviceContext;
  initialRoute: ShellRoute;
  dependencies: ShellDependencies;
}

function Shell({ context, initialRoute, dependencies }: ShellProps) {
  const [state, dispatch] = useReducer(
    shellReducer,
    initialRoute,
    createInitialShellState,
  );
  const { exit } = useApp();
  const windowSize = useWindowSize();
  const repositoryEntry = useRef(dependencies.repositoryEntry);

  useEffect(() => {
    if (state.page.status !== 'loading') return;

    const route = state.page.route;
    const inspect = dependencies.inspectRepository ?? inspectRepository;
    if (route === 'repository') {
      const report = inspect(context);
      const currentDirectory = inspect(context, process.cwd());
      dispatch({
        type: 'repository.loaded',
        report,
        currentDirectory,
        resumeRoute: state.repositoryResumeRoute,
      });
      const entry = repositoryEntry.current;
      repositoryEntry.current = undefined;
      if (entry) {
        dispatch(createRepositoryEntryAction(
          context,
          entry,
          dependencies,
        ));
      }
      return;
    }
    if (route !== 'environment') {
      const report = inspect(context);
      if (!report.valid) {
        dispatch({
          type: 'repository.loaded',
          report,
          currentDirectory: inspect(context, process.cwd()),
          resumeRoute: route,
        });
        return;
      }
    }
    let active = true;
    const load = loadRoute(context, route, dependencies);

    void load.then(
      (report) => {
        if (!active) return;
        if (report.operation === 'status') {
          dispatch({ type: 'overview.loaded', report });
        } else if (report.operation === 'discover') {
          dispatch({ type: 'environment.loaded', report });
        } else if (report.operation === 'capture') {
          dispatch({ type: 'capture.loaded', plan: report });
        } else if (report.operation === 'restore') {
          dispatch({ type: 'restore.loaded', plan: report });
        } else {
          dispatch({
            type: 'deploy.loaded',
            plan: report,
            lastSelection: readState(context).lastDeploySelection,
          });
        }
      },
      (error: unknown) => {
        if (!active) return;
        dispatch({
          type: 'page.failed',
          route,
          message: error instanceof Error ? error.message : String(error),
        });
      },
    );

    return () => {
      active = false;
    };
  }, [context, dependencies, state.page]);

  useEffect(() => {
    if (
      state.page.route !== 'deploy'
      || state.page.status !== 'ready'
      || state.page.workflow.status !== 'regenerating'
    ) return;

    let active = true;
    void (dependencies.createDeployPlan ?? createDeployPlan)(context).then(
      (plan) => {
        if (active) {
          dispatch({
            type: 'deploy.loaded',
            plan,
            lastSelection: readState(context).lastDeploySelection,
          });
        }
      },
      (error: unknown) => {
        if (!active) return;
        dispatch({
          type: 'page.failed',
          route: 'deploy',
          message: error instanceof Error ? error.message : String(error),
        });
      },
    );
    return () => {
      active = false;
    };
  }, [context, dependencies, state.page]);

  useEffect(() => {
    if (
      state.page.route !== 'restore'
      || state.page.status !== 'ready'
      || state.page.workflow.status !== 'regenerating'
    ) return;

    try {
      dispatch({
        type: 'restore.loaded',
        plan: (dependencies.createRestorePlan ?? createRestorePlan)(context),
      });
    } catch (error) {
      dispatch({
        type: 'page.failed',
        route: 'restore',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }, [context, dependencies, state.page]);

  useEffect(() => {
    if (
      state.page.route !== 'deploy'
      || state.page.status !== 'ready'
      || state.page.workflow.status !== 'applying'
    ) return;

    const workflow = state.page.workflow;
    let active = true;
    void (dependencies.applyDeployPlan ?? applyDeployPlan)(
      context,
      workflow.plan,
      {
        changeIds: workflow.selectedIds,
        confirmedIssueIds: workflow.confirmedIssueIds,
        decisions: workflow.decisions,
      },
    ).then(
      (result) => {
        if (active) dispatch({ type: 'deploy.applied', result });
      },
      (error: unknown) => {
        if (!active) return;
        dispatch({
          type: 'page.failed',
          route: 'deploy',
          message: error instanceof Error ? error.message : String(error),
        });
      },
    );
    return () => {
      active = false;
    };
  }, [context, dependencies, state.page]);

  useEffect(() => {
    if (
      state.page.route !== 'restore'
      || state.page.status !== 'ready'
      || state.page.workflow.status !== 'applying'
    ) return;

    const workflow = state.page.workflow;
    let active = true;
    void Promise.resolve((dependencies.applyRestorePlan ?? applyRestorePlan)(
      context,
      workflow.plan,
      { changeIds: workflow.plan.changes.map((change) => change.id) },
    )).then(
      (result) => {
        if (active) dispatch({ type: 'restore.applied', result });
      },
      (error: unknown) => {
        if (!active) return;
        dispatch({
          type: 'page.failed',
          route: 'restore',
          message: error instanceof Error ? error.message : String(error),
        });
      },
    );
    return () => {
      active = false;
    };
  }, [context, dependencies, state.page]);

  useEffect(() => {
    if (
      state.page.route !== 'repository'
      || state.page.status !== 'ready'
      || state.page.workflow.status !== 'applying'
    ) return;

    const workflow = state.page.workflow;
    try {
      const step = applyRepositoryWorkflow(
        context,
        workflow,
        dependencies,
      );
      dispatch({
        type: 'repository.applied',
        ...step,
      });
    } catch (error) {
      dispatch({
        type: 'page.failed',
        route: 'repository',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }, [context, dependencies, state.page]);

  useEffect(() => {
    if (
      state.page.route !== 'capture'
      || state.page.status !== 'ready'
      || state.page.workflow.status !== 'regenerating'
    ) return;

    let active = true;
    void (dependencies.createCapturePlan ?? createCapturePlan)(context).then(
      (plan) => {
        if (active) dispatch({ type: 'capture.loaded', plan });
      },
      (error: unknown) => {
        if (!active) return;
        dispatch({
          type: 'page.failed',
          route: 'capture',
          message: error instanceof Error ? error.message : String(error),
        });
      },
    );
    return () => {
      active = false;
    };
  }, [context, dependencies, state.page]);

  useEffect(() => {
    if (
      state.page.route !== 'capture'
      || state.page.status !== 'ready'
      || state.page.workflow.status !== 'applying'
    ) return;

    const workflow = state.page.workflow;
    let active = true;
    void (dependencies.applyCapturePlan ?? applyCapturePlan)(
      context,
      workflow.plan,
      {
        changeIds: workflow.selectedIds,
        confirmedIssueIds: workflow.confirmedIssueIds,
      },
    ).then(
      (result) => {
        if (!active) return;
        let finalResult = result;
        if (result.status === 'succeeded') {
          try {
            (dependencies.recordCaptureSuccess ?? recordCaptureSuccess)(context);
          } catch {
            finalResult = {
              ...result,
              issues: [
                ...result.issues,
                {
                  severity: 'warning',
                  code: 'capture.stateRecordFailed',
                  confirmationId: 'capture-warning-state-record-failed',
                  message: 'Capture succeeded, but local operation history could not be updated.',
                },
              ],
              nextActions: [
                'Check local MCV state permissions before the next operation.',
              ],
            };
          }
        }
        dispatch({ type: 'capture.applied', result: finalResult });
      },
      (error: unknown) => {
        if (!active) return;
        dispatch({
          type: 'page.failed',
          route: 'capture',
          message: error instanceof Error ? error.message : String(error),
        });
      },
    );
    return () => {
      active = false;
    };
  }, [context, dependencies, state.page]);

  useInput((input, key) => {
    const intent = normalizeShellInteraction(input, key);
    const captureWorkflow = state.page.route === 'capture'
      && state.page.status === 'ready'
      ? state.page.workflow
      : undefined;
    const repositoryWorkflow = state.page.route === 'repository'
      && state.page.status === 'ready'
      ? state.page.workflow
      : undefined;
    const deployWorkflow = state.page.route === 'deploy'
      && state.page.status === 'ready'
      ? state.page.workflow
      : undefined;
    const restoreWorkflow = state.page.route === 'restore'
      && state.page.status === 'ready'
      ? state.page.workflow
      : undefined;
    const scrollPage = (delta: number): void => {
      dispatch({
        type: 'page.scroll',
        delta,
        maximum: maximumPageScrollOffset(
          state,
          windowSize.rows,
          windowSize.columns,
        ),
      });
    };
    const handleResultInteraction = (): void => {
      if (intent.type === 'confirm' || intent.type === 'back') {
        dispatch({ type: 'navigate', route: 'overview' });
      } else if (intent.type === 'focus.previous') {
        scrollPage(-1);
      } else if (intent.type === 'focus.next') {
        scrollPage(1);
      }
    };
    if (
      captureWorkflow?.status === 'applying'
      || deployWorkflow?.status === 'applying'
      || restoreWorkflow?.status === 'applying'
      || repositoryWorkflow?.status === 'applying'
    ) return;
    if (intent.type === 'interrupt') {
      dispatch({ type: 'cancel' });
      return;
    }
    if (repositoryWorkflow) {
      if (repositoryWorkflow.status === 'path') {
        if (intent.type === 'cancel' || intent.type === 'back') {
          dispatch({ type: 'repository.back' });
        } else if (intent.type === 'confirm') {
          const plan = (
            dependencies.createBindPlan ?? createBindPlan
          )(context, repositoryWorkflow.value);
          dispatch({ type: 'repository.plan', operation: 'bind', plan });
        } else if (intent.type === 'delete.backward') {
          dispatch({
            type: 'repository.path',
            value: repositoryWorkflow.value.slice(0, -1),
          });
        } else if (intent.type === 'text') {
          dispatch({
            type: 'repository.path',
            value: `${repositoryWorkflow.value}${intent.value}`,
          });
        } else if (intent.type === 'quit' || intent.type === 'toggle') {
          dispatch({
            type: 'repository.path',
            value: `${repositoryWorkflow.value}${
              intent.type === 'quit' ? 'q' : ' '
            }`,
          });
        }
        return;
      }
      if (intent.type === 'quit') {
        dispatch({ type: 'exit' });
        return;
      }
      if (repositoryWorkflow.status === 'menu') {
        if (intent.type === 'focus.previous') {
          dispatch({ type: 'repository.move', delta: -1 });
        } else if (intent.type === 'focus.next') {
          dispatch({ type: 'repository.move', delta: 1 });
        } else if (intent.type === 'back' || intent.type === 'cancel') {
          dispatch({ type: 'repository.back' });
        } else if (intent.type === 'confirm' || intent.type === 'open') {
          chooseRepositoryAction(
            context,
            repositoryWorkflow,
            dependencies,
            dispatch,
          );
        }
        return;
      }
      if (repositoryWorkflow.status === 'plan') {
        if (intent.type === 'cancel' || intent.type === 'back') {
          dispatch({ type: 'repository.back' });
        }
        else if (
          intent.type === 'confirm'
          && repositoryWorkflow.step.plan.status === 'planned'
        ) {
          dispatch({ type: 'repository.apply' });
        }
        return;
      }
      if (repositoryWorkflow.status === 'result') {
        if (intent.type === 'cancel') {
          dispatch({ type: 'repository.back' });
        } else {
          handleResultInteraction();
        }
      }
      return;
    }
    if (intent.type === 'quit') {
      dispatch({ type: 'exit' });
      return;
    }
    if (state.page.route === 'overview') {
      if (intent.type === 'focus.previous') {
        dispatch({ type: 'overview.move', delta: -1 });
        return;
      }
      if (intent.type === 'focus.next') {
        dispatch({ type: 'overview.move', delta: 1 });
        return;
      }
      if (intent.type === 'open' || intent.type === 'confirm') {
        dispatch({ type: 'overview.open' });
        return;
      }
      if (intent.type === 'text') {
        const route = primaryDestinationIdForAccelerator(intent.value);
        if (route) dispatch({ type: 'navigate', route });
      }
      return;
    }
    if (state.page.route === 'environment' || state.page.route === 'help') {
      if (intent.type === 'cancel' || intent.type === 'back') {
        dispatch({ type: 'navigate', route: 'overview' });
        return;
      }
      if (intent.type === 'focus.previous') {
        scrollPage(-1);
        return;
      }
      if (intent.type === 'focus.next') {
        scrollPage(1);
        return;
      }
    }
    if (
      state.page.route === 'environment'
      && state.page.status === 'ready'
      && state.postInitOnboarding
      && intent.type === 'confirm'
    ) {
      dispatch({ type: 'onboarding.continue' });
      return;
    }
    if (state.page.route === 'deploy' && state.page.status === 'ready') {
      if (deployWorkflow?.status === 'result') {
        handleResultInteraction();
        return;
      }
      if (intent.type === 'focus.previous') {
        dispatch({ type: 'deploy.move', delta: -1 });
        return;
      }
      if (intent.type === 'focus.next') {
        dispatch({ type: 'deploy.move', delta: 1 });
        return;
      }
      if (intent.type === 'page.previous') {
        dispatch({
          type: 'deploy.move',
          delta: -Math.max(1, windowSize.rows - 12),
        });
        return;
      }
      if (intent.type === 'page.next') {
        dispatch({
          type: 'deploy.move',
          delta: Math.max(1, windowSize.rows - 12),
        });
        return;
      }
      if (intent.type === 'focus.first') {
        dispatch({ type: 'deploy.focus', position: 'first' });
        return;
      }
      if (intent.type === 'focus.last') {
        dispatch({ type: 'deploy.focus', position: 'last' });
        return;
      }
      if (deployWorkflow?.status === 'selection') {
        if (intent.type === 'open') dispatch({ type: 'deploy.open' });
        else if (intent.type === 'back') dispatch({ type: 'deploy.back' });
        else if (intent.type === 'toggle') {
          dispatch({ type: 'deploy.toggleSelection' });
        }
        else if (intent.type === 'text' && intent.value === 'a') {
          dispatch({ type: 'deploy.toggleAdvanced' });
        }
        else if (intent.type === 'text' && intent.value === 'd') {
          dispatch({ type: 'deploy.openDiff' });
        }
        else if (intent.type === 'confirm') dispatch({ type: 'deploy.continue' });
        else if (intent.type === 'cancel') {
          dispatch({ type: 'navigate', route: 'overview' });
        }
        return;
      }
      if (
        deployWorkflow?.status === 'diff'
        && (intent.type === 'back' || intent.type === 'cancel')
      ) {
        dispatch({ type: 'deploy.back' });
        return;
      }
      if (deployWorkflow?.status === 'decision') {
        if (intent.type === 'toggle' || intent.type === 'open') {
          dispatch({ type: 'deploy.chooseDecision' });
        }
        else if (intent.type === 'confirm') dispatch({ type: 'deploy.continue' });
        else if (intent.type === 'back' || intent.type === 'cancel') {
          dispatch({ type: 'deploy.back' });
        }
        return;
      }
      if (deployWorkflow?.status === 'confirmation') {
        if (intent.type === 'toggle') dispatch({ type: 'deploy.toggleWarning' });
        else if (intent.type === 'confirm') dispatch({ type: 'deploy.apply' });
        else if (intent.type === 'back' || intent.type === 'cancel') {
          dispatch({ type: 'deploy.back' });
        }
      }
      return;
    }
    if (state.page.route === 'restore' && state.page.status === 'ready') {
      if (restoreWorkflow?.status === 'result') {
        handleResultInteraction();
        return;
      }
      if (restoreWorkflow?.status === 'review') {
        if (intent.type === 'confirm') dispatch({ type: 'restore.apply' });
        else if (intent.type === 'focus.previous') {
          dispatch({ type: 'restore.move', delta: -1 });
        } else if (intent.type === 'focus.next') {
          dispatch({ type: 'restore.move', delta: 1 });
        } else if (intent.type === 'open') {
          dispatch({ type: 'restore.openDetail' });
        } else if (intent.type === 'back' || intent.type === 'cancel') {
          dispatch({ type: 'restore.back' });
        }
      }
      return;
    }
    if (state.page.route !== 'capture' || state.page.status !== 'ready') return;
    if (captureWorkflow?.status === 'result') {
      handleResultInteraction();
      return;
    }
    if (intent.type === 'focus.previous') {
      dispatch({ type: 'capture.move', delta: -1 });
      return;
    }
    if (intent.type === 'focus.next') {
      dispatch({ type: 'capture.move', delta: 1 });
      return;
    }
    if (intent.type === 'page.previous') {
      dispatch({
        type: 'capture.page',
        delta: -Math.max(1, windowSize.rows - 10),
      });
      return;
    }
    if (intent.type === 'page.next') {
      dispatch({
        type: 'capture.page',
        delta: Math.max(1, windowSize.rows - 10),
      });
      return;
    }
    if (intent.type === 'focus.first') {
      dispatch({ type: 'capture.focus', position: 'first' });
      return;
    }
    if (intent.type === 'focus.last') {
      dispatch({ type: 'capture.focus', position: 'last' });
      return;
    }
    if (captureWorkflow?.status === 'selection') {
      if (intent.type === 'toggle') dispatch({ type: 'capture.toggleSelection' });
      else if (intent.type === 'open') dispatch({ type: 'capture.open' });
      else if (intent.type === 'text' && intent.value === 'd') {
        dispatch({ type: 'capture.openDiff' });
      }
      else if (intent.type === 'confirm') dispatch({ type: 'capture.continue' });
      else if (intent.type === 'back' || intent.type === 'cancel') {
        dispatch({ type: 'capture.back' });
      }
      return;
    }
    if (
      captureWorkflow?.status === 'diff'
      && (intent.type === 'back' || intent.type === 'cancel')
    ) {
      dispatch({ type: 'capture.back' });
      return;
    }
    if (captureWorkflow?.status === 'decision') {
      if (intent.type === 'toggle') dispatch({ type: 'capture.chooseDecision' });
      else if (intent.type === 'open') dispatch({ type: 'capture.open' });
      else if (intent.type === 'confirm') dispatch({ type: 'capture.continue' });
      else if (intent.type === 'back' || intent.type === 'cancel') {
        dispatch({ type: 'capture.back' });
      }
      return;
    }
    if (captureWorkflow?.status === 'confirmation') {
      if (intent.type === 'toggle') dispatch({ type: 'capture.toggleWarning' });
      else if (intent.type === 'confirm') dispatch({ type: 'capture.apply' });
      else if (intent.type === 'back' || intent.type === 'cancel') {
        dispatch({ type: 'capture.back' });
      }
    }
  });

  useEffect(() => {
    if (!state.exitReason) return;
    exit(createOutcome(state, initialRoute));
  }, [exit, initialRoute, state]);

  return (
    <ShellView
      state={state}
      terminalColumns={windowSize.columns}
      terminalRows={windowSize.rows}
    />
  );
}

function createRepositoryEntryAction(
  context: DeviceContext,
  entry: RepositoryEntry,
  dependencies: ShellDependencies,
): Parameters<typeof shellReducer>[1] {
  switch (entry.operation) {
    case 'init':
      return {
        type: 'repository.plan',
        operation: 'init',
        plan: (dependencies.createInitPlan ?? createInitPlan)(
          context,
          entry.path,
        ),
      };
    case 'bind':
      return {
        type: 'repository.plan',
        operation: 'bind',
        plan: (dependencies.createBindPlan ?? createBindPlan)(
          context,
          entry.path,
        ),
      };
    case 'migrate':
      return {
        type: 'repository.plan',
        operation: 'migrate',
        plan: (dependencies.createMigrationPlan ?? createMigrationPlan)(
          context,
          entry.path,
        ),
      };
    case 'unbind':
      return {
        type: 'repository.plan',
        operation: 'unbind',
        plan: (dependencies.createUnbindPlan ?? createUnbindPlan)(context),
      };
  }
}

function createOutcome(
  state: ShellState,
  initialRoute: ShellRoute,
): ShellOutcome {
  const repositoryPlan = state.page.route === 'repository'
    && state.page.status === 'ready'
    && state.page.workflow.status === 'plan'
    ? state.page.workflow.step.plan
    : undefined;
  const failureMessage = state.page.status === 'failure'
    ? state.page.message
    : repositoryPlan?.status === 'failed'
      ? repositoryPlan.error.message
    : state.repositoryResult?.result.status === 'failed'
      ? state.repositoryResult.result.error.message
    : state.restoreResult?.status === 'failed'
      ? state.restoreResult.error.message
      : state.deployResult?.status === 'failed'
      ? state.deployResult.error.message
    : state.captureResult?.status === 'failed'
      ? state.captureResult.error.message
      : undefined;
  const summary = summarizeDirectRoute(state, initialRoute);
  const nextAction = directRouteNextAction(state, initialRoute);
  return {
    reason: state.exitReason ?? 'completed',
    route: state.page.route,
    ...(summary ? { summary } : {}),
    ...(failureMessage ? { failureMessage } : {}),
    ...(nextAction ? { nextAction } : {}),
    ...(repositoryPlan?.status === 'failed'
      ? { operationStatus: 'failed' as const }
      : state.repositoryResult
      || state.restoreResult
      || state.deployResult
      || state.captureResult
      ? {
        operationStatus:
          state.repositoryResult?.result.status
          ?? state.restoreResult?.status
          ?? state.deployResult?.status
          ?? state.captureResult?.status,
      }
      : {}),
  };
}

function summarizeDirectRoute(
  state: ShellState,
  initialRoute: ShellRoute,
): string | undefined {
  if (initialRoute === 'repository') {
    const step = state.repositoryResult;
    if (step) {
      const label = step.operation.charAt(0).toUpperCase()
        + step.operation.slice(1);
      return step.result.status === 'succeeded'
        ? `${label} succeeded for ${step.result.repositoryPath ?? 'the local Repository binding'}.`
        : `${label} ${step.result.status}.`;
    }
    if (
      state.page.route === 'repository'
      && state.page.status === 'ready'
      && state.page.workflow.status === 'menu'
    ) {
      const report = state.page.workflow.report.repositoryPath
        ? state.page.workflow.report
        : state.page.workflow.currentDirectory;
      return `Repository: ${report.repositoryPath ?? 'not bound'}; schema ${report.repositorySchemaVersion ?? 'unknown'}; ID ${report.repositoryId ?? 'unknown'}.`;
    }
    return 'Repository closed without changes.';
  }
  if (initialRoute === 'overview') {
    const report = state.reports.overview;
    if (!report) return undefined;
    return `Overview: ${report.pendingDeployment.total} pending deployment changes; ${report.postDeployLocalState.contentDrift} content Drift, ${report.postDeployLocalState.topologyDrift} topology Drift; ${report.environment.missingVariables.length} missing variables.`;
  }
  if (initialRoute === 'environment') {
    const report = state.reports.environment;
    if (!report) return undefined;
    const detected = report.environments.filter((environment) => environment.detected).length;
    return `Environment: ${detected}/${report.environments.length} IDEs detected; ${report.missingVariables.length} missing variables.`;
  }
  if (initialRoute === 'deploy') {
    const result = state.deployResult;
    if (!result) return 'Deploy closed without applying changes.';
    if (result.status === 'succeeded') {
      return `Deployed ${result.data?.appliedChangeIds.length ?? 0} selected item(s) from ${result.repositoryPath}.`;
    }
    return result.status === 'blocked'
      ? 'Deploy was blocked; device configuration was not changed.'
      : `Deploy failed: ${result.error.message}`;
  }
  if (initialRoute === 'restore') {
    const result = state.restoreResult;
    if (!result) return 'Restore closed without applying changes.';
    if (result.status === 'succeeded') {
      return `Restored ${result.data?.restoredPaths.length ?? 0} path(s) and deleted ${result.data?.deletedPaths.length ?? 0} path(s).`;
    }
    return result.status === 'blocked'
      ? 'Restore was blocked; device configuration was not changed.'
      : `Restore failed: ${result.error.message}`;
  }
  const result = state.captureResult;
  if (!result) return 'Capture closed without applying changes.';
  if (result.status === 'succeeded') {
    return `Captured ${result.data?.appliedChangeIds.length ?? 0} selected item(s) into ${result.repositoryPath}.`;
  }
  return result.status === 'blocked'
    ? 'Capture was blocked; Repository was not changed.'
    : `Capture failed: ${result.error.message}`;
}

function directRouteNextAction(
  state: ShellState,
  initialRoute: ShellRoute,
): string | undefined {
  const repositoryResult = state.repositoryResult?.result;
  const repositoryPlan = state.page.route === 'repository'
    && state.page.status === 'ready'
    && state.page.workflow.status === 'plan'
    ? state.page.workflow.step.plan
    : undefined;
  const result = repositoryResult
    ?? state.restoreResult
    ?? state.deployResult
    ?? state.captureResult;
  const explicit = result?.nextActions[0];
  if (explicit) return explicit;
  if (repositoryPlan?.nextActions[0]) return repositoryPlan.nextActions[0];
  if (initialRoute === 'repository') {
    switch (state.repositoryResult?.operation) {
      case 'init': return 'Review detected IDEs, then Capture the configuration you want to keep.';
      case 'bind': return 'Review Overview before Capture, Deploy, or Restore.';
      case 'migrate': return 'Review Overview before the next write operation.';
      case 'unbind': return 'Bind or initialize a Repository before the next write operation.';
      default: return 'Return to Overview and choose the next workflow.';
    }
  }
  if (initialRoute === 'overview') return 'Choose Capture, Deploy, Restore Latest Deployment, Repository, or Help.';
  if (initialRoute === 'environment') return 'Return to Overview to choose the next workflow.';
  return 'Return to Overview to review the refreshed device state.';
}

function loadRoute(
  context: DeviceContext,
  route: ShellRoute,
  dependencies: ShellDependencies,
): Promise<
  StatusReport
  | EnvironmentReport
  | CapturePlan
  | DeployPlan
  | RestorePlan
> {
  if (route === 'overview') {
    return (dependencies.inspectOverview ?? inspectStatus)(context);
  }
  if (route === 'environment') {
    return (dependencies.inspectEnvironment ?? inspectEnvironment)(context);
  }
  if (route === 'deploy') {
    return (dependencies.createDeployPlan ?? createDeployPlan)(context);
  }
  if (route === 'restore') {
    return Promise.resolve(
      (dependencies.createRestorePlan ?? createRestorePlan)(context),
    );
  }
  return (dependencies.createCapturePlan ?? createCapturePlan)(context);
}

function chooseRepositoryAction(
  context: DeviceContext,
  workflow: Extract<RepositoryWorkflowState, { status: 'menu' }>,
  dependencies: ShellDependencies,
  dispatch: (action: Parameters<typeof shellReducer>[1]) => void,
): void {
  const action = workflow.actions[workflow.cursor];
  if (!action) return;
  if (action === 'continue') {
    dispatch({ type: 'navigate', route: workflow.resumeRoute });
    return;
  }
  if (action === 'enter-path' || action === 'rebind') {
    dispatch({ type: 'repository.enterPath' });
    return;
  }
  if (action === 'bind-current') {
    const plan = (dependencies.createBindPlan ?? createBindPlan)(
      context,
      workflow.currentDirectory.repositoryPath ?? process.cwd(),
    );
    dispatch({ type: 'repository.plan', operation: 'bind', plan });
    return;
  }
  if (action === 'init-here') {
    const plan = (dependencies.createInitPlan ?? createInitPlan)(
      context,
      process.cwd(),
    );
    dispatch({ type: 'repository.plan', operation: 'init', plan });
    return;
  }
  if (action === 'migrate') {
    const reportNeedsMigration = workflow.report.issues.some(
      (issue) => issue.code === 'repository.migrationRequired',
    );
    const target = reportNeedsMigration
      ? workflow.report.repositoryPath
      : workflow.currentDirectory.repositoryPath;
    const plan = (
      dependencies.createMigrationPlan ?? createMigrationPlan
    )(context, target ?? process.cwd());
    dispatch({ type: 'repository.plan', operation: 'migrate', plan });
    return;
  }
  const plan = (dependencies.createUnbindPlan ?? createUnbindPlan)(context);
  dispatch({ type: 'repository.plan', operation: 'unbind', plan });
}

function applyRepositoryWorkflow(
  context: DeviceContext,
  workflow: Extract<RepositoryWorkflowState, { status: 'applying' }>,
  dependencies: ShellDependencies,
):
  | { operation: 'bind'; result: BindResult }
  | { operation: 'init'; result: InitResult }
  | { operation: 'migrate'; result: MigrationResult }
  | { operation: 'unbind'; result: UnbindResult } {
  switch (workflow.step.operation) {
    case 'bind':
      return {
        operation: 'bind',
        result: (dependencies.applyBindPlan ?? applyBindPlan)(
          context,
          workflow.step.plan,
        ),
      };
    case 'init':
      return {
        operation: 'init',
        result: (dependencies.applyInitPlan ?? applyInitPlan)(
          context,
          workflow.step.plan,
        ),
      };
    case 'migrate':
      return {
        operation: 'migrate',
        result: (dependencies.applyMigrationPlan ?? applyMigrationPlan)(
          context,
          workflow.step.plan,
        ),
      };
    case 'unbind':
      return {
        operation: 'unbind',
        result: (dependencies.applyUnbindPlan ?? applyUnbindPlan)(
          context,
          workflow.step.plan,
        ),
      };
  }
}

function restoreAfterRenderFailure(wasRaw: boolean): void {
  if (
    typeof process.stdin.setRawMode === 'function'
    && Boolean(process.stdin.isRaw) !== wasRaw
  ) {
    process.stdin.setRawMode(wasRaw);
  }
  process.stdout.write('\u001b[?25h\u001b[?1049l');
}
