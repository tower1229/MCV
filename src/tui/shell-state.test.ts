import { describe, expect, it } from 'vitest';
import type { CapturePlan, CaptureResult } from '../operations/capture.js';
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

  it('loads Capture with safe defaults and keeps deletions unselected', () => {
    const ready = shellReducer(createInitialShellState('capture'), {
      type: 'capture.loaded',
      plan: capturePlan(),
    });

    expect(ready.page).toMatchObject({
      route: 'capture',
      status: 'ready',
      workflow: {
        status: 'selection',
        cursor: 0,
        selectedIds: ['capture-file'],
      },
    });
  });

  it('moves through Diff and required decisions before confirmation', () => {
    const loaded = shellReducer(createInitialShellState('capture'), {
      type: 'capture.loaded',
      plan: capturePlan(),
    });
    const diff = shellReducer(loaded, { type: 'capture.openDiff' });
    expectCaptureStatus(diff, 'diff');

    const selection = shellReducer(diff, { type: 'capture.closeDiff' });
    const decisions = shellReducer(selection, { type: 'capture.continue' });
    expectCaptureStatus(decisions, 'decision');

    const chosen = shellReducer(decisions, { type: 'capture.chooseDecision' });
    const confirmation = shellReducer(chosen, { type: 'capture.continue' });
    expectCaptureStatus(confirmation, 'confirmation');
  });

  it('requires every warning acknowledgement before applying', () => {
    const loaded = shellReducer(createInitialShellState('capture'), {
      type: 'capture.loaded',
      plan: capturePlan(),
    });
    const decisions = shellReducer(loaded, { type: 'capture.continue' });
    const chosen = shellReducer(decisions, { type: 'capture.chooseDecision' });
    const confirmation = shellReducer(chosen, { type: 'capture.continue' });

    const blocked = shellReducer(confirmation, { type: 'capture.apply' });
    expectCaptureStatus(blocked, 'confirmation');

    const confirmed = shellReducer(confirmation, { type: 'capture.toggleWarning' });
    const applying = shellReducer(confirmed, { type: 'capture.apply' });
    expectCaptureStatus(applying, 'applying');
  });

  it('turns a stale Apply result into regeneration instead of reusing the Plan', () => {
    const loaded = shellReducer(createInitialShellState('capture'), {
      type: 'capture.loaded',
      plan: capturePlan(),
    });
    const decisions = shellReducer(loaded, { type: 'capture.continue' });
    const chosen = shellReducer(decisions, { type: 'capture.chooseDecision' });
    const confirmation = shellReducer(chosen, { type: 'capture.continue' });
    const confirmed = shellReducer(confirmation, { type: 'capture.toggleWarning' });
    const applying = shellReducer(confirmed, { type: 'capture.apply' });

    const regenerating = shellReducer(applying, {
      type: 'capture.applied',
      result: staleResult(),
    });

    expectCaptureStatus(regenerating, 'regenerating');
  });
});

function expectCaptureStatus(
  state: ReturnType<typeof createInitialShellState>,
  status: string,
): void {
  expect(state.page).toMatchObject({
    route: 'capture',
    status: 'ready',
    workflow: { status },
  });
}

function capturePlan(): CapturePlan {
  return {
    schemaVersion: 1,
    operation: 'capture',
    status: 'planned',
    readyToApply: false,
    operationId: 'capture-operation',
    preconditions: {},
    repositoryPath: '/tmp/mcv',
    changes: [
      {
        id: 'capture-file',
        ide: 'claude-code',
        surface: 'native',
        itemType: 'file',
        capability: 'native',
        name: 'settings.json',
        change: 'modify',
        defaultSelected: true,
        repositoryPaths: ['ide/claude-code/native/settings.json'],
        previews: [{
          repositoryPath: 'ide/claude-code/native/settings.json',
          kind: 'text',
          bytes: 20,
          sha256: 'a'.repeat(64),
          diff: '- light\n+ dark',
        }],
      },
      {
        id: 'capture-delete',
        ide: 'codex',
        surface: 'native',
        itemType: 'skill',
        capability: 'skills',
        name: '旧 Skill',
        change: 'delete',
        defaultSelected: false,
        repositoryPaths: ['common/skills/旧 Skill/SKILL.md'],
        previews: [{
          repositoryPath: 'common/skills/旧 Skill/SKILL.md',
          kind: 'binary',
          bytes: 42,
          sha256: 'b'.repeat(64),
        }],
      },
      {
        id: 'capture-choice',
        ide: 'shared',
        surface: 'shared',
        itemType: 'mcp',
        capability: 'mcp',
        name: 'shared',
        change: 'conflict',
        defaultSelected: false,
        repositoryPaths: ['common/mcp.yaml'],
        previews: [],
        decisionGroupId: 'mcp-shared',
        decision: 'candidate',
        sourceLabel: 'Claude Code',
      },
      {
        id: 'capture-skip',
        ide: 'shared',
        surface: 'shared',
        itemType: 'mcp',
        capability: 'mcp',
        name: 'shared',
        change: 'conflict',
        defaultSelected: false,
        repositoryPaths: ['common/mcp.yaml'],
        previews: [],
        decisionGroupId: 'mcp-shared',
        decision: 'skip',
        sourceLabel: 'Skip',
      },
    ],
    issues: [
      {
        severity: 'decisionRequired',
        code: 'capture.mcpConflict',
        message: 'Choose one MCP source.',
      },
      {
        severity: 'warning',
        code: 'capture.sourceSkipped.1.1',
        message: 'A source was skipped.',
      },
    ],
    nextActions: [],
    summary: {
      sensitiveFieldCount: 1,
      parameterizedPathCount: 0,
      excludedFileCount: 1,
    },
  };
}

function staleResult(): CaptureResult {
  return {
    schemaVersion: 1,
    operation: 'capture',
    status: 'failed',
    repositoryPath: '/tmp/mcv',
    changes: [],
    issues: [{
      severity: 'error',
      code: 'operation.stalePlan',
      message: 'Plan is stale.',
    }],
    nextActions: ['Regenerate.'],
    error: {
      code: 'operation.stalePlan',
      message: 'Plan is stale.',
      nextActions: ['Regenerate.'],
    },
  };
}

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
