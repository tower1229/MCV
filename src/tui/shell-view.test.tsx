import { renderToString } from 'ink';
import { describe, expect, it } from 'vitest';
import type { CapturePlan, CaptureResult } from '../operations/capture.js';
import type { DeployPlan, DeployResult } from '../operations/deploy.js';
import type { RestorePlan, RestoreResult } from '../operations/restore.js';
import type { StatusReport } from '../operations/status.js';
import {
  maximumPageScrollOffset,
  ShellView,
} from './shell-view.js';
import {
  createInitialShellState,
  shellReducer,
  type ShellState,
} from './shell-state.js';

describe('TUI Shell view', () => {
  it('renders an explicit Overview loading state', () => {
    const rendered = renderToString(
      <ShellView state={createInitialShellState('overview')} />,
    );

    expect(rendered).toMatchInlineSnapshot(`
      "MCV
      Overview

      ● Loading: Overview...

      ↑↓ Move   →/Enter Open   q Quit   Ctrl+C Cancel
      Accelerators: c Capture   d Deploy   s Restore   r Repository   h Help"
    `);
  });

  it('renders responsive Overview status tones without changing stable focus', () => {
    let state = overviewState();
    for (let index = 0; index < 4; index += 1) {
      state = shellReducer(state, { type: 'overview.move', delta: 1 });
    }

    const wide = renderToString(
      <ShellView
        state={state}
        terminalColumns={100}
        terminalRows={24}
      />,
      { columns: 100 },
    );
    const narrow = renderToString(
      <ShellView
        state={state}
        terminalColumns={44}
        terminalRows={24}
      />,
      { columns: 44 },
    );
    const veryShort = renderToString(
      <ShellView
        state={state}
        terminalColumns={120}
        terminalRows={12}
      />,
      { columns: 120 },
    );

    expect(wide).toMatch(/Navigation\s+Status Overview/);
    expect(narrow).not.toMatch(/Navigation\s+Status Overview/);
    expect(veryShort).not.toMatch(/Navigation\s+Status Overview/);
    expect(veryShort.split('\n').length).toBeLessThanOrEqual(12);
    for (const rendered of [wide, narrow, veryShort]) {
      const text = rendered.replace(/\s+/g, ' ');
      expect(text).toContain('› Repository');
      expect(text).toContain('✓ Repository: Ready');
      expect(text).toContain(
        'Path: /Users/张涛/Configuration Repository/超长路径',
      );
      expect(text).toContain('! Git: Changes');
      expect(text).toContain(
        '! Pending Deployment Changes: Review · 226542 changes',
      );
      expect(text).toContain('! Drift: Review · 9876 changed, 543 missing');
      expect(text).toContain('! Environment: Warning · 2 missing variables');
      expect(text).toContain('✓ Codex: Ready');
      expect(text).toContain('○ Claude Code: Not detected');
      expect(text).toContain('○ Gemini: Disabled');
      expect(text).toContain('× Last operation: Failed · deploy');
      expect(text).toContain('× Error: test.blocked');
      expect(text).toContain('↑↓ Move');
    }
    expect({ wide, narrow, veryShort }).toMatchSnapshot();
  });

  it('keeps a non-Git Repository neutral while labeling healthy and successful states', () => {
    const base = overviewState();
    if (
      base.page.route !== 'overview'
      || base.page.status !== 'ready'
      || base.page.report.status !== 'reported'
    ) {
      throw new Error('Expected a ready Overview fixture.');
    }
    const state = shellReducer(createInitialShellState('overview'), {
      type: 'overview.loaded',
      report: {
        ...base.page.report,
        ready: true,
        repository: {
          path: base.page.report.repository.path,
          id: base.page.report.repository.id,
          schemaVersion: base.page.report.repository.schemaVersion,
        },
        pendingDeployment: {
          add: 0,
          modify: 0,
          delete: 0,
          total: 0,
        },
        postDeployLocalState: {
          unchanged: 3,
          drift: 0,
          missing: 0,
          total: 3,
          files: [],
        },
        environment: {
          ...base.page.report.environment,
          missingVariables: [],
        },
        lastOperation: {
          kind: 'deploy',
          time: '2026-07-27T00:00:00.000Z',
          success: true,
        },
        issues: [],
      },
    });

    const rendered = renderToString(
      <ShellView
        state={state}
        terminalColumns={100}
        terminalRows={24}
      />,
      { columns: 100 },
    ).replace(/\s+/g, ' ');

    expect(rendered).toContain('✓ Repository: Ready');
    expect(rendered).not.toContain(' Git:');
    expect(rendered).toContain('○ Pending Deployment Changes: None');
    expect(rendered).toContain('✓ Drift: None');
    expect(rendered).toContain('✓ Environment: Ready');
    expect(rendered).toContain('✓ Last operation: Succeeded · deploy');
  });

  it('renders Help inside the Shell with only the six primary destinations', () => {
    const state = shellReducer(createInitialShellState('overview'), {
      type: 'navigate',
      route: 'help',
    });

    expect(renderToString(<ShellView state={state} />)).toMatchInlineSnapshot(`
      "MCV
      Help

      Primary navigation:
        Overview
        Capture
        Deploy
        Restore Latest Deployment
        Repository
        Help

      Direct commands open the same Shell when attached to a terminal.
      Use --dry-run, --yes, --plain, or --json for one-shot output.

      ↑↓ Scroll   ←/Escape Overview   q Quit   Ctrl+C Cancel"
    `);
  });

  it('clips and scrolls long read-only content inside the terminal viewport', () => {
    const initial = createInitialShellState('help');
    const maximum = maximumPageScrollOffset(initial, 9, 80);
    const help = shellReducer(initial, {
      type: 'page.scroll',
      delta: 3,
      maximum,
    });
    const rendered = renderToString(
      <ShellView state={help} terminalRows={9} />,
      { columns: 80 },
    );

    expect(rendered).not.toContain('Primary navigation:');
    expect(rendered).not.toContain('  Capture');
    expect(rendered).toContain('Repository');
    expect(rendered).toContain('↑↓ Scroll');
    expect(rendered.split('\n').length).toBeLessThanOrEqual(9);
    expect(maximumPageScrollOffset(initial, 9, 12)).toBeGreaterThan(maximum);
  });

  it('sends Repository write Results back to Overview', () => {
    const state = repositoryFailureResultState();

    expect(renderToString(<ShellView state={state} />)).toContain(
      'Enter/← Refresh Overview   q Quit',
    );
  });

  it('renders an actionable failure state', () => {
    const state = {
      ...createInitialShellState('environment'),
      page: {
        route: 'environment' as const,
        status: 'failure' as const,
        message: 'Environment probe failed.',
      },
    };

    expect(renderToString(<ShellView state={state} />)).toMatchInlineSnapshot(`
      "MCV
      Environment Details

      × Error: Environment probe failed.

      Escape Overview   q Quit   Ctrl+C Cancel"
    `);
  });

  it('snapshots ready Reports across desktop and narrow terminal widths', () => {
    const overview = shellReducer(createInitialShellState('overview'), {
      type: 'overview.loaded',
      report: {
        schemaVersion: 1,
        operation: 'status',
        status: 'reported',
        ready: true,
        repositoryPath: '/Users/张涛/Configuration Repository/long-path',
        repository: {
          path: '/Users/张涛/Configuration Repository/long-path',
          id: 'repository-id',
          schemaVersion: 2,
          git: {
            branch: 'main',
            clean: false,
            uncommittedChanges: 1_234,
          },
        },
        changes: [],
        pendingDeployment: {
          add: 123_456,
          modify: 98_765,
          delete: 4_321,
          total: 226_542,
        },
        postDeployLocalState: {
          unchanged: 10_000,
          drift: 9_876,
          missing: 543,
          total: 20_419,
          files: [],
        },
        environment: {
          missingVariables: ['OPENAI_API_KEY', 'GEMINI_API_KEY'],
          ideSupport: [
            {
              id: 'codex',
              name: 'Codex',
              enabled: true,
              detected: true,
              surfaces: [],
            },
            {
              id: 'claude-code',
              name: 'Claude Code',
              enabled: true,
              detected: false,
              surfaces: [],
            },
            {
              id: 'gemini',
              name: 'Gemini',
              enabled: false,
              detected: false,
              surfaces: [],
            },
          ],
        },
        lastOperation: {
          kind: 'deploy',
          time: '2026-07-27T00:00:00.000Z',
          success: false,
        },
        issues: [{
          severity: 'error',
          code: 'test.redacted',
          message: 'Sensitive source content was excluded.',
          details: 'source-secret-value',
        }],
        nextActions: [],
      },
    });
    const environment = shellReducer(createInitialShellState('environment'), {
      type: 'environment.loaded',
      report: {
        schemaVersion: 1,
        operation: 'discover',
        status: 'reported',
        ready: true,
        repositoryPath: null,
        changes: [],
        environments: [{
          id: 'codex',
          name: 'Codex',
          detected: true,
          configDirectories: [{
            id: 'global',
            path: String.raw`C:\Users\张涛\Configuration Repository\very-long-directory`,
            exists: true,
          }],
          configFiles: [{
            id: 'config',
            path: '/Users/张涛/Configuration Repository/very-long-directory/config.toml',
            exists: false,
          }],
        }],
        missingVariables: ['OPENAI_API_KEY'],
        issues: [],
        nextActions: [],
      },
    });
    expect(maximumPageScrollOffset({
      ...environment,
      postInitOnboarding: true,
    }, 8, 80)).toBe(
      maximumPageScrollOffset(environment, 8, 80) + 1,
    );

    const previousNoColor = process.env.NO_COLOR;
    process.env.NO_COLOR = '1';
    const rendered = {
      macos100: renderToString(
        <ShellView
          state={overview}
          terminalColumns={100}
          terminalRows={24}
        />,
        { columns: 100 },
      ),
      windows120: renderToString(<ShellView state={environment} />, { columns: 120 }),
      narrow44: renderToString(
        <ShellView
          state={overview}
          terminalColumns={44}
          terminalRows={24}
        />,
        { columns: 44 },
      ),
      noColorFailure: renderToString(<ShellView state={{
        ...createInitialShellState('overview'),
        page: {
          route: 'overview',
          status: 'failure',
          message: 'Repository unavailable.',
        },
      }} />),
    };
    if (previousNoColor === undefined) delete process.env.NO_COLOR;
    else process.env.NO_COLOR = previousNoColor;

    expect(rendered).toMatchInlineSnapshot(`
      {
        "macos100": "MCV
      Overview

      Navigation                      Status Overview
      › Overview                      ✓ Repository: Ready
        Capture (c)                     Path: /Users/张涛/Configuration Repository/long-path
        Deploy (d)                    ! Git: Changes · 1234 uncommitted changes · main
        Restore Latest Deployment (s) ! Pending Deployment Changes: Review · 226542 changes (123456 add,
        Repository (r)                98765 modify, 4321 delete)
        Help (h)                      ! Drift: Review · 9876 changed, 543 missing
                                      ! Environment: Warning · 2 missing variables
                                      IDE support:
                                        ✓ Codex: Ready · enabled, detected
                                        ○ Claude Code: Not detected · enabled, not detected
                                        ○ Gemini: Disabled · disabled, not detected
                                      × Last operation: Failed · deploy
                                      × Error: test.redacted · Sensitive source content was excluded.

      ↑↓ Move   →/Enter Open   q Quit   Ctrl+C Cancel
      Accelerators: c Capture   d Deploy   s Restore   r Repository   h Help",
        "narrow44": "MCV
      Overview

      Navigation
      › Overview
        Capture (c)
        Deploy (d)
        Restore Latest Deployment (s)
        Repository (r)
        Help (h)

      Status Overview
      ✓ Repository: Ready
        Path: /Users/张涛/Configuration
      Repository/long-path
      ! Git: Changes · 1234 uncommitted changes ·
      main
      ! Pending Deployment Changes: Review ·
      226542 changes (123456 add, 98765 modify,
      4321 delete)
      ! Drift: Review · 9876 changed, 543 missing
      ! Environment: Warning · 2 missing variables
      IDE support:
        ✓ Codex: Ready · enabled, detected
        ○ Claude Code: Not detected · enabled, not
       detected
        ○ Gemini: Disabled · disabled, not
      detected
      × Last operation: Failed · deploy
      × Error: test.redacted · Sensitive source
      content was excluded.

      ↑↓ Move   →/Enter Open   q Quit   Ctrl+C
      Cancel
      Accelerators: c Capture   d Deploy   s
      Restore   r Repository   h Help",
        "noColorFailure": "MCV
      Overview

      × Error: Repository unavailable.

      ↑↓ Move   →/Enter Open   q Quit   Ctrl+C Cancel
      Accelerators: c Capture   d Deploy   s Restore   r Repository   h Help",
        "windows120": "MCV
      Environment Details

      Codex: detected
        [found] C:\\Users\\张涛\\Configuration Repository\\very-long-directory
        [missing] /Users/张涛/Configuration Repository/very-long-directory/config.toml
      Missing variables: OPENAI_API_KEY

      ↑↓ Scroll   ←/Escape Overview   q Quit   Ctrl+C Cancel",
      }
    `);
    expect(Object.values(rendered).join('')).not.toMatch(/\u001b\[/);
    expect(Object.values(rendered).join('')).not.toContain('source-secret-value');
  });

  it('snapshots grouped Capture selection at narrow width with Unicode and many changes', () => {
    const plan = capturePlan(16);
    const state = shellReducer(createInitialShellState('capture'), {
      type: 'capture.loaded',
      plan,
    });

    const rendered = renderToString(<ShellView state={state} />, { columns: 46 });

    expect(rendered).toMatchInlineSnapshot(`
      "MCV
      Capture · Select Changes

      Repository: /Users/张涛/Configuration
      Repository/超长路径
      16 changes · 15 selected

      Claude Code / File
      > [x] [modify] 设置.json
      Codex / Skill
        [x] [add] 工具 Skill
      Shared / MCP
        [x] [add] 本地服务
      Claude Code / File
        [x] [add] config-4.json
        [x] [add] config-5.json
        [x] [add] config-6.json
        [x] [add] config-7.json
        [x] [add] config-8.json
        [x] [add] config-9.json
        [x] [add] config-10.json
        [x] [add] config-11.json
        [x] [add] config-12.json
      … 4 more changes

      ↑↓ Move   Space Select   d Diff   Enter
      Continue   q Quit   Ctrl+C Cancel"
    `);
  });

  it('snapshots sanitized text Diff and binary metadata without raw content', () => {
    const loaded = shellReducer(createInitialShellState('capture'), {
      type: 'capture.loaded',
      plan: capturePlan(2),
    });
    const textDiff = shellReducer(loaded, { type: 'capture.openDiff' });
    const binaryFocused = shellReducer(loaded, { type: 'capture.move', delta: 1 });
    const binaryDiff = shellReducer(binaryFocused, { type: 'capture.openDiff' });

    const rendered = {
      text: renderToString(<ShellView state={textDiff} />, { columns: 80 }),
      binary: renderToString(<ShellView state={binaryDiff} />, { columns: 80 }),
    };

    expect(rendered).toMatchInlineSnapshot(`
      {
        "binary": "MCV
      Capture · Diff

      config-2.json · add
      ide/claude-code/native/config-2.json
        binary · 42 bytes · sha256
      bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb

      Escape Back   q Quit   Ctrl+C Cancel",
        "text": "MCV
      Capture · Diff

      设置.json · modify
      ide/claude-code/native/设置.json
        - "theme": "light"
        + "theme": "dark"

      Escape Back   q Quit   Ctrl+C Cancel",
      }
    `);
    expect(JSON.stringify(rendered)).not.toContain('raw-secret-must-not-render');
  });

  it('snapshots decision, warning confirmation, applying, regeneration, and result states', () => {
    const plan = capturePlan(1, true);
    const loaded = shellReducer(createInitialShellState('capture'), {
      type: 'capture.loaded',
      plan,
    });
    const decision = shellReducer(loaded, { type: 'capture.continue' });
    const chosen = shellReducer(decision, { type: 'capture.chooseDecision' });
    const confirmation = shellReducer(chosen, { type: 'capture.continue' });
    const warned = shellReducer(confirmation, { type: 'capture.toggleWarning' });
    const applying = shellReducer(warned, { type: 'capture.apply' });
    const regenerating = shellReducer(applying, {
      type: 'capture.applied',
      result: staleCaptureResult(),
    });
    const result = shellReducer(applying, {
      type: 'capture.applied',
      result: successfulCaptureResult(),
    });

    const previousNoColor = process.env.NO_COLOR;
    process.env.NO_COLOR = '1';
    const rendered = {
      decision: renderToString(<ShellView state={decision} />, { columns: 80 }),
      confirmation: renderToString(<ShellView state={confirmation} />, { columns: 80 }),
      applying: renderToString(<ShellView state={applying} />, { columns: 80 }),
      regenerating: renderToString(<ShellView state={regenerating} />, { columns: 80 }),
      result: renderToString(<ShellView state={result} />, { columns: 80 }),
    };
    if (previousNoColor === undefined) delete process.env.NO_COLOR;
    else process.env.NO_COLOR = previousNoColor;

    expect(rendered).toMatchInlineSnapshot(`
      {
        "applying": "MCV
      Capture · Applying

      ● Applying: 2 selected changes transactionally...

      Please wait; input is disabled during Apply.",
        "confirmation": "MCV
      Capture · Confirm Apply

      2 selected changes
      Warnings require explicit confirmation:
      > [ ] A source item was skipped safely.

      Apply disabled: confirm every warning.

      ↑↓ Move   Space Confirm Warning   Enter Apply   Escape Back   q Quit   Ctrl+C
      Cancel",
        "decision": "MCV
      Capture · Resolve Decisions

      Decision 1/1: shared
      > [ ] Claude Code
        [ ] Skip this MCP

      Continue disabled: choose exactly one option.

      ↑↓ Move   Space Choose   Enter Continue   Escape Back   q Quit   Ctrl+C Cancel",
        "regenerating": "MCV
      Capture · Regenerating

      The Capture Plan became stale. Regenerating a safe preview...

      Please wait.",
        "result": "MCV
      Capture · Result

      Capture succeeded.
      Applied: 2 changes
      Written: 2 paths
      Deleted: 0 paths

      ↑↓ Scroll   Enter/← Refresh Overview   q Quit",
      }
    `);
    expect(Object.values(rendered).join('')).not.toMatch(/\u001b\[/);
  });

  it('snapshots grouped Deploy selection with collapsed advanced cleanup', () => {
    const state = shellReducer(createInitialShellState('deploy'), {
      type: 'deploy.loaded',
      plan: deployPlan(),
      lastSelection: { codex: ['mcp'] },
    });

    expect(renderToString(<ShellView state={state} />, { columns: 72 }))
      .toMatchInlineSnapshot(`
        "MCV
        Deploy · Select Changes

        Repository: /Users/张涛/Configuration Repository
        3 changes · 1 selected

        > [ ] ▶ Codex / Shared Rules · 1 file
          [x] ▶ Codex / MCP · 1 file
          [ ] ▶ Advanced Cleanup: collapsed (1 deletion, none selected)

        ↑↓ Move   ←→ Expand/Collapse   Space Select   PgUp/PgDn Page   Home/End
          d Diff   a Cleanup   Enter Continue   q Quit   Ctrl+C Cancel"
      `);
  });

  it('summarizes a large Deploy Plan by capability within a 24-row terminal', () => {
    const state = shellReducer(createInitialShellState('deploy'), {
      type: 'deploy.loaded',
      plan: largeDeployPlan(),
    });

    const rendered = renderToString(<ShellView state={state} />, {
      columns: 80,
    });

    expect(rendered.split('\n').length).toBeLessThanOrEqual(24);
    expect(rendered).toContain('Codex / Skills');
    expect(rendered).toContain('14 files');
    expect(rendered).not.toContain('hatch-pet');
    expect(rendered).toContain('Advanced Cleanup: collapsed (14 deletions, none selected)');
  });

  it('expands a Skill capability into one package summary', () => {
    const loaded = shellReducer(createInitialShellState('deploy'), {
      type: 'deploy.loaded',
      plan: largeDeployPlan(),
    });
    const expanded = shellReducer(loaded, {
      type: 'deploy.expand',
    } as never);

    const rendered = renderToString(<ShellView state={expanded} />, {
      columns: 80,
    });

    expect(rendered).toContain('hatch-pet · 14 files');
    expect(rendered.match(/hatch-pet/g)).toHaveLength(1);
    expect(rendered).not.toContain('file-0.md');
  });

  it('keeps the focused Skill file visible inside a dynamic terminal viewport', () => {
    let state = shellReducer(createInitialShellState('deploy'), {
      type: 'deploy.loaded',
      plan: largeDeployPlan(),
    });
    state = shellReducer(state, { type: 'deploy.expand' });
    state = shellReducer(state, { type: 'deploy.expand' });
    state = shellReducer(state, { type: 'deploy.expand' });
    state = shellReducer(state, { type: 'deploy.focus', position: 'last' });
    state = shellReducer(state, { type: 'deploy.move', delta: -1 });

    const rendered = renderToString(
      <ShellView state={state} terminalRows={16} />,
      { columns: 80 },
    );

    expect(rendered.split('\n').length).toBeLessThanOrEqual(16);
    expect(rendered).toContain('file-13.md');
    expect(rendered).toContain('earlier');
    expect(rendered).not.toContain('file-0.md');

    const narrow = renderToString(
      <ShellView state={state} terminalRows={16} />,
      { columns: 48 },
    );
    expect(narrow.split('\n').length).toBeLessThanOrEqual(16);
    expect(narrow).toContain('file-13.md');

    const compact = renderToString(
      <ShellView state={state} terminalRows={10} />,
      { columns: 60 },
    );
    expect(compact.split('\n').length).toBeLessThanOrEqual(10);
    expect(compact).toContain('file-13.md');
    expect(compact).toContain('↑↓/Pg Move   ←→ Expand');
  });

  it('shows partial selection on every ancestor after toggling one Skill file', () => {
    let state = shellReducer(createInitialShellState('deploy'), {
      type: 'deploy.loaded',
      plan: largeDeployPlan(),
    });
    state = shellReducer(state, { type: 'deploy.expand' });
    state = shellReducer(state, { type: 'deploy.expand' });
    state = shellReducer(state, { type: 'deploy.expand' });
    state = shellReducer(state, { type: 'deploy.move', delta: 1 });
    state = shellReducer(state, { type: 'deploy.toggleSelection' });

    const rendered = renderToString(
      <ShellView state={state} terminalRows={30} />,
      { columns: 100 },
    );

    expect(rendered).toContain('[-] ▼ Codex / Skills · 14 files');
    expect(rendered).toContain('[-] ▼ hatch-pet · 14 files');
    expect(rendered).toContain('[ ]   [add] file-0.md');
  });

  it('snapshots an expanded large Deploy tree at desktop and narrow widths', () => {
    let state = shellReducer(createInitialShellState('deploy'), {
      type: 'deploy.loaded',
      plan: largeDeployPlan(),
    });
    state = shellReducer(state, { type: 'deploy.expand' });
    state = shellReducer(state, { type: 'deploy.expand' });
    state = shellReducer(state, { type: 'deploy.expand' });
    state = shellReducer(state, { type: 'deploy.move', delta: 8 });

    expect({
      desktop: renderToString(
        <ShellView state={state} terminalRows={24} />,
        { columns: 100 },
      ),
      narrow: renderToString(
        <ShellView state={state} terminalRows={16} />,
        { columns: 48 },
      ),
    }).toMatchSnapshot();
  });

  it('snapshots Deploy replacement Diff, warning, applying, stale, and failure Result', () => {
    const loaded = shellReducer(createInitialShellState('deploy'), {
      type: 'deploy.loaded',
      plan: deployPlan(),
    });
    const expanded = shellReducer(loaded, { type: 'deploy.expand' });
    const leafFocused = shellReducer(expanded, { type: 'deploy.expand' });
    const diff = shellReducer(leafFocused, { type: 'deploy.openDiff' });
    const confirmation = shellReducer(loaded, { type: 'deploy.continue' });
    const confirmed = shellReducer(confirmation, { type: 'deploy.toggleWarning' });
    const applying = shellReducer(confirmed, { type: 'deploy.apply' });
    const stale = shellReducer(applying, {
      type: 'deploy.applied',
      result: failedDeployResult('operation.stalePlan'),
    });
    const failure = shellReducer(applying, {
      type: 'deploy.applied',
      result: failedDeployResult('deploy.transactionFailed'),
    });

    expect({
      diff: renderToString(<ShellView state={diff} />, { columns: 80 }),
      confirmation: renderToString(<ShellView state={confirmation} />, { columns: 80 }),
      applying: renderToString(<ShellView state={applying} />, { columns: 80 }),
      stale: renderToString(<ShellView state={stale} />, { columns: 80 }),
      failure: renderToString(<ShellView state={failure} />, { columns: 80 }),
    }).toMatchSnapshot();
  });

  it('snapshots Restore no-backup, conflict, review, applying, stale, success, and rollback failure', () => {
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
          details: '/Users/张涛/.codex/config.toml',
        }],
        nextActions: ['Back up or manually resolve every Restore Conflict, then generate a new Restore Plan.'],
      }),
    });
    const review = shellReducer(createInitialShellState('restore'), {
      type: 'restore.loaded',
      plan: restorePlan(),
    });
    const deleteFocused = shellReducer(review, {
      type: 'restore.move',
      delta: 1,
    });
    const detail = shellReducer(deleteFocused, {
      type: 'restore.openDetail',
    });
    const applying = shellReducer(review, { type: 'restore.apply' });
    const stale = shellReducer(applying, {
      type: 'restore.applied',
      result: restoreResult('operation.stalePlan'),
    });
    const success = shellReducer(applying, {
      type: 'restore.applied',
      result: successfulRestoreResult(),
    });
    const rollbackFailure = shellReducer(applying, {
      type: 'restore.applied',
      result: restoreResult('restore.rollbackFailed'),
    });

    const rendered = {
      noBackup: renderToString(<ShellView state={noBackup} />, { columns: 80 }),
      conflict: renderToString(<ShellView state={conflict} />, { columns: 80 }),
      review: renderToString(<ShellView state={review} />, { columns: 80 }),
      deleteFocused: renderToString(<ShellView state={deleteFocused} />, { columns: 80 }),
      detail: renderToString(<ShellView state={detail} />, { columns: 80 }),
      applying: renderToString(<ShellView state={applying} />, { columns: 80 }),
      stale: renderToString(<ShellView state={stale} />, { columns: 80 }),
      success: renderToString(<ShellView state={success} />, { columns: 80 }),
      rollbackFailure: renderToString(<ShellView state={rollbackFailure} />, { columns: 80 }),
    };

    expect(rendered.noBackup).toContain('No complete and verified deployment backup');
    expect(rendered.noBackup).toContain('Apply disabled');
    expect(rendered.conflict).toContain('× Restore Conflict: Blocked');
    expect(rendered.conflict).toContain('/Users/张涛/.codex/config.toml');
    expect(rendered.conflict).not.toContain('force');
    expect(rendered.review).toContain('Backup time: 2026-07-27T08:30:00.000Z');
    expect(rendered.review).toContain('1 file(s) to write, 1 file(s) to delete');
    expect(rendered.review).toContain('> [write] /Users/张涛/.codex/config.toml');
    expect(rendered.deleteFocused).toContain('> [delete] /Users/张涛/.codex/added.toml');
    expect(rendered.detail).toContain('Focused Restore detail');
    expect(rendered.detail).toContain('Action: delete');
    expect(rendered.applying).toContain('input is disabled during backup, Apply, and rollback');
    expect(rendered.stale).toContain('Regenerating');
    expect(rendered.success).toContain('Restore succeeded');
    expect(rendered.rollbackFailure).toContain('restore.rollbackFailed');
    expect(rendered.success).toContain('Enter/← Refresh Overview');
    expect(rendered.rollbackFailure).toContain('q Quit');
    expect(rendered).toMatchSnapshot();
  });
});

