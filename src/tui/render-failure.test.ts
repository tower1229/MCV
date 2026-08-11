import { describe, expect, it, vi } from 'vitest';
import type { DeviceContext } from '../adapters/types.js';
import type { CapturePlan } from '../operations/capture.js';
import { createCaptureReviewAttempt, runCaptureReviewTui } from './capture/app.js';
import { runProfileEditor } from './profile/app.js';

const context: DeviceContext = { homeDir: '/tmp/mcv-tui-failure', platform: 'win32', env: {} };
const capturePlan: CapturePlan = {
  schemaVersion: 3,
  operation: 'capture',
  status: 'planned',
  readyToApply: true,
  operationId: 'render-failure',
  preconditions: {},
  repositoryPath: '/repository',
  changes: [],
  issues: [],
  nextActions: [],
  summary: { parameterizedPathCount: 0, excludedFileCount: 0 },
};

describe('TUI render-failure restoration', () => {
  it('restores Capture input and terminal state when Ink throws before creating an instance', async () => {
    const restoreTerminal = vi.fn();
    const restoreInput = vi.fn();
    await expect(runCaptureReviewTui(context, capturePlan, {}, {
      render: () => { throw new Error('capture render failed'); },
      restoreAfterRenderFailure: restoreTerminal,
      preserveTerminalInputMode: () => restoreInput,
    })).rejects.toThrow('capture render failed');
    expect(restoreTerminal).toHaveBeenCalledOnce();
    expect(restoreInput).toHaveBeenCalledOnce();
  });

  it('restores Profile input and terminal state when Ink throws before creating an instance', async () => {
    const restoreTerminal = vi.fn();
    const restoreInput = vi.fn();
    await expect(runProfileEditor(context, {}, {}, {
      render: () => { throw new Error('profile render failed'); },
      restoreAfterRenderFailure: restoreTerminal,
      preserveTerminalInputMode: () => restoreInput,
    })).rejects.toThrow('profile render failed');
    expect(restoreTerminal).toHaveBeenCalledOnce();
    expect(restoreInput).toHaveBeenCalledOnce();
  });

  it('returns an escaped full-details fallback when the Capture Review cannot be written', () => {
    const plan = {
      ...capturePlan,
      changes: [{
        id: 'control', ide: 'shared' as const, surface: 'codex', itemType: 'file' as const,
        capability: 'rules' as const, name: 'control', change: 'add' as const,
        defaultSelected: true, repositoryPaths: ['common/AGENTS.md'],
        previews: [{ repositoryPath: 'common/AGENTS.md', kind: 'text' as const, bytes: 3, sha256: 'abc', diff: '+ a\u001b' }],
      }],
    };
    const attempt = createCaptureReviewAttempt(context, plan, () => { throw new Error('forbidden control'); });
    expect(attempt.path).toBeUndefined();
    expect(attempt.failure).toMatchObject({ message: 'forbidden control' });
    expect(attempt.failure?.fallback).toContain('\\u{1B}');
  });
});
