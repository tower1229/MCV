import { describe, expect, it } from 'vitest';
import type { CapturePlan, CaptureResult } from '../operations/capture.js';
import type { DeployPlan, DeployResult } from '../operations/deploy.js';
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
import {
  createInitialShellState,
  shellReducer,
} from './shell-state.js';

describe('TUI Shell reducer', () => {
  it('offers Bind current repository first when an unbound device starts in a Repository', () => {
    const loaded = shellReducer(createInitialShellState('overview'), {
      type: 'repository.loaded',
      report: repositoryReport({
        repositoryPath: null,
        repositoryId: null,
        repositorySchemaVersion: null,
        valid: false,
        issueCode: 'repository.notBound',
      }),
      currentDirectory: repositoryReport({
        repositoryPath: '/tmp/mcv',
        repositoryId: 'repository-id',
        repositorySchemaVersion: 2,
        valid: true,
      }),
      resumeRoute: 'overview',
    });

    expect(loaded.page).toMatchObject({
      route: 'repository',
      status: 'ready',
      workflow: {
        status: 'menu',
        cursor: 0,
        actions: ['bind-current', 'enter-path'],
      },
    });
  });

  it('offers Init here and Enter existing path outside a Repository', () => {
    const loaded = shellReducer(createInitialShellState('overview'), {
      type: 'repository.loaded',
      report: repositoryReport({
        repositoryPath: null,
        repositoryId: null,
        repositorySchemaVersion: null,
        valid: false,
        issueCode: 'repository.notBound',
      }),
      currentDirectory: repositoryReport({
        repositoryPath: '/tmp/empty',
        repositoryId: null,
        repositorySchemaVersion: null,
        valid: false,
        issueCode: 'repository.invalidManifest',
      }),
      resumeRoute: 'overview',
    });

    expect(loaded.page).toMatchObject({
      route: 'repository',
      status: 'ready',
      workflow: {
        status: 'menu',
        actions: ['init-here', 'enter-path'],
      },
    });
  });

  it('continues a successful Init through Environment discovery into Capture', () => {
    const repository = shellReducer(createInitialShellState('overview'), {
      type: 'repository.loaded',
      report: repositoryReport({
        repositoryPath: null,
        repositoryId: null,
        repositorySchemaVersion: null,
        valid: false,
        issueCode: 'repository.notBound',
      }),
      currentDirectory: repositoryReport({
        repositoryPath: '/tmp/empty',
        repositoryId: null,
        repositorySchemaVersion: null,
        valid: false,
        issueCode: 'repository.invalidManifest',
      }),
      resumeRoute: 'overview',
    });
    const planned = shellReducer(repository, {
      type: 'repository.plan',
      operation: 'init',
      plan: initPlan(),
    });
    const applying = shellReducer(planned, { type: 'repository.apply' });
    const environment = shellReducer(applying, {
      type: 'repository.applied',
      operation: 'init',
      result: initResult(),
    });

    expect(environment).toMatchObject({
      page: { route: 'environment', status: 'loading' },
      postInitOnboarding: true,
    });

    const environmentReady = shellReducer(environment, {
      type: 'environment.loaded',
      report: {
        schemaVersion: 1,
        operation: 'discover',
        status: 'reported',
        ready: true,
        repositoryPath: '/tmp/empty',
        changes: [],
        environments: [],
        missingVariables: [],
        issues: [],
        nextActions: [],
      },
    });
    const capture = shellReducer(environmentReady, {
      type: 'onboarding.continue',
    });

    expect(capture).toMatchObject({
      page: { route: 'capture', status: 'loading' },
      postInitOnboarding: false,
    });
  });

  it('blocks an ID-mismatched binding behind Rebind or Unbind recovery', () => {
    const loaded = shellReducer(createInitialShellState('capture'), {
      type: 'repository.loaded',
      report: repositoryReport({
        repositoryPath: '/tmp/wrong-repository',
        repositoryId: 'different-id',
        repositorySchemaVersion: 2,
        valid: false,
        issueCode: 'repository.idMismatch',
      }),
      currentDirectory: repositoryReport({
        repositoryPath: '/tmp/not-a-repository',
        repositoryId: null,
        repositorySchemaVersion: null,
        valid: false,
        issueCode: 'repository.invalidManifest',
      }),
      resumeRoute: 'capture',
    });

    expect(loaded.page).toMatchObject({
      route: 'repository',
      status: 'ready',
      workflow: {
        actions: ['rebind', 'unbind'],
        resumeRoute: 'capture',
      },
    });
  });

  it('returns a successful Rebind to the blocked deep link', () => {
    const repository = repositoryManagementState('capture');
    const path = shellReducer(repository, { type: 'repository.enterPath' });
    const typed = shellReducer(path, {
      type: 'repository.path',
      value: '/tmp/moved-repository',
    });
    const planned = shellReducer(typed, {
      type: 'repository.plan',
      operation: 'bind',
      plan: bindPlan(),
    });
    const applying = shellReducer(planned, { type: 'repository.apply' });
    const resumed = shellReducer(applying, {
      type: 'repository.applied',
      operation: 'bind',
      result: bindResult(),
    });

    expect(typed.page).toMatchObject({
      workflow: { status: 'path', value: '/tmp/moved-repository' },
    });
    expect(resumed.page).toEqual({ route: 'capture', status: 'loading' });
  });

  it.each([
    {
      operation: 'migrate' as const,
      plan: migrationPlan(),
      result: migrationResult(),
    },
    {
      operation: 'unbind' as const,
      plan: unbindPlan(),
      result: unbindResult(),
    },
  ])('refreshes Repository after successful $operation without losing the Deploy deep link', ({
    operation,
    plan,
    result,
  }) => {
    const repository = repositoryManagementState('deploy');
    const planned = shellReducer(repository, {
      type: 'repository.plan',
      operation,
      plan,
    } as Parameters<typeof shellReducer>[1]);
    const applying = shellReducer(planned, { type: 'repository.apply' });
    const refreshing = shellReducer(applying, {
      type: 'repository.applied',
      operation,
      result,
    } as Parameters<typeof shellReducer>[1]);

    expect(refreshing).toMatchObject({
      page: { route: 'repository', status: 'loading' },
      repositoryResumeRoute: 'deploy',
    });

    const reloaded = shellReducer(refreshing, {
      type: 'repository.loaded',
      report: repositoryReport({
        repositoryPath: '/tmp/repository',
        repositoryId: 'repository-id',
        repositorySchemaVersion: 2,
        valid: true,
      }),
      currentDirectory: repositoryReport({
        repositoryPath: '/tmp/repository',
        repositoryId: 'repository-id',
        repositorySchemaVersion: 2,
        valid: true,
      }),
      resumeRoute: refreshing.repositoryResumeRoute,
    });
    expect(reloaded.page).toMatchObject({
      workflow: { resumeRoute: 'deploy' },
    });
  });

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

  it('loads Deploy with the last successful IDE/capability selection and hides cleanup', () => {
    const ready = shellReducer(createInitialShellState('deploy'), {
      type: 'deploy.loaded',
      plan: deployPlan(),
      lastSelection: { codex: ['rules'] },
    });

    expect(ready.page).toMatchObject({
      route: 'deploy',
      status: 'ready',
      workflow: {
        status: 'selection',
        cursor: 0,
        selectedIds: ['deploy-rules'],
        advancedExpanded: false,
      },
    });
  });

  it('supports partial Deploy selection and deliberate advanced cleanup', () => {
    const loaded = shellReducer(createInitialShellState('deploy'), {
      type: 'deploy.loaded',
      plan: deployPlan(),
    });
    const partial = shellReducer(loaded, { type: 'deploy.toggleSelection' });
    expect(partial.page).toMatchObject({
      workflow: { selectedIds: ['deploy-mcp'] },
    });

    const expanded = shellReducer(partial, { type: 'deploy.toggleAdvanced' });
    const cleanupFocused = shellReducer(expanded, { type: 'deploy.move', delta: 2 });
    const cleanupSelected = shellReducer(cleanupFocused, {
      type: 'deploy.toggleSelection',
    });
    expect(cleanupSelected.page).toMatchObject({
      workflow: {
        advancedExpanded: true,
        selectedIds: ['deploy-mcp', 'deploy-delete'],
      },
    });
  });

  it('requires Deploy warnings and blocks decisionRequired or error Issues', () => {
    const loaded = shellReducer(createInitialShellState('deploy'), {
      type: 'deploy.loaded',
      plan: deployPlan(),
    });
    const confirmation = shellReducer(loaded, { type: 'deploy.continue' });
    expectDeployStatus(confirmation, 'confirmation');
    expectDeployStatus(
      shellReducer(confirmation, { type: 'deploy.apply' }),
      'confirmation',
    );
    const confirmed = shellReducer(confirmation, { type: 'deploy.toggleWarning' });
    expectDeployStatus(
      shellReducer(confirmed, { type: 'deploy.apply' }),
      'applying',
    );

    const blockedPlan = deployPlan();
    blockedPlan.issues.push({
      severity: 'decisionRequired',
      code: 'deploy.choose',
      message: 'A decision is required.',
    });
    const blocked = shellReducer(createInitialShellState('deploy'), {
      type: 'deploy.loaded',
      plan: blockedPlan,
    });
    expectDeployStatus(
      shellReducer(blocked, { type: 'deploy.continue' }),
      'selection',
    );
  });

  it('regenerates stale Deploy Plans and preserves failure Results', () => {
    const loaded = shellReducer(createInitialShellState('deploy'), {
      type: 'deploy.loaded',
      plan: deployPlan(),
    });
    const confirmation = shellReducer(loaded, { type: 'deploy.continue' });
    const confirmed = shellReducer(confirmation, { type: 'deploy.toggleWarning' });
    const applying = shellReducer(confirmed, { type: 'deploy.apply' });

    expectDeployStatus(shellReducer(applying, {
      type: 'deploy.applied',
      result: deployResult('operation.stalePlan'),
    }), 'regenerating');
    expectDeployStatus(shellReducer(applying, {
      type: 'deploy.applied',
      result: deployResult('deploy.transactionFailed'),
    }), 'result');
  });

  it('ignores normal cancellation while Deploy is applying', () => {
    const loaded = shellReducer(createInitialShellState('deploy'), {
      type: 'deploy.loaded',
      plan: deployPlan({ issues: [] }),
    });
    const confirmation = shellReducer(loaded, { type: 'deploy.continue' });
    const applying = shellReducer(confirmation, { type: 'deploy.apply' });

    const cancelled = shellReducer(applying, { type: 'cancel' });

    expect(cancelled.exitReason).toBeNull();
    expectDeployStatus(cancelled, 'applying');
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

function expectDeployStatus(
  state: ReturnType<typeof createInitialShellState>,
  status: string,
): void {
  expect(state.page).toMatchObject({
    route: 'deploy',
    status: 'ready',
    workflow: { status },
  });
}

function deployPlan(
  override: Partial<DeployPlan> = {},
): DeployPlan {
  return {
    schemaVersion: 1,
    operation: 'deploy',
    status: 'planned',
    readyToApply: true,
    operationId: 'deploy-operation',
    preconditions: {},
    repositoryPath: '/tmp/mcv',
    changes: [
      {
        id: 'deploy-rules',
        ide: 'codex',
        capability: 'rules',
        name: 'Shared Rules',
        targetPath: '/tmp/.codex/AGENTS.md',
        change: 'modify',
        defaultSelected: true,
        group: 'standard',
        strategy: 'replace-entire-file',
        preview: {
          targetPath: '/tmp/.codex/AGENTS.md',
          kind: 'text',
          bytes: 20,
          sha256: 'a'.repeat(64),
          diff: '- old\n+ new',
        },
      },
      {
        id: 'deploy-mcp',
        ide: 'codex',
        capability: 'mcp',
        name: 'MCP',
        targetPath: '/tmp/.codex/config.toml',
        change: 'modify',
        defaultSelected: true,
        group: 'standard',
        strategy: 'managed-merge',
        preview: {
          targetPath: '/tmp/.codex/config.toml',
          kind: 'text',
          bytes: 30,
          sha256: 'b'.repeat(64),
          diff: '- old-mcp\n+ new-mcp',
        },
      },
      {
        id: 'deploy-delete',
        ide: 'codex',
        capability: 'skills',
        name: 'Old Skill',
        targetPath: '/tmp/.codex/skills/old/SKILL.md',
        change: 'delete',
        defaultSelected: false,
        group: 'advanced',
        strategy: 'replace-entire-file',
        preview: {
          targetPath: '/tmp/.codex/skills/old/SKILL.md',
          kind: 'binary',
          bytes: 42,
          sha256: 'c'.repeat(64),
        },
      },
    ],
    issues: [{
      severity: 'warning',
      code: 'deploy.warning',
      message: 'Review this warning.',
    }],
    nextActions: [],
    ...override,
  } as DeployPlan;
}

function deployResult(code: string): DeployResult {
  return {
    schemaVersion: 1,
    operation: 'deploy',
    status: 'failed',
    repositoryPath: '/tmp/mcv',
    changes: [],
    issues: [],
    nextActions: ['Regenerate.'],
    error: {
      code,
      message: code,
      nextActions: ['Regenerate.'],
    },
  };
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

function repositoryReport({
  repositoryPath,
  repositoryId,
  repositorySchemaVersion,
  valid,
  issueCode,
}: {
  repositoryPath: string | null;
  repositoryId: string | null;
  repositorySchemaVersion: number | null;
  valid: boolean;
  issueCode?: string;
}): RepositoryReport {
  return {
    schemaVersion: 1,
    operation: 'repository',
    status: 'reported',
    ready: valid,
    repositoryPath,
    repositoryId,
    repositorySchemaVersion,
    valid,
    changes: [],
    issues: issueCode
      ? [{ severity: 'error', code: issueCode, message: issueCode }]
      : [],
    nextActions: [],
  };
}

function initPlan(): InitPlan {
  return {
    schemaVersion: 1,
    operation: 'init',
    status: 'planned',
    readyToApply: true,
    operationId: 'init-operation',
    preconditions: {},
    repositoryPath: '/tmp/empty',
    changes: [{
      id: 'repository-manifest',
      kind: 'add',
      path: '/tmp/empty/mcv.yaml',
      repositoryPath: '/tmp/empty',
      repositoryId: 'repository-id',
      initializedAt: '2026-07-27T00:00:00.000Z',
      schemaVersion: 2,
    }],
    issues: [],
    nextActions: [],
  };
}

function initResult(): InitResult {
  return {
    schemaVersion: 1,
    operation: 'init',
    status: 'succeeded',
    repositoryPath: '/tmp/empty',
    changes: [],
    issues: [],
    nextActions: [],
    data: {
      repositoryId: 'repository-id',
      repositorySchemaVersion: 2,
    },
  };
}

function repositoryManagementState(
  resumeRoute: 'capture' | 'deploy',
): ReturnType<typeof createInitialShellState> {
  return shellReducer(createInitialShellState(resumeRoute), {
    type: 'repository.loaded',
    report: repositoryReport({
      repositoryPath: '/tmp/repository',
      repositoryId: 'repository-id',
      repositorySchemaVersion: 1,
      valid: false,
      issueCode: 'repository.migrationRequired',
    }),
    currentDirectory: repositoryReport({
      repositoryPath: '/tmp/repository',
      repositoryId: 'repository-id',
      repositorySchemaVersion: 1,
      valid: false,
      issueCode: 'repository.migrationRequired',
    }),
    resumeRoute,
  });
}

function bindPlan(): BindPlan {
  return {
    schemaVersion: 1,
    operation: 'bind',
    status: 'planned',
    readyToApply: true,
    operationId: 'bind-operation',
    preconditions: {},
    repositoryPath: '/tmp/moved-repository',
    changes: [{
      id: 'repository-binding',
      kind: 'bind',
      previousRepositoryPath: '/tmp/old-repository',
      repositoryPath: '/tmp/moved-repository',
      repositoryId: 'repository-id',
    }],
    issues: [],
    nextActions: [],
  };
}

function bindResult(): BindResult {
  return {
    schemaVersion: 1,
    operation: 'bind',
    status: 'succeeded',
    repositoryPath: '/tmp/moved-repository',
    changes: [],
    issues: [],
    nextActions: [],
    data: {
      repositoryId: 'repository-id',
      repositorySchemaVersion: 2,
      previousRepositoryPath: '/tmp/old-repository',
    },
  };
}

function migrationPlan(): MigrationPlan {
  return {
    schemaVersion: 1,
    operation: 'migrate',
    status: 'planned',
    readyToApply: true,
    operationId: 'migration-operation',
    preconditions: {},
    repositoryPath: '/tmp/repository',
    changes: [{
      id: 'schema-version',
      kind: 'modify',
      path: '/tmp/repository/mcv.yaml',
      before: 1,
      after: 2,
    }],
    issues: [],
    nextActions: [],
  };
}

function migrationResult(): MigrationResult {
  return {
    schemaVersion: 1,
    operation: 'migrate',
    status: 'succeeded',
    repositoryPath: '/tmp/repository',
    changes: [],
    issues: [],
    nextActions: [],
    data: {
      repositoryId: 'repository-id',
      previousSchemaVersion: 1,
      repositorySchemaVersion: 2,
      backupPath: '/tmp/repository-backup',
      backupVerified: true,
    },
  };
}

function unbindPlan(): UnbindPlan {
  return {
    schemaVersion: 1,
    operation: 'unbind',
    status: 'planned',
    readyToApply: true,
    operationId: 'unbind-operation',
    preconditions: {},
    repositoryPath: '/tmp/repository',
    changes: [{
      id: 'repository-binding',
      kind: 'unbind',
      previousRepositoryPath: '/tmp/repository',
      repositoryPath: null,
      repositoryId: 'repository-id',
    }],
    issues: [],
    nextActions: [],
  };
}

function unbindResult(): UnbindResult {
  return {
    schemaVersion: 1,
    operation: 'unbind',
    status: 'succeeded',
    repositoryPath: '/tmp/repository',
    changes: [],
    issues: [],
    nextActions: [],
    data: {
      repositoryId: 'repository-id',
      previousRepositoryPath: '/tmp/repository',
    },
  };
}