function deployPlan(): DeployPlan {
  return {
    schemaVersion: 1,
    operation: 'deploy',
    status: 'planned',
    readyToApply: true,
    operationId: 'deploy-view',
    preconditions: {},
    repositoryPath: '/Users/张涛/Configuration Repository',
    changes: [
      {
        id: 'deploy-rules',
        ide: 'codex',
        capability: 'rules',
        name: 'Shared Rules',
        targetPath: '/Users/张涛/.codex/AGENTS.md',
        change: 'modify',
        defaultSelected: true,
        group: 'standard',
        strategy: 'replace-entire-file',
        preview: {
          targetPath: '/Users/张涛/.codex/AGENTS.md',
          kind: 'text',
          bytes: 20,
          sha256: 'a'.repeat(64),
          diff: '- old rule\n+ new rule',
        },
      },
      {
        id: 'deploy-mcp',
        ide: 'codex',
        capability: 'mcp',
        name: 'MCP',
        targetPath: '/Users/张涛/.codex/config.toml',
        change: 'modify',
        defaultSelected: true,
        group: 'standard',
        strategy: 'managed-merge',
        preview: {
          targetPath: '/Users/张涛/.codex/config.toml',
          kind: 'text',
          bytes: 30,
          sha256: 'b'.repeat(64),
          diff: '- old mcp\n+ new mcp',
        },
      },
      {
        id: 'deploy-delete',
        ide: 'codex',
        capability: 'skills',
        name: '旧 Skill',
        targetPath: '/Users/张涛/.codex/skills/旧/SKILL.md',
        change: 'delete',
        defaultSelected: false,
        group: 'advanced',
        strategy: 'replace-entire-file',
        preview: {
          targetPath: '/Users/张涛/.codex/skills/旧/SKILL.md',
          kind: 'binary',
          bytes: 42,
          sha256: 'c'.repeat(64),
        },
      },
    ],
    issues: [{
      severity: 'warning',
      code: 'deploy.warning',
      message: 'A target needs explicit review.',
    }],
    nextActions: [],
  };
}

