import { renderToString } from 'ink';
import { describe, expect, it } from 'vitest';
import type { CapturePlan } from '../../operations/capture.js';
import { captureTuiReducer, createCaptureTuiState } from './reducer.js';
import { CaptureTuiView } from './view.js';

describe('Capture TUI view', () => {
  it('keeps selection and destructive state visible in a narrow terminal', () => {
    const output = renderToString(
      <CaptureTuiView
        state={createCaptureTuiState(plan())}
        columns={52}
        rows={14}
        reviewPath="/tmp/capture-review.txt"
      />,
      { columns: 52 },
    );

    expect(output).toContain('MCV Capture Review');
    expect(output).toContain('[x] shared / file · add · rules');
    expect(output).toContain('× Destructive');
    expect(output).toContain('Review: /tmp/capture-review.txt');
  });

  it('shows decision source labels and warning details without relying on color', () => {
    let state = createCaptureTuiState(plan());
    state = captureTuiReducer(state, { type: 'continue' });
    const decision = renderToString(
      <CaptureTuiView state={state} columns={80} rows={18} />,
      { columns: 80 },
    );
    expect(decision).toContain('codex / config.toml');

    state = captureTuiReducer(state, { type: 'toggle' });
    state = captureTuiReducer(state, { type: 'continue' });
    const warning = renderToString(
      <CaptureTuiView state={state} columns={80} rows={18} />,
      { columns: 80 },
    );
    expect(warning).toContain('Warnings · explicit confirmation required');
    expect(warning).toContain('Skipped /home/user/config.json');
  });
});

function plan(): CapturePlan {
  return {
    schemaVersion: 4,
    operation: 'capture',
    status: 'planned',
    readyToApply: false,
    operationId: 'operation-1',
    repositoryPath: '/repo',
    preconditions: {},
    changes: [
      {
        id: 'add', ide: 'shared', surface: 'shared', itemType: 'file', capability: 'native',
        name: 'rules', change: 'add', defaultSelected: true,
        repositoryPaths: ['ide/codex/instructions.md'], previews: [],
      },
      {
        id: 'delete', ide: 'shared', surface: 'shared', itemType: 'file', capability: 'native',
        name: 'old.json', change: 'delete', defaultSelected: false,
        repositoryPaths: ['ide/shared/old.json'], previews: [],
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
      {
        severity: 'warning', code: 'capture.warning', confirmationId: 'warning-1',
        message: 'A source was skipped.', details: 'Skipped /home/user/config.json: invalid JSON.',
      },
    ],
    nextActions: [],
    summary: { parameterizedPathCount: 0, excludedFileCount: 0 },
  };
}
