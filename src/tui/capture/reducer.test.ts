import { describe, expect, it } from 'vitest';
import type { CapturePlan } from '../../operations/capture.js';
import {
  captureTuiCanApply,
  captureTuiReducer,
  createCaptureTuiState,
} from './reducer.js';

describe('Capture TUI reducer', () => {
  it('requires decisions and warnings before final Apply', () => {
    let state = createCaptureTuiState(plan());
    state = captureTuiReducer(state, { type: 'continue' });
    expect(state.status).toBe('decisions');
    state = captureTuiReducer(state, { type: 'toggle' });
    state = captureTuiReducer(state, { type: 'continue' });
    expect(state.status).toBe('warnings');
    state = captureTuiReducer(state, { type: 'toggle' });
    state = captureTuiReducer(state, { type: 'continue' });
    expect(state.status).toBe('final');
    expect(captureTuiCanApply(state)).toBe(true);
    state = captureTuiReducer(state, { type: 'apply' });
    expect(state.status).toBe('applying');
  });

  it('regenerates stale Plans without retaining authorization', () => {
    let state = createCaptureTuiState(plan());
    state = captureTuiReducer(state, { type: 'continue' });
    state = captureTuiReducer(state, { type: 'toggle' });
    state = captureTuiReducer(state, { type: 'continue' });
    state = captureTuiReducer(state, { type: 'toggle' });
    state = captureTuiReducer(state, { type: 'continue' });
    state = captureTuiReducer(state, { type: 'apply' });
    state = captureTuiReducer(state, { type: 'regenerating' });
    state = captureTuiReducer(state, { type: 'regenerated', plan: plan('operation-2') });
    expect(state.status).toBe('changes');
    expect(state.draft.confirmedIssueIds).toEqual([]);
    expect(state.draft.selectedChangeIds).toEqual(['add']);
    expect(state.notice).toContain('stale');
  });
});

function plan(operationId = 'operation-1'): CapturePlan {
  return {
    schemaVersion: 3,
    operation: 'capture',
    status: 'planned',
    readyToApply: false,
    operationId,
    repositoryPath: '/repo',
    preconditions: {},
    changes: [
      {
        id: 'add', ide: 'shared', surface: 'shared', itemType: 'file', capability: 'native',
        name: 'rules', change: 'add', defaultSelected: true,
        repositoryPaths: ['common/AGENTS.md'], previews: [],
      },
      {
        id: 'choice', ide: 'shared', surface: 'shared', itemType: 'mcp', capability: 'mcp',
        name: 'github', change: 'conflict', defaultSelected: false,
        repositoryPaths: ['common/mcp.yaml#github'], previews: [],
        decisionGroupId: 'decision-1', decision: 'candidate', sourceLabel: 'codex / config.toml',
      },
      {
        id: 'skip', ide: 'shared', surface: 'shared', itemType: 'mcp', capability: 'mcp',
        name: 'github (skip)', change: 'conflict', defaultSelected: false,
        repositoryPaths: ['common/mcp.yaml#github'], previews: [],
        decisionGroupId: 'decision-1', decision: 'skip', sourceLabel: 'Skip this item',
      },
    ],
    issues: [
      { severity: 'decisionRequired', code: 'capture.conflict', decisionId: 'decision-1', message: 'Choose.' },
      { severity: 'warning', code: 'capture.warning', confirmationId: 'warning-1', message: 'Review.' },
    ],
    nextActions: [],
    summary: { parameterizedPathCount: 0, excludedFileCount: 0 },
  };
}