function largeDeployPlan(): DeployPlan {
  const standard = Array.from({ length: 14 }, (_, index): DeployPlan['changes'][number] => {
    const relativePath = index === 13
      ? 'references/a-very-long-directory-name/another-long-directory/file-13.md'
      : `file-${index}.md`;
    const targetPath = `/Users/张涛/.agents/skills/hatch-pet/${relativePath}`;
    return {
    id: `deploy-skill-${index}`,
    ide: 'codex',
    capability: 'skills',
    name: 'hatch-pet',
    targetPath,
    change: 'add',
    defaultSelected: true,
    group: 'standard',
    strategy: 'replace-entire-file',
    preview: {
      targetPath,
      kind: 'text',
      bytes: 20,
      sha256: 'd'.repeat(64),
      diff: `+ file ${index}`,
    },
    };
  });
  const advanced = standard.map((change, index): DeployPlan['changes'][number] => ({
    ...change,
    id: `deploy-delete-${index}`,
    targetPath: `/Users/张涛/.codex/skills/hatch-pet/file-${index}.md`,
    change: 'delete',
    defaultSelected: false,
    group: 'advanced',
    preview: {
      ...change.preview,
      targetPath: `/Users/张涛/.codex/skills/hatch-pet/file-${index}.md`,
    },
  }));
  return {
    schemaVersion: 1,
    operation: 'deploy',
    status: 'planned',
    readyToApply: true,
    operationId: 'large-deploy-view',
    preconditions: {},
    repositoryPath: '/Users/张涛/Configuration Repository',
    changes: [...standard, ...advanced],
    issues: [],
    nextActions: [],
  };
}

