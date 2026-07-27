import type { EnvironmentReport } from '../operations/environment.js';
import type { StatusReport } from '../operations/status.js';

export type ShellRoute = 'overview' | 'environment';

type LoadingPage = {
  route: ShellRoute;
  status: 'loading';
};

type ReadyPage =
  | {
    route: 'overview';
    status: 'ready';
    report: StatusReport;
  }
  | {
    route: 'environment';
    status: 'ready';
    report: EnvironmentReport;
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
  exitReason: 'completed' | 'interrupted' | null;
}

export type ShellAction =
  | { type: 'overview.loaded'; report: StatusReport }
  | { type: 'environment.loaded'; report: EnvironmentReport }
  | { type: 'page.failed'; route: ShellRoute; message: string }
  | { type: 'navigate'; route: ShellRoute }
  | { type: 'exit' }
  | { type: 'cancel' };

export function createInitialShellState(route: ShellRoute): ShellState {
  return {
    page: { route, status: 'loading' },
    reports: {},
    exitReason: null,
  };
}

export function shellReducer(state: ShellState, action: ShellAction): ShellState {
  switch (action.type) {
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
        page: {
          route: action.route,
          status: 'loading',
        },
      };
    case 'exit':
      return { ...state, exitReason: 'completed' };
    case 'cancel':
      return { ...state, exitReason: 'interrupted' };
  }
}
