import {
  render,
  useApp,
  useInput,
  type Instance,
} from 'ink';
import { useEffect, useReducer } from 'react';
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
import { ShellView } from './shell-view.js';

export interface ShellDependencies {
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
      confirmedIssueCodes?: string[];
    },
  ) => Promise<CaptureResult>;
  recordCaptureSuccess?: (context: DeviceContext) => void;
  createDeployPlan?: (context: DeviceContext) => Promise<DeployPlan>;
  applyDeployPlan?: (
    context: DeviceContext,
    plan: DeployPlan,
    selection: {
      changeIds: string[];
      confirmedIssueCodes?: string[];
    },
  ) => Promise<DeployResult>;
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

export interface ShellOutcome {
  reason: 'completed' | 'interrupted';
  route: ShellRoute;
  summary?: string;
  failureMessage?: string;
  operationStatus?: 'succeeded' | 'blocked' | 'failed';
}

export interface ShellRuntime {
  render?: typeof render;
  restoreAfterRenderFailure?: (wasRaw: boolean) => void;
}

export async function runTuiShell(
  context: DeviceContext,
  initialRoute: ShellRoute,
  dependencies: ShellDependencies = {},
  runtime: ShellRuntime = {},
): Promise<ShellOutcome> {
  let instance: Instance | undefined;
  const wasRaw = Boolean(process.stdin.isRaw);

  try {
    instance = (runtime.render ?? render)(
      <Shell
        context={context}
        initialRoute={initialRoute}
        dependencies={dependencies}
      />,
      {
        alternateScreen: true,
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
    instance?.unmount();
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

  useEffect(() => {
    if (state.page.status !== 'loading') return;

    const route = state.page.route;
    const inspect = dependencies.inspectRepository ?? inspectRepository;
    if (route === 'repository') {
      dispatch({
        type: 'repository.loaded',
        report: inspect(context),
        currentDirectory: inspect(context, process.cwd()),
        resumeRoute: state.repositoryResumeRoute,
      });
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
        confirmedIssueCodes: workflow.confirmedIssueCodes,
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
        confirmedIssueCodes: workflow.confirmedIssueCodes,
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
    if (
      captureWorkflow?.status === 'applying'
      || deployWorkflow?.status === 'applying'
      || repositoryWorkflow?.status === 'applying'
    ) return;
    if (key.ctrl && input === 'c') {
      dispatch({ type: 'cancel' });
      return;
    }
    if (repositoryWorkflow) {
      if (repositoryWorkflow.status === 'path') {
        if (key.escape) {
          dispatch({ type: 'repository.back' });
        } else if (key.return) {
          const plan = (
            dependencies.createBindPlan ?? createBindPlan
          )(context, repositoryWorkflow.value);
          dispatch({ type: 'repository.plan', operation: 'bind', plan });
        } else if (key.backspace || key.delete) {
          dispatch({
            type: 'repository.path',
            value: repositoryWorkflow.value.slice(0, -1),
          });
        } else if (input && !key.ctrl && !key.meta) {
          dispatch({
            type: 'repository.path',
            value: `${repositoryWorkflow.value}${input}`,
          });
        }
        return;
      }
      if (input === 'q') {
        dispatch({ type: 'exit' });
        return;
      }
      if (repositoryWorkflow.status === 'menu') {
        if (key.upArrow) {
          dispatch({ type: 'repository.move', delta: -1 });
        } else if (key.downArrow) {
          dispatch({ type: 'repository.move', delta: 1 });
        } else if (key.return) {
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
        if (key.escape) dispatch({ type: 'repository.back' });
        else if (
          key.return
          && repositoryWorkflow.step.plan.status === 'planned'
        ) {
          dispatch({ type: 'repository.apply' });
        }
        return;
      }
      if (repositoryWorkflow.status === 'result' && key.return) {
        dispatch({ type: 'repository.back' });
      }
      return;
    }
    if (input === 'q') {
      dispatch({ type: 'exit' });
      return;
    }
    if (
      state.page.route === 'overview'
      && input === 'e'
    ) {
      dispatch({ type: 'navigate', route: 'environment' });
      return;
    }
    if (state.page.route === 'overview' && input === 'r') {
      dispatch({ type: 'navigate', route: 'repository' });
      return;
    }
    if (state.page.route === 'overview' && input === 'd') {
      dispatch({ type: 'navigate', route: 'deploy' });
      return;
    }
    if (
      state.page.route === 'overview'
      && (input === 'c' || key.return)
    ) {
      dispatch({ type: 'navigate', route: 'capture' });
      return;
    }
    if (state.page.route === 'environment' && key.escape) {
      dispatch({ type: 'navigate', route: 'overview' });
      return;
    }
    if (
      state.page.route === 'environment'
      && state.page.status === 'ready'
      && state.postInitOnboarding
      && key.return
    ) {
      dispatch({ type: 'onboarding.continue' });
      return;
    }
    if (state.page.route === 'deploy' && state.page.status === 'ready') {
      if (deployWorkflow?.status === 'result' && key.return) {
        dispatch({ type: 'navigate', route: 'overview' });
        return;
      }
      if (key.upArrow) {
        dispatch({ type: 'deploy.move', delta: -1 });
        return;
      }
      if (key.downArrow) {
        dispatch({ type: 'deploy.move', delta: 1 });
        return;
      }
      if (deployWorkflow?.status === 'selection') {
        if (input === ' ') dispatch({ type: 'deploy.toggleSelection' });
        else if (input === 'a') dispatch({ type: 'deploy.toggleAdvanced' });
        else if (input === 'd') dispatch({ type: 'deploy.openDiff' });
        else if (key.return) dispatch({ type: 'deploy.continue' });
        else if (key.escape) dispatch({ type: 'navigate', route: 'overview' });
        return;
      }
      if (deployWorkflow?.status === 'diff' && key.escape) {
        dispatch({ type: 'deploy.closeDiff' });
        return;
      }
      if (deployWorkflow?.status === 'confirmation') {
        if (input === ' ') dispatch({ type: 'deploy.toggleWarning' });
        else if (key.return) dispatch({ type: 'deploy.apply' });
        else if (key.escape) dispatch({ type: 'deploy.back' });
      }
      return;
    }
    if (state.page.route !== 'capture' || state.page.status !== 'ready') return;
    if (captureWorkflow?.status === 'result' && key.return) {
      dispatch({ type: 'navigate', route: 'overview' });
      return;
    }
    if (key.upArrow) {
      dispatch({ type: 'capture.move', delta: -1 });
      return;
    }
    if (key.downArrow) {
      dispatch({ type: 'capture.move', delta: 1 });
      return;
    }
    if (captureWorkflow?.status === 'selection') {
      if (input === ' ') dispatch({ type: 'capture.toggleSelection' });
      else if (input === 'd') dispatch({ type: 'capture.openDiff' });
      else if (key.return) dispatch({ type: 'capture.continue' });
      else if (key.escape) dispatch({ type: 'navigate', route: 'overview' });
      return;
    }
    if (captureWorkflow?.status === 'diff' && key.escape) {
      dispatch({ type: 'capture.closeDiff' });
      return;
    }
    if (captureWorkflow?.status === 'decision') {
      if (input === ' ') dispatch({ type: 'capture.chooseDecision' });
      else if (key.return) dispatch({ type: 'capture.continue' });
      else if (key.escape) dispatch({ type: 'capture.back' });
      return;
    }
    if (captureWorkflow?.status === 'confirmation') {
      if (input === ' ') dispatch({ type: 'capture.toggleWarning' });
      else if (key.return) dispatch({ type: 'capture.apply' });
      else if (key.escape) dispatch({ type: 'capture.back' });
    }
  });

  useEffect(() => {
    if (!state.exitReason) return;
    exit(createOutcome(state, initialRoute));
  }, [exit, initialRoute, state]);

  return <ShellView state={state} />;
}

function createOutcome(
  state: ShellState,
  initialRoute: ShellRoute,
): ShellOutcome {
  const failureMessage = state.page.status === 'failure'
    ? state.page.message
    : state.deployResult?.status === 'failed'
      ? state.deployResult.error.message
    : state.captureResult?.status === 'failed'
      ? state.captureResult.error.message
      : undefined;
  const summary = summarizeDirectRoute(state, initialRoute);
  return {
    reason: state.exitReason ?? 'completed',
    route: state.page.route,
    ...(summary ? { summary } : {}),
    ...(failureMessage ? { failureMessage } : {}),
    ...(state.deployResult || state.captureResult
      ? {
        operationStatus:
          state.deployResult?.status ?? state.captureResult?.status,
      }
      : {}),
  };
}

function summarizeDirectRoute(
  state: ShellState,
  initialRoute: ShellRoute,
): string | undefined {
  if (initialRoute === 'overview') {
    const report = state.reports.overview;
    if (!report) return undefined;
    return `Overview: ${report.pendingDeployment.total} pending deployment changes; ${report.postDeployLocalState.drift} local managed changes; ${report.environment.missingVariables.length} missing variables.`;
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
  if (initialRoute === 'repository') return undefined;
  const result = state.captureResult;
  if (!result) return 'Capture closed without applying changes.';
  if (result.status === 'succeeded') {
    return `Captured ${result.data?.appliedChangeIds.length ?? 0} selected item(s) into ${result.repositoryPath}.`;
  }
  return result.status === 'blocked'
    ? 'Capture was blocked; Repository was not changed.'
    : `Capture failed: ${result.error.message}`;
}

function loadRoute(
  context: DeviceContext,
  route: ShellRoute,
  dependencies: ShellDependencies,
): Promise<StatusReport | EnvironmentReport | CapturePlan | DeployPlan> {
  if (route === 'overview') {
    return (dependencies.inspectOverview ?? inspectStatus)(context);
  }
  if (route === 'environment') {
    return (dependencies.inspectEnvironment ?? inspectEnvironment)(context);
  }
  if (route === 'deploy') {
    return (dependencies.createDeployPlan ?? createDeployPlan)(context);
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