function restorePlan(
  override: Partial<RestorePlan> = {},
): RestorePlan {
  return {
    schemaVersion: 1,
    operation: 'restore',
    status: 'planned',
    readyToApply: true,
    operationId: 'restore-view',
    preconditions: {},
    repositoryPath: '/Users/张涛/Configuration Repository',
    backup: {
      id: 'deploy-20260727',
      createdAt: '2026-07-27T08:30:00.000Z',
    },
    changes: [
      {
        id: 'restore-settings',
        action: 'restore',
        targetPath: '/Users/张涛/.codex/config.toml',
      },
      {
        id: 'restore-added',
        action: 'delete',
        targetPath: '/Users/张涛/.codex/added.toml',
      },
    ],
    issues: [],
    nextActions: [],
    ...override,
  } as RestorePlan;
}

function successfulRestoreResult(): RestoreResult {
  return {
    schemaVersion: 1,
    operation: 'restore',
    status: 'succeeded',
    repositoryPath: '/Users/张涛/Configuration Repository',
    changes: restorePlan().changes,
    issues: [],
    nextActions: [],
    data: {
      appliedChangeIds: ['restore-settings', 'restore-added'],
      restoredPaths: ['/Users/张涛/.codex/config.toml'],
      deletedPaths: ['/Users/张涛/.codex/added.toml'],
      backupPath: '/Users/张涛/.mcv/restore-backups/before-restore-success',
    },
  };
}

