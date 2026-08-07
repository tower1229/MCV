import { describe, expect, it } from 'vitest';
import type { CapturePlan, CaptureResult } from '../operations/capture.js';
import type { DeployPlan, DeployResult } from '../operations/deploy.js';
import type { RestorePlan, RestoreResult } from '../operations/restore.js';
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
      repositoryResult: {
        operation: 'init',
        result: { status: 'succeeded' },
      },
    });

    const environmentReady = shellReducer(environment, {
      type: 'environment.loaded',
      report: {
        schemaVersion: 3,
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

  it('keeps Repository menu, path entry, and Plan review backward transitions pure', () => {
    let state = repositoryManagementState('capture');
    state = shellReducer(state, { type: 'repository.move', delta: 1 });
    expect(state.page).toMatchObject({
      workflow: { status: 'menu', cursor: 1, actions: ['migrate', 'rebind', 'unbind'] },
    });

    state = shellReducer(state, { type: 'repository.enterPath' });
    state = shellReducer(state, {
      type: 'repository.path',
      value: '/tmp/moved-repository',
    });
    const path = state;
    state = shellReducer(state, {
      type: 'repository.plan',
      operation: 'bind',
      plan: bindPlan(),
    });
    expect(state.page).toMatchObject({
      workflow: { status: 'plan', step: { operation: 'bind' } },
    });

    state = shellReducer(state, { type: 'repository.back' });
    expect(state.page).toMatchObject({
      workflow: {
        status: 'path',
        value: '/tmp/moved-repository',
        menuCursor: 1,
      },
    });
    expect(shellReducer(path, { type: 'repository.back' }).page).toMatchObject({
      workflow: { status: 'menu', cursor: 1 },
    });
  });

  it('requires Repository Apply to be explicit and rejects every action while applying', () => {
    const repository = repositoryManagementState('capture');
    const planned = shellReducer(repository, {
      type: 'repository.plan',
      operation: 'migrate',
      plan: migrationPlan(),
    });

    expect(shellReducer(planned, { type: 'repository.move', delta: 1 })).toBe(
      planned,
    );
    const applying = shellReducer(planned, { type: 'repository.apply' });
    expect(applying.page).toMatchObject({
      workflow: { status: 'applying' },
    });

    for (const action of [
      { type: 'repository.move', delta: 1 },
      { type: 'repository.back' },
      { type: 'repository.enterPath' },
      { type: 'exit' },
      { type: 'cancel' },
    ] as const) {
      expect(shellReducer(applying, action)).toBe(applying);
    }
  });

  it('returns Repository menus and Results to Overview without applying', () => {
    const repository = repositoryManagementState('capture');
    expect(shellReducer(repository, { type: 'repository.back' })).toMatchObject({
      page: { route: 'overview', status: 'loading' },
      repositoryResumeRoute: 'capture',
    });

    const planned = shellReducer(repository, {
      type: 'repository.plan',
      operation: 'bind',
      plan: bindPlan(),
    });
    const applying = shellReducer(planned, { type: 'repository.apply' });
    const result = shellReducer(applying, {
      type: 'repository.applied',
      operation: 'bind',
      result: failedBindResult(),
    });
    expect(shellReducer(result, { type: 'repository.back' })).toMatchObject({
      page: { route: 'overview', status: 'loading' },
    });
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

    const overview = shellReducer(reloaded, {
      type: 'navigate',
      route: 'overview',
    });
    const reopened = shellReducer(overview, {
      type: 'navigate',
      route: 'repository',
    });
    expect(reopened.repositoryResult).toBeUndefined();
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

  it('moves Overview focus through stable destination IDs in fixed order', () => {
    const ready = shellReducer(createInitialShellState('overview'), {
      type: 'overview.loaded',
      report: statusReport(),
    });

    expect(ready.overviewFocusId).toBe('overview');

    const capture = shellReducer(ready, {
      type: 'overview.move',
      delta: 1,
    });
    const deploy = shellReducer(capture, {
      type: 'overview.move',
      delta: 1,
    });
    const overview = shellReducer(ready, {
      type: 'overview.move',
      delta: -1,
    });

    expect(capture.overviewFocusId).toBe('capture');
    expect(deploy.overviewFocusId).toBe('deploy');
    expect(overview.overviewFocusId).toBe('help');
  });

  it('keeps Overview focus stable when refreshed status data arrives', () => {
    const ready = shellReducer(createInitialShellState('overview'), {
      type: 'overview.loaded',
      report: statusReport(),
    });
    const focused = shellReducer(ready, {
      type: 'overview.move',
      delta: 3,
    });
    const refreshed = shellReducer(focused, {
      type: 'overview.loaded',
      report: {
        ...statusReport(),
        nextActions: ['Review the refreshed state.'],
      },
    });

    expect(focused.overviewFocusId).toBe('restore');
    expect(refreshed.overviewFocusId).toBe('restore');
  });

  it('opens the focused Overview destination through the reducer', () => {
    const ready = shellReducer(createInitialShellState('overview'), {
      type: 'overview.loaded',
      report: statusReport(),
    });
    const focused = shellReducer(ready, {
      type: 'overview.move',
      delta: 4,
    });
    const opened = shellReducer(focused, { type: 'overview.open' });

    expect(focused.overviewFocusId).toBe('repository');
    expect(opened.page).toEqual({
      route: 'repository',
      status: 'loading',
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

  it('opens Help as a ready read-only page in the persistent Shell', () => {
    const help = shellReducer(createInitialShellState('overview'), {
      type: 'navigate',
      route: 'help',
    });

    expect(help.page).toEqual({
      route: 'help',
      status: 'ready',
    });
  });

  it('scrolls read-only pages and resets their viewport when returning to Overview', () => {
    const help = shellReducer(createInitialShellState('help'), {
      type: 'page.scroll',
      delta: 3,
      maximum: 9,
    });
    const scrolledBack = shellReducer(help, {
      type: 'page.scroll',
      delta: -1,
      maximum: 9,
    });
    const overview = shellReducer(scrolledBack, {
      type: 'navigate',
      route: 'overview',
    });
    const end = shellReducer(help, {
      type: 'page.scroll',
      delta: 1_000,
      maximum: 9,
    });

    expect(help.scrollOffset).toBe(3);
    expect(scrolledBack.scrollOffset).toBe(2);
    expect(overview).toMatchObject({
      page: { route: 'overview', status: 'loading' },
      scrollOffset: 0,
    });
    expect(end.scrollOffset).toBe(9);
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

  it('shows the safe Capture Plan diagnostic on the failure page', () => {
    const failedPlan: CapturePlan = {
      ...capturePlan(),
      status: 'failed',
      readyToApply: false,
      issues: [{
        severity: 'error',
        code: 'capture.planFailed',
        message: 'The Capture Plan could not be generated safely. Reason: Invalid YAML configuration.',
      }],
      error: {
        code: 'capture.planFailed',
        message: 'The Capture Plan could not be generated safely. Reason: Invalid YAML configuration.',
        technicalDetails: 'Invalid YAML configuration.',
        nextActions: [],
      },
    };

    const failed = shellReducer(createInitialShellState('capture'), {
      type: 'capture.loaded',
      plan: failedPlan,
    });

    expect(failed.page).toEqual({
      route: 'capture',
      status: 'failure',
      message: 'The Capture Plan could not be generated safely. Reason: Invalid YAML configuration.',
    });
  });

  it('pages Capture changes and restores stable focus after directional Diff review', () => {
    const plan = capturePlan();
    plan.changes.push(...Array.from({ length: 12 }, (_, index) => ({
      ...plan.changes[0],
      id: `capture-file-${index + 2}`,
      name: `settings-${index + 2}.json`,
      defaultSelected: false,
    })));
    let state = shellReducer(createInitialShellState('capture'), {
      type: 'capture.loaded',
      plan,
    });

    state = shellReducer(state, { type: 'capture.focus', position: 'last' });
    expect(state.page).toMatchObject({
      workflow: { status: 'selection', cursor: 15 },
    });
    state = shellReducer(state, { type: 'capture.page', delta: -6 });
    expect(state.page).toMatchObject({
      workflow: { status: 'selection', cursor: 9 },
    });
    state = shellReducer(state, { type: 'capture.open' });
    expect(state.page).toMatchObject({
      workflow: {
        status: 'diff',
        cursor: 9,
        changeId: 'capture-file-7',
      },
    });
    state = shellReducer(state, { type: 'capture.back' });
    expect(state.page).toMatchObject({
      workflow: {
        status: 'selection',
        cursor: 9,
        selectedIds: ['capture-file'],
      },
    });
    state = shellReducer(state, { type: 'capture.focus', position: 'first' });
    expect(state.page).toMatchObject({
      workflow: { status: 'selection', cursor: 0 },
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

  it('advances and backs through Capture review surfaces while restoring focus', () => {
    const plan = capturePlan();
    plan.changes.push(
      {
        ...plan.changes[2],
        id: 'capture-choice-second',
        name: 'second',
        decisionGroupId: 'mcp-second',
        sourceLabel: 'Gemini',
      },
      {
        ...plan.changes[3],
        id: 'capture-skip-second',
        name: 'second',
        decisionGroupId: 'mcp-second',
        sourceLabel: 'Skip second',
      },
    );
    let state = shellReducer(createInitialShellState('capture'), {
      type: 'capture.loaded',
      plan,
    });
    state = shellReducer(state, { type: 'capture.move', delta: 2 });
    state = shellReducer(state, { type: 'capture.open' });
    expectCaptureStatus(state, 'decision');
    state = shellReducer(state, { type: 'capture.chooseDecision' });
    state = shellReducer(state, { type: 'capture.open' });
    expect(state.page).toMatchObject({
      workflow: { status: 'decision', groupIndex: 1, cursor: 0 },
    });
    state = shellReducer(state, { type: 'capture.move', delta: 1 });
    state = shellReducer(state, { type: 'capture.chooseDecision' });
    state = shellReducer(state, { type: 'capture.open' });
    expectCaptureStatus(state, 'confirmation');

    const directionalNoop = shellReducer(state, { type: 'capture.open' });
    expectCaptureStatus(directionalNoop, 'confirmation');

    state = shellReducer(state, { type: 'capture.back' });
    expect(state.page).toMatchObject({
      workflow: { status: 'decision', groupIndex: 1, cursor: 1 },
    });
    state = shellReducer(state, { type: 'capture.back' });
    expect(state.page).toMatchObject({
      workflow: { status: 'decision', groupIndex: 0, cursor: 0 },
    });
    state = shellReducer(state, { type: 'capture.back' });
    expect(state.page).toMatchObject({
      workflow: { status: 'selection', cursor: 2 },
    });
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

    for (const action of [
      { type: 'capture.move', delta: 1 },
      { type: 'capture.page', delta: 10 },
      { type: 'capture.focus', position: 'last' },
      { type: 'capture.open' },
      { type: 'capture.back' },
      { type: 'capture.toggleSelection' },
      { type: 'exit' },
      { type: 'cancel' },
    ] as const) {
      expect(shellReducer(applying, action)).toBe(applying);
    }
  });

  it('pages and focuses long Capture warning collections', () => {
    const plan = capturePlan();
    plan.issues.push(...Array.from({ length: 14 }, (_, index) => ({
      severity: 'warning' as const,
      code: `capture.warning.${index + 2}`,
      confirmationId: `capture-warning-${index + 2}`,
      message: `Review warning ${index + 2}.`,
    })));
    let state = shellReducer(createInitialShellState('capture'), {
      type: 'capture.loaded',
      plan,
    });
    state = shellReducer(state, { type: 'capture.continue' });
    state = shellReducer(state, { type: 'capture.chooseDecision' });
    state = shellReducer(state, { type: 'capture.continue' });
    state = shellReducer(state, { type: 'capture.page', delta: 10 });
    expect(state.page).toMatchObject({
      workflow: { status: 'confirmation', warningCursor: 10 },
    });
    state = shellReducer(state, { type: 'capture.focus', position: 'last' });
    expect(state.page).toMatchObject({
      workflow: { status: 'confirmation', warningCursor: 14 },
    });
    state = shellReducer(state, { type: 'capture.focus', position: 'first' });
    expect(state.page).toMatchObject({
      workflow: { status: 'confirmation', warningCursor: 0 },
    });
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

    const refreshed = shellReducer(regenerating, {
      type: 'capture.loaded',
      plan: capturePlan(),
    });
    expect(refreshed.page).toMatchObject({
      workflow: {
        status: 'selection',
        cursor: 0,
        selectedIds: ['capture-file'],
      },
    });
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
        expandedNodeIds: [],
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
        expandedNodeIds: ['advanced'],
        selectedIds: ['deploy-mcp', 'deploy-delete'],
      },
    });
    expectDeployStatus(
      shellReducer(cleanupSelected, { type: 'deploy.continue' }),
      'confirmation',
    );
  });

  it('toggles every immutable leaf ID from a capability node', () => {
    const plan = deployPlan();
    plan.changes.splice(1, 0, {
      ...plan.changes[0],
      id: 'deploy-rules-extra',
      name: 'Additional Rules',
      targetPath: '/tmp/.codex/extra.md',
    });
    const loaded = shellReducer(createInitialShellState('deploy'), {
      type: 'deploy.loaded',
      plan,
    });

    const cleared = shellReducer(loaded, { type: 'deploy.toggleSelection' });
    expect(cleared.page).toMatchObject({
      workflow: { selectedIds: ['deploy-mcp'] },
    });
    const restored = shellReducer(cleared, { type: 'deploy.toggleSelection' });
    expect(restored.page).toMatchObject({
      workflow: {
        selectedIds: ['deploy-mcp', 'deploy-rules', 'deploy-rules-extra'],
      },
    });
  });

  it('opens and closes Deploy tree nodes and file Diffs without losing focus', () => {
    let state = shellReducer(createInitialShellState('deploy'), {
      type: 'deploy.loaded',
      plan: deployPlan(),
    });
    state = shellReducer(state, { type: 'deploy.open' });
    expect(state.page).toMatchObject({
      workflow: {
        cursor: 0,
        expandedNodeIds: ['capability:standard:codex/rules'],
      },
    });
    state = shellReducer(state, { type: 'deploy.open' });
    expect(state.page).toMatchObject({ workflow: { cursor: 1 } });
    state = shellReducer(state, { type: 'deploy.open' });
    expectDeployStatus(state, 'diff');
    state = shellReducer(state, { type: 'deploy.back' });
    expect(state.page).toMatchObject({
      workflow: {
        status: 'selection',
        cursor: 1,
        expandedNodeIds: ['capability:standard:codex/rules'],
      },
    });
    state = shellReducer(state, { type: 'deploy.back' });
    expect(state.page).toMatchObject({ workflow: { cursor: 0 } });
    state = shellReducer(state, { type: 'deploy.back' });
    expect(state.page).toMatchObject({
      workflow: { cursor: 0, expandedNodeIds: [] },
    });
    state = shellReducer(state, { type: 'deploy.back' });
    expect(state.page).toEqual({
      route: 'overview',
      status: 'loading',
    });
    state = shellReducer(state, { type: 'navigate', route: 'deploy' });
    state = shellReducer(state, { type: 'deploy.loaded', plan: deployPlan() });
    state = shellReducer(state, {
      type: 'deploy.focus',
      position: 'last',
    });
    expect(state.page).toMatchObject({ workflow: { cursor: 2 } });
    state = shellReducer(state, {
      type: 'deploy.focus',
      position: 'first',
    });
    expect(state.page).toMatchObject({ workflow: { cursor: 0 } });
  });

  it('moves, pages, and backs out of Deploy warning confirmation', () => {
    const plan = deployPlan();
    plan.issues.push(...Array.from({ length: 14 }, (_, index) => ({
      severity: 'warning' as const,
      code: `deploy.warning.${index + 2}`,
      confirmationId: `deploy-warning-${index + 2}`,
      message: `Review warning ${index + 2}.`,
    })));
    let state = shellReducer(createInitialShellState('deploy'), {
      type: 'deploy.loaded',
      plan,
    });
    state = shellReducer(state, { type: 'deploy.move', delta: 1 });
    state = shellReducer(state, { type: 'deploy.continue' });

    state = shellReducer(state, { type: 'deploy.move', delta: 10 });
    expect(state.page).toMatchObject({
      workflow: { status: 'confirmation', warningCursor: 10 },
    });
    state = shellReducer(state, { type: 'deploy.move', delta: 100 });
    expect(state.page).toMatchObject({
      workflow: { status: 'confirmation', warningCursor: 14 },
    });
    state = shellReducer(state, {
      type: 'deploy.focus',
      position: 'first',
    });
    expect(state.page).toMatchObject({
      workflow: { status: 'confirmation', warningCursor: 0 },
    });
    state = shellReducer(state, {
      type: 'deploy.focus',
      position: 'last',
    });
    expect(state.page).toMatchObject({
      workflow: { status: 'confirmation', warningCursor: 14 },
    });
    state = shellReducer(state, { type: 'deploy.back' });
    expect(state.page).toMatchObject({
      workflow: { status: 'selection', cursor: 1 },
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

  it('keeps no-backup and Restore Conflict Plans reviewable but disables Apply', () => {
    const noBackup = shellReducer(createInitialShellState('restore'), {
      type: 'restore.loaded',
      plan: restorePlan({
        status: 'failed',
        readyToApply: false,
        backup: null,
        changes: [],
        issues: [{
          severity: 'error',
          code: 'restore.backupNotFound',
          message: 'No complete and verified deployment backup is available.',
        }],
        nextActions: ['Run a successful Deploy before trying Restore again.'],
        error: {
          code: 'restore.backupNotFound',
          message: 'No complete and verified deployment backup is available.',
          nextActions: ['Run a successful Deploy before trying Restore again.'],
        },
      } as unknown as RestorePlan),
    });
    const conflict = shellReducer(createInitialShellState('restore'), {
      type: 'restore.loaded',
      plan: restorePlan({
        readyToApply: false,
        issues: [{
          severity: 'error',
          code: 'restore.conflict',
          message: 'Restore would overwrite files that changed after the deployment.',
          details: '/tmp/settings.json',
        }],
      }),
    });

    expectRestoreStatus(noBackup, 'review');
    expectRestoreStatus(conflict, 'review');
    expectRestoreStatus(
      shellReducer(noBackup, { type: 'restore.apply' }),
      'review',
    );
    expectRestoreStatus(
      shellReducer(conflict, { type: 'restore.apply' }),
      'review',
    );
  });

  it('browses Restore impact, opens detail, and closes detail before leaving review', () => {
    const loaded = shellReducer(createInitialShellState('restore'), {
      type: 'restore.loaded',
      plan: restorePlan(),
    });
    const moved = shellReducer(loaded, {
      type: 'restore.move',
      delta: 1,
    });
    const detail = shellReducer(moved, { type: 'restore.openDetail' });
    const review = shellReducer(detail, { type: 'restore.back' });
    const overview = shellReducer(review, { type: 'restore.back' });

    expect(moved.page).toMatchObject({
      workflow: { status: 'review', cursor: 1 },
    });
    expect(detail.page).toMatchObject({
      workflow: {
        status: 'review',
        cursor: 1,
        detailChangeId: 'restore-added',
      },
    });
    expect(review.page).toMatchObject({
      route: 'restore',
      workflow: { status: 'review', detailChangeId: undefined },
    });
    expect(overview.page).toEqual({ route: 'overview', status: 'loading' });
  });

  it('applies a complete Restore Plan, ignores cancellation, and records success', () => {
    const loaded = shellReducer(createInitialShellState('restore'), {
      type: 'restore.loaded',
      plan: restorePlan(),
    });
    const applying = shellReducer(loaded, { type: 'restore.apply' });
    const cancelled = shellReducer(applying, { type: 'cancel' });
    const result = shellReducer(cancelled, {
      type: 'restore.applied',
      result: restoreResult('succeeded'),
    });

    expectRestoreStatus(applying, 'applying');
    expect(cancelled.exitReason).toBeNull();
    expectRestoreStatus(cancelled, 'applying');
    expectRestoreStatus(result, 'result');
    expect(result.restoreResult?.status).toBe('succeeded');
  });

  it('rejects every navigation action while a Restore transaction is applying', () => {
    const loaded = shellReducer(createInitialShellState('restore'), {
      type: 'restore.loaded',
      plan: restorePlan(),
    });
    const applying = shellReducer(loaded, { type: 'restore.apply' });

    for (const action of [
      { type: 'restore.move', delta: 1 },
      { type: 'restore.openDetail' },
      { type: 'restore.back' },
      { type: 'page.scroll', delta: 1, maximum: 9 },
      { type: 'navigate', route: 'overview' },
      { type: 'exit' },
      { type: 'cancel' },
    ] as const) {
      expect(shellReducer(applying, action)).toBe(applying);
    }
  });

  it('regenerates a stale Restore Plan and preserves rollback failure Results', () => {
    const loaded = shellReducer(createInitialShellState('restore'), {
      type: 'restore.loaded',
      plan: restorePlan(),
    });
    const applying = shellReducer(loaded, { type: 'restore.apply' });

    expectRestoreStatus(shellReducer(applying, {
      type: 'restore.applied',
      result: restoreResult('failed', 'operation.stalePlan'),
    }), 'regenerating');
    expectRestoreStatus(shellReducer(applying, {
      type: 'restore.applied',
      result: restoreResult('failed', 'restore.rollbackFailed'),
    }), 'result');
  });

  it('returns every operation Result surface to a freshly loading Overview', () => {
    const captureSelection = shellReducer(createInitialShellState('capture'), {
      type: 'capture.loaded',
      plan: capturePlan(),
    });
    const captureDecision = shellReducer(captureSelection, {
      type: 'capture.continue',
    });
    const captureConfirmation = shellReducer(
      shellReducer(captureDecision, { type: 'capture.chooseDecision' }),
      { type: 'capture.continue' },
    );
    const captureApplying = shellReducer(
      shellReducer(captureConfirmation, { type: 'capture.toggleWarning' }),
      { type: 'capture.apply' },
    );
    const failedCapture = staleResult();
    if (failedCapture.status !== 'failed') {
      throw new Error('Expected the stale Capture fixture to fail.');
    }
    const captureResult = shellReducer(captureApplying, {
      type: 'capture.applied',
      result: {
        ...failedCapture,
        error: {
          code: 'capture.transactionFailed',
          message: failedCapture.error.message,
          nextActions: failedCapture.error.nextActions,
        },
      },
    });

    const deploySelection = shellReducer(createInitialShellState('deploy'), {
      type: 'deploy.loaded',
      plan: deployPlan(),
    });
    const deployConfirmation = shellReducer(deploySelection, {
      type: 'deploy.continue',
    });
    const deployApplying = shellReducer(
      shellReducer(deployConfirmation, { type: 'deploy.toggleWarning' }),
      { type: 'deploy.apply' },
    );
    const deployResultState = shellReducer(deployApplying, {
      type: 'deploy.applied',
      result: deployResult('deploy.transactionFailed'),
    });

    const restoreReview = shellReducer(createInitialShellState('restore'), {
      type: 'restore.loaded',
      plan: restorePlan(),
    });
    const restoreResultState = shellReducer(
      shellReducer(restoreReview, { type: 'restore.apply' }),
      {
        type: 'restore.applied',
        result: restoreResult('succeeded'),
      },
    );

    const repositoryMenu = repositoryManagementState('capture');
    const repositoryPlanState = shellReducer(repositoryMenu, {
      type: 'repository.plan',
      operation: 'bind',
      plan: bindPlan(),
    });
    const repositoryResultState = shellReducer(
      shellReducer(repositoryPlanState, { type: 'repository.apply' }),
      {
        type: 'repository.applied',
        operation: 'bind',
        result: {
          schemaVersion: 3,
          operation: 'bind',
          status: 'failed',
          repositoryPath: '/tmp/repository',
          changes: [],
          issues: [],
          nextActions: ['Choose a valid Repository.'],
          error: {
            code: 'repository.invalidManifest',
            message: 'The selected directory is not a valid Repository.',
            nextActions: ['Choose a valid Repository.'],
          },
        },
      },
    );

    for (const resultState of [
      captureResult,
      deployResultState,
      restoreResultState,
      repositoryResultState,
    ]) {
      expect(shellReducer(resultState, {
        type: 'navigate',
        route: 'overview',
      })).toMatchObject({
        page: { route: 'overview', status: 'loading' },
        scrollOffset: 0,
      });
    }
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

function expectRestoreStatus(
  state: ReturnType<typeof createInitialShellState>,
  status: string,
): void {
  expect(state.page).toMatchObject({
    route: 'restore',
    status: 'ready',
    workflow: { status },
  });
}

const DEPLOY_CONTEXT_FIELDS = {
  scope: 'global' as const,
  targetRoot: '/tmp/home',
  profileIds: ['global'],
  profilesRevision: 'rev-profiles',
  catalogRevision: 'rev-catalog',
  assetIds: ['rule:canonical'],
};

function deployPlan(
  override: Partial<DeployPlan> = {},
): DeployPlan {
  return {
    schemaVersion: 3,
    operation: 'deploy',
    status: 'planned',
    readyToApply: true,
    operationId: 'deploy-operation',
    preconditions: {},
    repositoryPath: '/tmp/mcv',
    ...DEPLOY_CONTEXT_FIELDS,
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
    linkOutcomes: [],
    linkFacts: [],
    decisions: [],
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
    schemaVersion: 3,
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

function restorePlan(
  override: Partial<RestorePlan> = {},
): RestorePlan {
  return {
    schemaVersion: 3,
    operation: 'restore',
    status: 'planned',
    readyToApply: true,
    operationId: 'restore-operation',
    preconditions: {},
    repositoryPath: '/tmp/mcv',
    backup: {
      id: 'deploy-20260727',
      createdAt: '2026-07-27T08:30:00.000Z',
    },
    changes: [
      {
        id: 'restore-settings',
        action: 'restore',
        targetPath: '/tmp/settings.json',
        nodeKind: 'file',
        layoutKind: 'ordinary-file',
      },
      {
        id: 'restore-added',
        action: 'delete',
        targetPath: '/tmp/added.json',
        nodeKind: 'file',
        layoutKind: 'ordinary-file',
      },
    ],
    issues: [],
    nextActions: [],
    ...override,
  } as RestorePlan;
}

function restoreResult(
  status: 'succeeded' | 'failed',
  code = 'restore.transactionFailed',
): RestoreResult {
  if (status === 'succeeded') {
    return {
      schemaVersion: 3,
      operation: 'restore',
      status: 'succeeded',
      repositoryPath: '/tmp/mcv',
      changes: restorePlan().changes,
      issues: [],
      nextActions: [],
      data: {
        appliedChangeIds: ['restore-settings', 'restore-added'],
        restoredPaths: ['/tmp/settings.json'],
        deletedPaths: ['/tmp/added.json'],
        backupPath: '/tmp/restore-backups/before-restore-success',
      },
    };
  }
  return {
    schemaVersion: 3,
    operation: 'restore',
    status: 'failed',
    repositoryPath: '/tmp/mcv',
    changes: [],
    issues: [],
    nextActions: ['Generate a new Restore Plan.'],
    error: {
      code,
      message: code,
      nextActions: ['Generate a new Restore Plan.'],
    },
  };
}

function capturePlan(): CapturePlan {
  return {
    schemaVersion: 3,
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
        code: 'capture.sourceSkipped',
        confirmationId: 'capture-warning-source-skipped',
        message: 'A source was skipped.',
      },
    ],
    nextActions: [],
    summary: {
      parameterizedPathCount: 0,
      excludedFileCount: 1,
    },
  };
}

function staleResult(): CaptureResult {
  return {
    schemaVersion: 3,
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
    schemaVersion: 3,
    operation: 'status',
    status: 'reported',
    ready: true,
    repositoryPath: '/tmp/mcv',
    repository: {
      path: '/tmp/mcv',
      id: 'repository-id',
      schemaVersion: 4,
    },
    pendingDeployment: {
      add: 0,
      modify: 0,
      delete: 0,
      total: 0,
      recommended: 0,
      optional: 0,
      advancedCleanupExcluded: 0,
    },
    postDeployLocalState: {
      unchanged: 0,
      drift: 0,
      contentDrift: 0,
      topologyDrift: 0,
      missing: 0,
      total: 0,
      files: [],
      contentDrifts: [],
      topologyDrifts: [],
    },
    environment: {
      missingVariables: [],
      ideSupport: [],
    },
    linkOutcomes: [],
    linkFacts: [],
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
    schemaVersion: 3,
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
    schemaVersion: 3,
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
      schemaVersion: 4,
    }],
    issues: [],
    nextActions: [],
  };
}

function initResult(): InitResult {
  return {
    schemaVersion: 3,
    operation: 'init',
    status: 'succeeded',
    repositoryPath: '/tmp/empty',
    changes: [],
    issues: [],
    nextActions: [],
    data: {
      repositoryId: 'repository-id',
      repositorySchemaVersion: 4,
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
    schemaVersion: 3,
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
    schemaVersion: 3,
    operation: 'bind',
    status: 'succeeded',
    repositoryPath: '/tmp/moved-repository',
    changes: [],
    issues: [],
    nextActions: [],
    data: {
      repositoryId: 'repository-id',
      repositorySchemaVersion: 4,
      previousRepositoryPath: '/tmp/old-repository',
    },
  };
}

function failedBindResult(): BindResult {
  return {
    schemaVersion: 3,
    operation: 'bind',
    status: 'failed',
    repositoryPath: '/tmp/moved-repository',
    changes: [],
    issues: [],
    nextActions: ['Choose a valid Repository.'],
    error: {
      code: 'repository.invalidManifest',
      message: 'The selected directory is not a valid Repository.',
      nextActions: ['Choose a valid Repository.'],
    },
  };
}

function migrationPlan(): MigrationPlan {
  return {
    schemaVersion: 3,
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
    schemaVersion: 3,
    operation: 'migrate',
    status: 'succeeded',
    repositoryPath: '/tmp/repository',
    changes: [],
    issues: [],
    nextActions: [],
    data: {
      repositoryId: 'repository-id',
      previousSchemaVersion: 1,
      repositorySchemaVersion: 4,
      backupPath: '/tmp/repository-backup',
      backupVerified: true,
    },
  };
}

function unbindPlan(): UnbindPlan {
  return {
    schemaVersion: 3,
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
    schemaVersion: 3,
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
