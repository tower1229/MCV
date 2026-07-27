import { describe, expect, it } from 'vitest';
import type { StatusReport } from '../operations/status.js';
import {
  createInitialShellState,
  shellReducer,
} from './shell-state.js';

describe('TUI Shell reducer', () => {
  it('moves Overview from loading to ready when its Report arrives', () => {
    const initial = createInitialShellState('overview');

    expect(initial.page).toEqual({
      route: 'overview',
      status: 'loading',
    });

    const report = statusReport();
    const ready = shellReducer(initial, {
      type: 'overview.loaded',
      report,
    });

    expect(ready.page).toEqual({
      route: 'overview',
      status: 'ready',
      report,
    });
  });

  it('keeps the current route when a stale Report arrives after navigation', () => {
    const environmentLoading = shellReducer(
      createInitialShellState('overview'),
      { type: 'navigate', route: 'environment' },
    );

    const afterStaleOverview = shellReducer(environmentLoading, {
      type: 'overview.loaded',
      report: statusReport(),
    });

    expect(afterStaleOverview.page).toEqual({
      route: 'environment',
      status: 'loading',
    });
  });

  it('shows an explicit failure without leaving the current page', () => {
    const failed = shellReducer(createInitialShellState('environment'), {
      type: 'page.failed',
      route: 'environment',
      message: 'Environment probe failed.',
    });

    expect(failed.page).toEqual({
      route: 'environment',
      status: 'failure',
      message: 'Environment probe failed.',
    });
  });

  it('records Ctrl+C as interruption instead of normal completion', () => {
    const cancelled = shellReducer(createInitialShellState('overview'), {
      type: 'cancel',
    });

    expect(cancelled.exitReason).toBe('interrupted');
  });
});

function statusReport(): StatusReport {
  return {
    schemaVersion: 1,
    operation: 'status',
    status: 'reported',
    ready: true,
    repositoryPath: '/tmp/mcv',
    repository: {
      path: '/tmp/mcv',
      id: 'repository-id',
      schemaVersion: 2,
    },
    changes: [],
    pendingDeployment: {
      add: 0,
      modify: 0,
      delete: 0,
      total: 0,
    },
    postDeployLocalState: {
      unchanged: 0,
      drift: 0,
      missing: 0,
      total: 0,
      files: [],
    },
    environment: {
      missingVariables: [],
      ideSupport: [],
    },
    lastOperation: null,
    issues: [],
    nextActions: [],
  };
}
