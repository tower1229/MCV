import { renderToString } from 'ink';
import { describe, expect, it } from 'vitest';
import type { CapturePlan, CaptureResult } from '../operations/capture.js';
import type { DeployPlan, DeployResult } from '../operations/deploy.js';
import type { RestorePlan, RestoreResult } from '../operations/restore.js';
import type { RepositoryReport } from '../operations/repository.js';
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
      expect(text).toContain('! Drift: Review · 0 content, 0 topology, 9876 changed, 543 missing');
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
          recommended: 0,
          optional: 0,
          advancedCleanupExcluded: 0,
        },
        postDeployLocalState: {
          unchanged: 3,
          drift: 0,
          contentDrift: 0,
          topologyDrift: 0,
          missing: 0,
          total: 3,
          files: [],
          contentDrifts: [],
          topologyDrifts: [],
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
    expect(rendered).toContain('✓ Last operation: Succeeded · deploy on this device');
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
    const rendered = renderToString(<ShellView state={state} />);

    expect(rendered).toContain(
      'Enter/←/Escape Refresh Overview   q Quit',
    );
    expect(rendered).toContain(
      '× Failed: Bind: The selected directory is not a valid Repository.',
    );
  });

  it('renders Repository menu focus, health, and path mode with shared status tones', () => {
    const menu = repositoryRecoveryMenuState();
    const path = shellReducer(menu, { type: 'repository.move', delta: 1 });
    const pathEntry = shellReducer(path, { type: 'repository.enterPath' });
    const renderedMenu = renderToString(<ShellView state={menu} />);
    const renderedPath = renderToString(<ShellView state={pathEntry} />);

    expect(renderedMenu).toContain('× Blocked: Repository is not ready.');
    expect(renderedMenu).toContain('› Review Migration Plan');
    expect(renderedMenu).toContain('→/Enter Open');
    expect(renderedPath).toContain(
      '● Input: Enter the path to an existing MCV Repository:',
    );
    expect(renderedPath).toContain('←/Escape Back');
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
        schemaVersion: 3,
        operation: 'status',
        status: 'reported',
        ready: true,
        repositoryPath: '/Users/张涛/Configuration Repository/long-path',
        repository: {
          path: '/Users/张涛/Configuration Repository/long-path',
          id: 'repository-id',
          schemaVersion: 3,
          git: {
            branch: 'main',
            clean: false,
            uncommittedChanges: 1_234,
          },
        },
        pendingDeployment: {
          add: 123_456,
          modify: 98_765,
          delete: 4_321,
          total: 226_542,
          recommended: 226_542,
          optional: 0,
          advancedCleanupExcluded: 0,
        },
        postDeployLocalState: {
          unchanged: 10_000,
          drift: 9_876,
          contentDrift: 0,
          topologyDrift: 0,
          missing: 543,
          total: 20_419,
          files: [],
          contentDrifts: [],
          topologyDrifts: [],
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
        linkOutcomes: [],
        linkFacts: [],
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
        schemaVersion: 3,
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
        Repository (r)                98765 modify, 4321 delete; 226542 recommended, 0 optional; 0 cleanup
        Help (h)                       excluded)
                                      ! Drift: Review · 0 content, 0 topology, 9876 changed, 543 missing
                                      ! Environment: Warning · 2 missing variables
                                      IDE support:
                                        ✓ Codex: Ready · enabled, detected
                                        ○ Claude Code: Not detected · enabled, not detected
                                        ○ Gemini: Disabled · disabled, not detected
                                      × Last operation: Failed · deploy on this device
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
      4321 delete; 226542 recommended, 0 optional;
       0 cleanup excluded)
      ! Drift: Review · 0 content, 0 topology,
      9876 changed, 543 missing
      ! Environment: Warning · 2 missing variables
      IDE support:
        ✓ Codex: Ready · enabled, detected
        ○ Claude Code: Not detected · enabled, not
       detected
        ○ Gemini: Disabled · disabled, not
      detected
      × Last operation: Failed · deploy on this
      device
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

  it('keeps satisfied external Skill links visible in wide and compact Overview', () => {
    const state = overviewState([{
      status: 'satisfied-via-link',
      ownership: 'external',
      scope: 'shared-link-root',
      owner: 'ide',
      ide: 'claude-code',
      surface: 'claude-code',
      linkPath: '/Users/张涛/.claude/skills',
      linkPaths: ['/Users/张涛/.claude/skills'],
      resolvedPath: '/Users/张涛/.agents/skills',
      resolvedPaths: ['/Users/张涛/.agents/skills'],
      packageNames: ['review'],
      affectedFileCount: 42,
    }]);

    const wide = renderToString(
      <ShellView state={state} terminalColumns={120} terminalRows={30} />,
      { columns: 120 },
    );
    const compact = renderToString(
      <ShellView state={state} terminalColumns={72} terminalRows={14} />,
      { columns: 72 },
    );

    for (const rendered of [wide, compact]) {
      const normalized = rendered.replace(/\s+/g, ' ');
      expect(normalized).toContain('Linked Skills');
      expect(normalized).toContain('Satisfied via link');
      expect(normalized).toContain('External · 1 package · 42 affected files');
    }
  });

  it('shows one blocked physical Skill conflict shared by multiple IDE Surfaces', () => {
    const resolvedPath = '/Users/张涛/.codex/skills/grill-with-docs';
    const common = {
      status: 'blocked' as const,
      ownership: 'external' as const,
      scope: 'skill-package' as const,
      owner: 'ide' as const,
      packageNames: ['grill-with-docs'],
      affectedFileCount: 4,
      resolvedPath,
      resolvedPaths: [resolvedPath],
      reason: 'divergent' as const,
    };
    const state = overviewState([
      {
        ...common,
        ide: 'codex',
        surface: 'codex',
        linkPath: '/Users/张涛/.agents/skills/grill-with-docs',
        linkPaths: ['/Users/张涛/.agents/skills/grill-with-docs'],
      },
      {
        ...common,
        ide: 'claude-code',
        surface: 'claude-code',
        linkPath: '/Users/张涛/.claude/skills/grill-with-docs',
        linkPaths: ['/Users/张涛/.claude/skills/grill-with-docs'],
      },
    ]);

    const rendered = renderToString(
      <ShellView state={state} terminalColumns={120} terminalRows={30} />,
      { columns: 120 },
    ).replace(/\s+/g, ' ');

    expect(rendered.match(/Linked Skills: Needs decision/g)).toHaveLength(1);
    expect(rendered).toContain('Codex + Claude Code · External · 1 package · 4 affected files');
  });

  it('keeps Advanced Cleanup notices out of the Overview', () => {
    const state = overviewState();
    if (state.page.route !== 'overview' || state.page.status !== 'ready') {
      throw new Error('Expected a ready Overview fixture.');
    }
    state.page.report.issues = [
      {
        severity: 'notice',
        code: 'deploy.legacyCodexSkillDuplicates',
        message: 'Review Advanced Cleanup candidates.',
      },
    ];

    const rendered = renderToString(
      <ShellView state={state} terminalColumns={120} terminalRows={30} />,
      { columns: 120 },
    );

    expect(rendered).not.toContain('legacyCodexSkillDuplicates');
    expect(rendered).not.toContain('Advanced Cleanup candidates');
  });

  it('snapshots grouped Capture selection at narrow width with Unicode and many changes', () => {
    const plan = capturePlan(16);
    const state = shellReducer(createInitialShellState('capture'), {
      type: 'capture.loaded',
      plan,
    });

    const rendered = renderToString(
      <ShellView state={state} terminalRows={24} />,
      { columns: 46 },
    );

    expect(rendered).toMatchInlineSnapshot(`
      "MCV
      Capture · Select Changes

      Repository: /Users/张涛…on Repository/超长路径
      16 changes · 15 selected

      > [x] ✓ Selected · [modify] 设置.json · Claud…
        [x] ✓ Selected · [add] 工具 Skill · Codex /…
        [x] ✓ Selected · [add] 本地服务 · Shared / …
        [x] ✓ Selected · [add] config-4.json · Clau…
        [x] ✓ Selected · [add] config-5.json · Clau…
        [x] ✓ Selected · [add] config-6.json · Clau…
        [x] ✓ Selected · [add] config-7.json · Clau…
        [x] ✓ Selected · [add] config-8.json · Clau…
        [x] ✓ Selected · [add] config-9.json · Clau…
        [x] ✓ Selected · [add] config-10.json · Cla…
        [x] ✓ Selected · [add] config-11.json · Cla…
        [x] ✓ Selected · [add] config-12.json · Cla…
        … 4 more

      ↑↓ Move   PgUp/PgDn Page   Home/End   ← Back
       → Diff   Space Select   Enter Review   q Quit
         Ctrl+C Cancel"
    `);
  });

  it('keeps the focused Capture change visible in a short terminal viewport', () => {
    const plan = capturePlan(16);
    let state = shellReducer(createInitialShellState('capture'), {
      type: 'capture.loaded',
      plan,
    });
    state = shellReducer(state, { type: 'capture.focus', position: 'last' });

    const rendered = renderToString(
      <ShellView state={state} terminalRows={12} />,
      { columns: 100 },
    );

    expect(rendered.split('\n').length).toBeLessThanOrEqual(12);
    expect(rendered).toContain('> [ ] × Destructive · [delete] config-16.json');
    expect(rendered).toContain('earlier');
    expect(rendered).not.toContain('设置.json');
    expect(rendered).toContain('→ Diff');
    expect(rendered).toContain('PgUp/PgDn');
  });

  it('snapshots faithful text Diff and binary metadata', () => {
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

      ←/Escape Close Diff   q Quit   Ctrl+C Cancel",
        "text": "MCV
      Capture · Diff

      设置.json · modify
      ide/claude-code/native/设置.json
        - "theme": "light"
        + "theme": "dark"

      ←/Escape Close Diff   q Quit   Ctrl+C Cancel",
      }
    `);
    expect(JSON.stringify(rendered)).not.toContain('raw-secret-must-not-render');
  });

  it('shows contributing Skill projections once in Capture Diff', () => {
    const plan = capturePlan(1);
    plan.changes[0] = {
      id: 'capture-skill-shared',
      ide: 'shared',
      surface: 'codex',
      itemType: 'skill',
      capability: 'skills',
      name: 'shared-demo',
      change: 'add',
      defaultSelected: true,
      repositoryPaths: ['common/skills/shared-demo/SKILL.md'],
      previews: [{
        repositoryPath: 'common/skills/shared-demo/SKILL.md',
        kind: 'text',
        bytes: 20,
        sha256: 'c'.repeat(64),
        diff: '+ # Shared',
      }],
      contributingProjections: [
        {
          ide: 'claude-code',
          surface: 'claude-code',
          projectionPath: '/home/.claude/skills/shared-demo',
          ownership: 'managed',
        },
        {
          ide: 'codex',
          surface: 'codex',
          projectionPath: '/home/.agents/skills/shared-demo',
          ownership: 'physical',
        },
      ],
    };
    const loaded = shellReducer(createInitialShellState('capture'), {
      type: 'capture.loaded',
      plan,
    });
    const diff = shellReducer(loaded, { type: 'capture.openDiff' });
    const rendered = renderToString(<ShellView state={diff} />, { columns: 100 });

    expect(rendered).toContain('shared-demo · add');
    expect(rendered).toContain('Projections: claude-code (managed), codex (physical)');
    expect(rendered.match(/shared-demo · add/g)).toHaveLength(1);
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
      > [ ] ! Warning · A source item was skipped safely.
      × Blocked: confirm every warning.

      ↑↓/Pg Move   Home/End   Space Confirm Warning   Enter Apply   ←/Escape Back   q
      Quit   Ctrl+C Cancel",
        "decision": "MCV
      Capture · Resolve Decisions

      Decision 1/1: shared
      > [ ] ○ Unselected · Claude Code
        [ ] ○ Unselected · Skip this MCP

      × Blocked: choose exactly one option before continuing.

      ↑↓/Pg Move   Home/End   ← Back   →/Enter Next   Space Choose   q Quit   Ctrl+C
      Cancel",
        "regenerating": "MCV
      Capture · Regenerating

      ! Review required: The Capture Plan became stale. Regenerating a safe preview...

      Please wait.",
        "result": "MCV
      Capture · Result

      ✓ Succeeded: Capture completed.
      Applied: 2 changes
      Written: 2 paths
      Deleted: 0 paths

      ↑↓ Scroll   Enter/← Refresh Overview   q Quit",
      }
    `);
    expect(Object.values(rendered).join('')).not.toMatch(/\u001b\[/);
  });

  it('keeps Capture workflow status semantics explicit without ANSI color', () => {
    const plan = capturePlan(1, true);
    const loaded = shellReducer(createInitialShellState('capture'), {
      type: 'capture.loaded',
      plan,
    });
    const decision = shellReducer(loaded, { type: 'capture.continue' });
    const chosen = shellReducer(decision, { type: 'capture.chooseDecision' });
    const confirmation = shellReducer(chosen, { type: 'capture.continue' });
    const confirmed = shellReducer(confirmation, {
      type: 'capture.toggleWarning',
    });
    const applying = shellReducer(confirmed, { type: 'capture.apply' });
    const succeeded = shellReducer(applying, {
      type: 'capture.applied',
      result: successfulCaptureResult(),
    });
    const succeededWithWarning = shellReducer(applying, {
      type: 'capture.applied',
      result: {
        ...successfulCaptureResult(),
        issues: [{
          severity: 'warning',
          code: 'capture.stateRecordFailed',
          confirmationId: 'capture-warning-state-record-failed',
          message: 'Local history was not updated.',
        }],
      },
    });
    const blocked = shellReducer(applying, {
      type: 'capture.applied',
      result: {
        schemaVersion: 3,
        operation: 'capture',
        status: 'blocked',
        repositoryPath: '/tmp/mcv',
        changes: [],
        issues: [{
          severity: 'warning',
          code: 'capture.blocked',
          confirmationId: 'capture-warning-blocked',
          message: 'Review is incomplete.',
        }],
        nextActions: ['Review the Capture Plan again.'],
      },
    });

    const previousNoColor = process.env.NO_COLOR;
    process.env.NO_COLOR = '1';
    const rendered = {
      selection: renderToString(<ShellView state={loaded} />, { columns: 100 }),
      decision: renderToString(<ShellView state={decision} />, { columns: 100 }),
      warning: renderToString(<ShellView state={confirmation} />, { columns: 100 }),
      confirmed: renderToString(<ShellView state={confirmed} />, { columns: 100 }),
      applying: renderToString(<ShellView state={applying} />, { columns: 100 }),
      succeeded: renderToString(<ShellView state={succeeded} />, { columns: 100 }),
      succeededWithWarning: renderToString(
        <ShellView state={succeededWithWarning} />,
        { columns: 100 },
      ),
      blocked: renderToString(<ShellView state={blocked} />, { columns: 100 }),
    };
    if (previousNoColor === undefined) delete process.env.NO_COLOR;
    else process.env.NO_COLOR = previousNoColor;

    expect(Object.values(rendered).join('')).not.toMatch(/\u001b\[/);
    expect(rendered.selection).toContain('[x] ✓ Selected ·');
    expect(rendered.decision).toContain('[ ] ○ Unselected · Claude Code');
    expect(rendered.warning).toContain('[ ] ! Warning · A source item was skipped safely.');
    expect(rendered.warning).toContain('× Blocked: confirm every warning.');
    expect(rendered.confirmed).toContain('[x] ✓ Confirmed · A source item was skipped safely.');
    expect(rendered.applying).toContain('● Applying:');
    expect(rendered.succeeded).toContain('✓ Succeeded: Capture completed.');
    expect(rendered.succeededWithWarning).toContain(
      '! Warning: Local history was not updated.',
    );
    expect(rendered.blocked).toContain('× Blocked: Capture did not change the Repository.');
  });

  it('keeps the focused Capture warning visible in a short terminal viewport', () => {
    const plan = capturePlan(1, true);
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
    state = shellReducer(state, { type: 'capture.focus', position: 'last' });

    const rendered = renderToString(
      <ShellView state={state} terminalRows={10} />,
      { columns: 120 },
    );

    expect(rendered.split('\n').length).toBeLessThanOrEqual(10);
    expect(rendered).toContain('> [ ] ! Warning · Review warning 15.');
    expect(rendered).toContain('earlier');
    expect(rendered).not.toContain('A source item was skipped safely.');
  });

  it('keeps the focused Capture required choice visible in a short terminal viewport', () => {
    const plan = capturePlan(1, true);
    const choice = plan.changes.find((change) =>
      change.decision === 'candidate')!;
    plan.changes.push(...Array.from({ length: 14 }, (_, index) => ({
      ...choice,
      id: `capture-choice-${index + 2}`,
      sourceLabel: `Source ${index + 2}`,
    })));
    let state = shellReducer(createInitialShellState('capture'), {
      type: 'capture.loaded',
      plan,
    });
    state = shellReducer(state, { type: 'capture.continue' });
    state = shellReducer(state, { type: 'capture.focus', position: 'last' });

    const rendered = renderToString(
      <ShellView state={state} terminalRows={10} />,
      { columns: 120 },
    );

    expect(rendered.split('\n').length).toBeLessThanOrEqual(10);
    expect(rendered).toContain('> [ ] ○ Unselected · Source 15');
    expect(rendered).toContain('earlier');
    expect(rendered).not.toContain('Claude Code');
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
          [ ] ▶ × Destructive · Advanced Cleanup · 1 deletion · none selected

        ↑↓ Move   ← Collapse/Back   → Expand/Diff   Space Select   PgUp/PgDn
        Page   Home/End   Enter Review   q Quit   Ctrl+C Cancel
        Accelerators: d Diff   a Cleanup"
      `);
  });

  it('shows package-level external link outcomes without relying on color', () => {
    const plan = deployPlan();
    plan.linkOutcomes = [{
      status: 'satisfied-via-link',
      ownership: 'external',
      scope: 'shared-link-root',
      owner: 'ide',
      ide: 'codex',
      surface: 'codex',
      linkPath: '/Users/张涛/.claude/skills',
      linkPaths: ['/Users/张涛/.claude/skills'],
      resolvedPath: '/Users/张涛/.agents/skills',
      resolvedPaths: ['/Users/张涛/.agents/skills'],
      packageNames: ['hatch-pet', 'review'],
      affectedFileCount: 18,
    }];
    plan.linkFacts = linkFactsFromOutcomes(plan.linkOutcomes);
    const state = shellReducer(createInitialShellState('deploy'), {
      type: 'deploy.loaded',
      plan,
    });

    const rendered = renderToString(<ShellView state={state} />, { columns: 100 });

    expect(rendered).toContain(
      'Satisfied via link · External · 2 Skill packages · 18 affected files',
    );
    expect(rendered).toContain('/Users/张涛/.claude/skills → /Users/张涛/.agents/skills');
  });

  it('labels an owned link as an already satisfied managed projection', () => {
    const plan = deployPlan();
    plan.linkOutcomes = [{
      status: 'satisfied-via-link',
      ownership: 'managed',
      scope: 'skill-package',
      owner: 'ide',
      ide: 'claude-code',
      surface: 'claude-code',
      linkPath: '/Users/张涛/.claude/skills/review',
      linkPaths: ['/Users/张涛/.claude/skills/review'],
      resolvedPath: '/Users/张涛/.agents/skills/review',
      resolvedPaths: ['/Users/张涛/.agents/skills/review'],
      packageNames: ['review'],
      affectedFileCount: 1,
    }];
    plan.linkFacts = linkFactsFromOutcomes(plan.linkOutcomes);
    const state = shellReducer(createInitialShellState('deploy'), {
      type: 'deploy.loaded',
      plan,
    });

    const rendered = renderToString(<ShellView state={state} />, { columns: 100 });

    expect(rendered).toContain('Already satisfied projection · Managed');
  });

  it('shows the physical materialization layout in Deploy detail without color', () => {
    const plan = deployPlan();
    plan.changes[0].deploymentKind = 'physical-materialization';
    const loaded = shellReducer(createInitialShellState('deploy'), {
      type: 'deploy.loaded',
      plan,
    });
    const expanded = shellReducer(loaded, { type: 'deploy.open' });
    const leafFocused = shellReducer(expanded, { type: 'deploy.open' });
    const diff = shellReducer(leafFocused, { type: 'deploy.openDiff' });

    expect(renderToString(<ShellView state={diff} />, { columns: 80 }))
      .toContain('Layout: Physical materialization');
  });

  it('labels topology migration as destructive without relying on color and keeps it unselected', () => {
    const migrationChange = {
      id: 'deploy-topology-migration',
      owner: 'ide' as const,
      ide: 'claude-code' as const,
      surface: 'claude-code' as const,
      capability: 'skills' as const,
      name: 'review',
      targetPath: '/Users/张涛/.claude/skills/review',
      change: 'modify' as const,
      defaultSelected: false,
      group: 'standard' as const,
      strategy: 'replace-entire-file' as const,
      deploymentKind: 'topology-migration' as const,
      preview: {
        targetPath: '/Users/张涛/.claude/skills/review',
        kind: 'link' as const,
        linkTarget: '/Users/张涛/.agents/skills/review',
      },
    };
    const plan = {
      ...deployPlan(),
      changes: [migrationChange],
      issues: [{
        severity: 'warning' as const,
        code: 'deploy.skillsTopology.migrationCandidate',
        confirmationId: 'deploy-warning-topology-migration',
        message: 'Topology migration available: replace matching physical Skill copy review with a managed link.',
      }],
    };
    const loaded = shellReducer(createInitialShellState('deploy'), {
      type: 'deploy.loaded',
      plan,
    });
    expect(loaded.page.route === 'deploy'
      && loaded.page.status === 'ready'
      && loaded.page.workflow.status === 'selection'
      && loaded.page.workflow.selectedIds.includes('deploy-topology-migration')).toBe(false);

    let state = shellReducer(loaded, { type: 'deploy.open' });
    state = shellReducer(state, { type: 'deploy.move', delta: 1 });
    state = shellReducer(state, { type: 'deploy.open' });
    state = shellReducer(state, { type: 'deploy.move', delta: 1 });
    const previousNoColor = process.env.NO_COLOR;
    process.env.NO_COLOR = '1';
    const noColor = renderToString(<ShellView state={state} />, { columns: 100 });
    if (previousNoColor === undefined) delete process.env.NO_COLOR;
    else process.env.NO_COLOR = previousNoColor;

    expect(noColor).not.toContain('\u001b[31m');
    expect(noColor).toContain('× Destructive');
    expect(noColor).toContain('review');

    const diff = shellReducer(state, { type: 'deploy.openDiff' });
    expect(renderToString(<ShellView state={diff} />, { columns: 80 }))
      .toContain('Layout: Topology migration');
  });

  it('reports topology migrations separately in the Deploy success summary', () => {
    const loaded = shellReducer(createInitialShellState('deploy'), {
      type: 'deploy.loaded',
      plan: deployPlan(),
    });
    const confirmation = shellReducer(loaded, { type: 'deploy.continue' });
    const confirmed = shellReducer(confirmation, { type: 'deploy.toggleWarning' });
    const applying = shellReducer(confirmed, { type: 'deploy.apply' });
    const result = shellReducer(applying, {
      type: 'deploy.applied',
      result: {
        schemaVersion: 3,
        operation: 'deploy',
        status: 'succeeded',
        repositoryPath: '/Users/张涛/Configuration Repository',
        changes: [{
          id: 'deploy-topology-migration',
          owner: 'ide',
          ide: 'claude-code',
          surface: 'claude-code',
          capability: 'skills',
          name: 'review',
          targetPath: '/Users/张涛/.claude/skills/review',
          change: 'modify',
          defaultSelected: false,
          group: 'standard',
          strategy: 'replace-entire-file',
          deploymentKind: 'topology-migration',
          preview: {
            targetPath: '/Users/张涛/.claude/skills/review',
            kind: 'link',
            linkTarget: '/Users/张涛/.agents/skills/review',
          },
        }],
        issues: [],
        nextActions: [],
        data: {
          appliedChangeIds: ['deploy-topology-migration'],
          writtenPaths: [],
          deletedPaths: [],
          projectionPaths: ['/Users/张涛/.claude/skills/review'],
        },
        linkOutcomes: [],
      },
    });

    expect(renderToString(<ShellView state={result} />, { columns: 100 }))
      .toContain('Topology migrations: 1 (Claude Code)');
  });

  it('bounds many linked-Skill outcomes in Deploy and Overview viewports', () => {
    const outcomes = Array.from({ length: 20 }, (_, index): DeployPlan['linkOutcomes'][number] => ({
      status: index < 18 ? 'satisfied-via-link' : 'blocked',
      ownership: 'external',
      scope: 'skill-package',
      owner: 'ide',
      ide: 'claude-code',
      surface: 'claude-code',
      linkPath: `/Users/张涛/.claude/skills/skill-${index}`,
      linkPaths: [`/Users/张涛/.claude/skills/skill-${index}`],
      resolvedPath: `/Volumes/config/skills/skill-${index}`,
      resolvedPaths: [`/Volumes/config/skills/skill-${index}`],
      packageNames: [`skill-${index}`],
      affectedFileCount: 10,
      ...(index < 18 ? {} : { reason: 'divergent' as const }),
    }));
    const plan = largeDeployPlan();
    plan.linkOutcomes = outcomes;
    plan.linkFacts = linkFactsFromOutcomes(outcomes);
    const deploy = shellReducer(createInitialShellState('deploy'), {
      type: 'deploy.loaded',
      plan,
    });
    const overview = overviewState(outcomes);

    const deployRendered = renderToString(
      <ShellView state={deploy} terminalRows={24} />,
      { columns: 80 },
    );
    const overviewRendered = renderToString(
      <ShellView state={overview} terminalColumns={72} terminalRows={16} />,
      { columns: 72 },
    );
    const normalized = `${deployRendered}\n${overviewRendered}`.replace(/\s+/g, ' ');

    expect(deployRendered.split('\n').length).toBeLessThanOrEqual(24);
    expect(normalized).toContain('Satisfied via link · External · 18 Skill');
    expect(normalized).toContain('Needs decision · External · 1 Skill package');
    expect(normalized).toContain('180 affected files');
    expect(normalized).not.toContain('/Volumes/config/skills/skill-19');
  });

  it('summarizes a large Deploy Plan by capability within a 24-row terminal', () => {
    const state = shellReducer(createInitialShellState('deploy'), {
      type: 'deploy.loaded',
      plan: largeDeployPlan(),
    });

    const rendered = renderToString(
      <ShellView state={state} terminalRows={24} />,
      { columns: 80 },
    );

    expect(rendered.split('\n').length).toBeLessThanOrEqual(24);
    expect(rendered).toContain('Codex / Skills');
    expect(rendered).toContain('14 files');
    expect(rendered).not.toContain('hatch-pet');
    expect(rendered).toContain(
      '× Destructive · Advanced Cleanup · 14 deletions · none selected',
    );
  });

  it('labels Advanced Cleanup and deletion candidates as destructive without relying on color', () => {
    let state = shellReducer(createInitialShellState('deploy'), {
      type: 'deploy.loaded',
      plan: deployPlan(),
    });
    state = shellReducer(state, { type: 'deploy.focus', position: 'last' });
    state = shellReducer(state, { type: 'deploy.open' });
    state = shellReducer(state, { type: 'deploy.move', delta: 1 });
    state = shellReducer(state, { type: 'deploy.open' });
    state = shellReducer(state, { type: 'deploy.open' });
    state = shellReducer(state, { type: 'deploy.open' });

    const previousNoColor = process.env.NO_COLOR;
    process.env.NO_COLOR = '1';
    const noColor = renderToString(<ShellView state={state} />, { columns: 100 });
    if (previousNoColor === undefined) delete process.env.NO_COLOR;
    else process.env.NO_COLOR = previousNoColor;

    expect(noColor).not.toContain('\u001b[31m');
    expect(noColor.match(/× Destructive/g)).toHaveLength(2);
    expect(noColor).toContain('[ ] ▼ × Destructive · Advanced Cleanup ·');
    expect(noColor).toContain('[ ]   × Destructive · [delete]');
  });

  it('keeps a focused Deploy warning visible in a short terminal viewport', () => {
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
    state = shellReducer(state, { type: 'deploy.continue' });
    state = shellReducer(state, { type: 'deploy.focus', position: 'last' });

    const rendered = renderToString(
      <ShellView state={state} terminalRows={10} />,
      { columns: 80 },
    );

    expect(rendered.split('\n').length).toBeLessThanOrEqual(10);
    expect(rendered).toContain('> [ ] Review warning 15.');
    expect(rendered).toContain('earlier');
    expect(rendered).not.toContain('A target needs explicit review.');
  });

  it('expands a Skill capability into one package summary', () => {
    const loaded = shellReducer(createInitialShellState('deploy'), {
      type: 'deploy.loaded',
      plan: largeDeployPlan(),
    });
    const expanded = shellReducer(loaded, { type: 'deploy.open' });

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
    state = shellReducer(state, { type: 'deploy.open' });
    state = shellReducer(state, { type: 'deploy.open' });
    state = shellReducer(state, { type: 'deploy.open' });
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
    expect(compact).toContain('↑↓/Pg Move   ← Back   → Open');
  });

  it('shows partial selection on every ancestor after toggling one Skill file', () => {
    let state = shellReducer(createInitialShellState('deploy'), {
      type: 'deploy.loaded',
      plan: largeDeployPlan(),
    });
    state = shellReducer(state, { type: 'deploy.open' });
    state = shellReducer(state, { type: 'deploy.open' });
    state = shellReducer(state, { type: 'deploy.open' });
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
    state = shellReducer(state, { type: 'deploy.open' });
    state = shellReducer(state, { type: 'deploy.open' });
    state = shellReducer(state, { type: 'deploy.open' });
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
    const expanded = shellReducer(loaded, { type: 'deploy.open' });
    const leafFocused = shellReducer(expanded, { type: 'deploy.open' });
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

  it('shows an already satisfied managed projection in the Deploy Result', () => {
    const loaded = shellReducer(createInitialShellState('deploy'), {
      type: 'deploy.loaded',
      plan: deployPlan(),
    });
    const confirmation = shellReducer(loaded, { type: 'deploy.continue' });
    const confirmed = shellReducer(confirmation, { type: 'deploy.toggleWarning' });
    const applying = shellReducer(confirmed, { type: 'deploy.apply' });
    const result = shellReducer(applying, {
      type: 'deploy.applied',
      result: {
        schemaVersion: 3,
        operation: 'deploy',
        status: 'succeeded',
        repositoryPath: '/Users/张涛/Configuration Repository',
        changes: [],
        linkOutcomes: [{
          status: 'satisfied-via-link',
          ownership: 'managed',
          scope: 'skill-package',
          owner: 'ide',
          ide: 'claude-code',
          surface: 'claude-code',
          linkPath: '/Users/张涛/.claude/skills/review',
          linkPaths: ['/Users/张涛/.claude/skills/review'],
          resolvedPath: '/Users/张涛/.agents/skills/review',
          resolvedPaths: ['/Users/张涛/.agents/skills/review'],
          packageNames: ['review'],
          affectedFileCount: 1,
        }],
        issues: [],
        nextActions: [],
        data: {
          appliedChangeIds: [],
          writtenPaths: [],
          deletedPaths: [],
        },
      },
    });

    expect(renderToString(<ShellView state={result} />, { columns: 80 }))
      .toContain('Already satisfied projections: 1');
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
    expect(rendered.review).toContain('1 change(s) to write, 1 change(s) to delete');
    expect(rendered.review).toContain('projection(s)');
    expect(rendered.review).toContain('physical package(s)');
    expect(rendered.review).toContain('[Ordinary file]');
    expect(rendered.review).toContain('> [write] [Ordinary file] /Users/张涛/.codex/config.toml');
    expect(rendered.deleteFocused).toContain('> [delete] [Ordinary file] /Users/张涛/.codex/added.toml');
    expect(rendered.detail).toContain('Focused Restore detail');
    expect(rendered.detail).toContain('Action: delete');
    expect(rendered.detail).toContain('Layout: Ordinary file');
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
    schemaVersion: 3,
    operation: 'deploy',
    status: 'planned',
    readyToApply: true,
    operationId: 'deploy-view',
    preconditions: {},
    repositoryPath: '/Users/张涛/Configuration Repository',
    scope: 'global',
    targetRoot: '/tmp/home',
    profileIds: ['global'],
    profilesRevision: 'rev-profiles',
    catalogRevision: 'rev-catalog',
    assetIds: ['rule:canonical'],
    changes: [
      {
        id: 'deploy-rules',
        owner: 'ide',
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
        owner: 'ide',
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
        owner: 'ide',
        ide: 'codex',
        surface: 'codex',
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
    linkOutcomes: [],
    linkFacts: [],
    decisions: [],
    issues: [{
      severity: 'warning',
      code: 'deploy.warning',
      confirmationId: 'deploy-warning-test',
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
    owner: 'ide',
    ide: 'codex',
    surface: 'codex',
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
    schemaVersion: 3,
    operation: 'deploy',
    status: 'planned',
    readyToApply: true,
    operationId: 'large-deploy-view',
    preconditions: {},
    repositoryPath: '/Users/张涛/Configuration Repository',
    scope: 'global',
    targetRoot: '/tmp/home',
    profileIds: ['global'],
    profilesRevision: 'rev-profiles',
    catalogRevision: 'rev-catalog',
    assetIds: ['rule:canonical'],
    changes: [...standard, ...advanced],
    linkOutcomes: [],
    linkFacts: [],
    decisions: [],
    issues: [],
    nextActions: [],
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
        nodeKind: 'file',
        layoutKind: 'ordinary-file',
      },
      {
        id: 'restore-added',
        action: 'delete',
        targetPath: '/Users/张涛/.codex/added.toml',
        nodeKind: 'file',
        layoutKind: 'ordinary-file',
      },
    ],
    issues: [],
    nextActions: [],
    ...override,
  } as RestorePlan;
}

function successfulRestoreResult(): RestoreResult {
  return {
    schemaVersion: 3,
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
    schemaVersion: 3,
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
    schemaVersion: 3,
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
    schemaVersion: 3,
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
          code: 'capture.sourceSkipped',
          confirmationId: 'capture-warning-source-skipped',
          message: 'A source item was skipped safely.',
        },
      ]
      : [],
    nextActions: [],
    summary: {
      parameterizedPathCount: 2,
      excludedFileCount: 3,
    },
  };
}

function staleCaptureResult(): CaptureResult {
  return {
    schemaVersion: 3,
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
    schemaVersion: 3,
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
      newUnassignedCount: 0,
      newUnassignedAssetIds: [],
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

function repositoryRecoveryMenuState(): ShellState {
  const report: RepositoryReport = {
    schemaVersion: 3,
    operation: 'repository',
    status: 'reported',
    ready: false,
    repositoryPath: '/tmp/repository',
    repositoryId: 'repository-id',
    repositorySchemaVersion: 1,
    valid: false,
    changes: [],
    issues: [{
      severity: 'error',
      code: 'repository.migrationRequired',
      message: 'Repository schema migration is required.',
    }],
    nextActions: ['Review the Migration Plan.'],
  };
  return shellReducer(createInitialShellState('capture'), {
    type: 'repository.loaded',
    report,
    currentDirectory: report,
    resumeRoute: 'capture',
  });
}

function overviewState(linkOutcomes: StatusReport['linkOutcomes'] = []): ShellState {
  const report: StatusReport = {
    schemaVersion: 3,
    operation: 'status',
    status: 'reported',
    ready: false,
    repositoryPath: '/Users/张涛/Configuration Repository/超长路径',
    repository: {
      path: '/Users/张涛/Configuration Repository/超长路径',
      id: 'repository-id',
      schemaVersion: 3,
      git: {
        branch: 'main',
        clean: false,
        uncommittedChanges: 1_234,
      },
    },
    pendingDeployment: {
      add: 123_456,
      modify: 98_765,
      delete: 4_321,
      total: 226_542,
      recommended: 226_542,
      optional: 0,
      advancedCleanupExcluded: 0,
    },
    postDeployLocalState: {
      unchanged: 10_000,
      drift: 9_876,
      contentDrift: 0,
      topologyDrift: 0,
      missing: 543,
      total: 20_419,
      files: [],
      contentDrifts: [],
      topologyDrifts: [],
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
      linkOutcomes,
      linkFacts: linkFactsFromOutcomes(linkOutcomes),
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

function linkFactsFromOutcomes(
  outcomes: StatusReport['linkOutcomes'],
): StatusReport['linkFacts'] {
  const groups = new Map<string, typeof outcomes>();
  for (const outcome of outcomes) {
    const key = [
      outcome.status,
      outcome.ownership,
      outcome.scope,
      outcome.reason,
      [...outcome.packageNames].sort().join(','),
      [...(outcome.resolvedPaths ?? outcome.linkPaths)].sort().join(','),
    ].join(':');
    groups.set(key, [...(groups.get(key) ?? []), outcome]);
  }
  return [...groups.entries()].map(([key, matching], index) => {
    const first = matching[0];
    const severity = first.status === 'satisfied-via-link'
      ? 'notice' as const
      : first.reason === 'divergent' && first.ownership === 'external'
        ? first.scope === 'skill-package' ? 'decisionRequired' as const : 'warning' as const
        : 'error' as const;
    return {
      id: `test-link-fact-${index}-${key}`,
      status: first.status,
      severity,
      ownership: first.ownership,
      scope: first.scope,
      ...(first.reason ? { reason: first.reason } : {}),
      packageNames: [...new Set(matching.flatMap((item) => item.packageNames))],
      linkPaths: [...new Set(matching.flatMap((item) => item.linkPaths))],
      resolvedPaths: [...new Set(matching.flatMap((item) => item.resolvedPaths ?? []))],
      surfaces: [...new Map(matching.flatMap((item) => item.owner === 'ide'
        ? [[`${item.ide}:${item.surface}`, { ide: item.ide, surface: item.surface }] as const]
        : [])).values()],
      affectedFileCount: first.status === 'blocked'
        ? Math.max(...matching.map((item) => item.affectedFileCount))
        : matching.reduce((total, item) => total + item.affectedFileCount, 0),
    };
  });
}
