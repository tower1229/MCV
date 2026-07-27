import {
  render,
  useApp,
  useInput,
  type Instance,
} from 'ink';
import { useEffect, useReducer } from 'react';
import type { DeviceContext } from '../adapters/types.js';
import {
  inspectEnvironment,
  type EnvironmentReport,
} from '../operations/environment.js';
import {
  inspectStatus,
  type StatusReport,
} from '../operations/status.js';
import {
  createInitialShellState,
  shellReducer,
  type ShellRoute,
  type ShellState,
} from './shell-state.js';
import { ShellView } from './shell-view.js';

export interface ShellDependencies {
  inspectOverview?: (context: DeviceContext) => Promise<StatusReport>;
  inspectEnvironment?: (context: DeviceContext) => Promise<EnvironmentReport>;
}

export interface ShellOutcome {
  reason: 'completed' | 'interrupted';
  route: ShellRoute;
  summary?: string;
  failureMessage?: string;
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
    let active = true;
    const load = route === 'overview'
      ? (dependencies.inspectOverview ?? inspectStatus)(context)
      : (dependencies.inspectEnvironment ?? inspectEnvironment)(context);

    void load.then(
      (report) => {
        if (!active) return;
        if (report.operation === 'status') {
          dispatch({ type: 'overview.loaded', report });
        } else {
          dispatch({ type: 'environment.loaded', report });
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

  useInput((input, key) => {
    if (key.ctrl && input === 'c') {
      dispatch({ type: 'cancel' });
      return;
    }
    if (input === 'q') {
      dispatch({ type: 'exit' });
      return;
    }
    if (
      state.page.route === 'overview'
      && (input === 'e' || key.return)
    ) {
      dispatch({ type: 'navigate', route: 'environment' });
      return;
    }
    if (state.page.route === 'environment' && key.escape) {
      dispatch({ type: 'navigate', route: 'overview' });
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
    : undefined;
  const summary = summarizeDirectRoute(state, initialRoute);
  return {
    reason: state.exitReason ?? 'completed',
    route: state.page.route,
    ...(summary ? { summary } : {}),
    ...(failureMessage ? { failureMessage } : {}),
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
  const report = state.reports.environment;
  if (!report) return undefined;
  const detected = report.environments.filter((environment) => environment.detected).length;
  return `Environment: ${detected}/${report.environments.length} IDEs detected; ${report.missingVariables.length} missing variables.`;
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