function restoreResult(code: string): RestoreResult {
  return {
    schemaVersion: 1,
    operation: 'restore',
    status: 'failed',
    repositoryPath: '/Users/张涛/Configuration Repository',
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

function failedDeployResult(code: string): DeployResult {
  return {
    schemaVersion: 1,
    operation: 'deploy',
    status: 'failed',
    repositoryPath: '/Users/张涛/Configuration Repository',
    changes: [],
    issues: [],
    nextActions: ['Generate and review a new Deploy Plan.'],
    error: {
      code,
      message: code,
      nextActions: ['Generate and review a new Deploy Plan.'],
    },
  };
}

function capturePlan(
  changeCount: number,
  withIssues = false,
): CapturePlan {
  const changes: CapturePlan['changes'] = Array.from(
    { length: changeCount },
    (_, index) => ({
      id: `capture-file-${index + 1}`,
      ide: 'claude-code',
      surface: 'native',
      itemType: 'file',
      capability: 'native',
      name: index === 0 ? '设置.json' : `config-${index + 1}.json`,
      change: index === 0 ? 'modify' : 'add',
      defaultSelected: true,
      repositoryPaths: [
        `ide/claude-code/native/${index === 0 ? '设置.json' : `config-${index + 1}.json`}`,
      ],
      previews: index === 0
        ? [{
          repositoryPath: 'ide/claude-code/native/设置.json',
          kind: 'text',
          bytes: 42,
          sha256: 'a'.repeat(64),
          diff: '- "theme": "light"\n+ "theme": "dark"',
        }]
        : [{
          repositoryPath: `ide/claude-code/native/config-${index + 1}.json`,
          kind: 'binary',
          bytes: 42,
          sha256: 'b'.repeat(64),
        }],
    }),
  );
  if (withIssues) {
    changes.push(
      {
        id: 'capture-mcp-claude',
        ide: 'shared',
        surface: 'shared',
        itemType: 'mcp',
        capability: 'mcp',
        name: 'shared',
        change: 'conflict',
        defaultSelected: false,
        repositoryPaths: ['common/mcp.yaml'],
        previews: [],
        decisionGroupId: 'shared',
        decision: 'candidate',
        sourceLabel: 'Claude Code',
      },
      {
        id: 'capture-mcp-skip',
        ide: 'shared',
        surface: 'shared',
        itemType: 'mcp',
        capability: 'mcp',
        name: 'shared',
        change: 'conflict',
        defaultSelected: false,
        repositoryPaths: ['common/mcp.yaml'],
        previews: [],
        decisionGroupId: 'shared',
        decision: 'skip',
        sourceLabel: 'Skip this MCP',
      },
    );
  }
  if (changeCount === 16) {
    changes[1] = {
      ...changes[1],
      ide: 'codex',
      itemType: 'skill',
      capability: 'skills',
      name: '工具 Skill',
      repositoryPaths: ['common/skills/工具 Skill/SKILL.md'],
    };
    changes[2] = {
      ...changes[2],
      ide: 'shared',
      itemType: 'mcp',
      capability: 'mcp',
      name: '本地服务',
      repositoryPaths: ['common/mcp.yaml'],
    };
    changes[15] = {
      ...changes[15],
      change: 'delete',
      defaultSelected: false,
    };
  }

  return {
    schemaVersion: 1,
    operation: 'capture',
    status: 'planned',
    readyToApply: !withIssues,
    operationId: 'capture-operation',
    preconditions: {},
    repositoryPath: '/Users/张涛/Configuration Repository/超长路径',
    changes,
    issues: withIssues
      ? [
        {
          severity: 'decisionRequired',
          code: 'capture.mcpConflict',
          message: 'Choose one MCP source.',
        },
        {
          severity: 'warning',
          code: 'capture.sourceSkipped.1.1',
          message: 'A source item was skipped safely.',
        },
      ]
      : [],
    nextActions: [],
    summary: {
      sensitiveFieldCount: 1,
      parameterizedPathCount: 2,
      excludedFileCount: 3,
    },
  };
}

function staleCaptureResult(): CaptureResult {
  return {
    schemaVersion: 1,
    operation: 'capture',
    status: 'failed',
    repositoryPath: '/tmp/mcv',
    changes: [],
    issues: [],
    nextActions: ['Regenerate.'],
    error: {
      code: 'operation.stalePlan',
      message: 'Plan stale.',
      nextActions: ['Regenerate.'],
    },
  };
}

function successfulCaptureResult(): CaptureResult {
  return {
    schemaVersion: 1,
    operation: 'capture',
    status: 'succeeded',
    repositoryPath: '/tmp/mcv',
    changes: [],
    issues: [],
    nextActions: [],
    data: {
      appliedChangeIds: ['capture-file-1', 'capture-mcp-claude'],
      writtenPaths: ['common/mcp.yaml', 'ide/claude-code/native/设置.json'],
      deletedPaths: [],
    },
  };
}

function repositoryFailureResultState(): ShellState {
  return {
    ...createInitialShellState('repository'),
    page: {
      route: 'repository',
      status: 'ready',
      workflow: {
        status: 'result',
        step: {
          operation: 'bind',
          result: {
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
        report: {},
        currentDirectory: {},
        resumeRoute: 'overview',
      },
    },
  } as unknown as ShellState;
}

function overviewState(): ShellState {
  const report: StatusReport = {
    schemaVersion: 1,
    operation: 'status',
    status: 'reported',
    ready: false,
    repositoryPath: '/Users/张涛/Configuration Repository/超长路径',
    repository: {
      path: '/Users/张涛/Configuration Repository/超长路径',
      id: 'repository-id',
      schemaVersion: 2,
      git: {
        branch: 'main',
        clean: false,
        uncommittedChanges: 1_234,
      },
    },
    changes: [],
    pendingDeployment: {
      add: 123_456,
      modify: 98_765,
      delete: 4_321,
      total: 226_542,
    },
    postDeployLocalState: {
      unchanged: 10_000,
      drift: 9_876,
      missing: 543,
      total: 20_419,
      files: [],
    },
    environment: {
      missingVariables: ['OPENAI_API_KEY', 'GEMINI_API_KEY'],
      ideSupport: [
        {
          id: 'codex',
          name: 'Codex',
          enabled: true,
          detected: true,
          surfaces: [],
        },
        {
          id: 'claude-code',
          name: 'Claude Code',
          enabled: true,
          detected: false,
          surfaces: [],
        },
        {
          id: 'gemini',
          name: 'Gemini',
          enabled: false,
          detected: false,
          surfaces: [],
        },
      ],
    },
    lastOperation: {
      kind: 'deploy',
      time: '2026-07-27T00:00:00.000Z',
      success: false,
    },
    issues: [{
      severity: 'error',
      code: 'test.blocked',
      message: 'Deployment is blocked.',
    }],
    nextActions: [],
  };

  return shellReducer(createInitialShellState('overview'), {
    type: 'overview.loaded',
    report,
  });
}
