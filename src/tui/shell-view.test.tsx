import { renderToString } from 'ink';
import { describe, expect, it } from 'vitest';
import { ShellView } from './shell-view.js';
import {
  createInitialShellState,
  shellReducer,
} from './shell-state.js';

describe('TUI Shell view', () => {
  it('renders an explicit Overview loading state', () => {
    expect(renderToString(
      <ShellView state={createInitialShellState('overview')} />,
    )).toMatchInlineSnapshot(`
      "MCV
      Overview

      Loading Overview...

      e Environment Details   q Quit   Ctrl+C Cancel"
    `);
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

      Failed: Environment probe failed.

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

    const previousNoColor = process.env.NO_COLOR;
    process.env.NO_COLOR = '1';
    const rendered = {
      macos100: renderToString(<ShellView state={overview} />, { columns: 100 }),
      windows120: renderToString(<ShellView state={environment} />, { columns: 120 }),
      narrow44: renderToString(<ShellView state={overview} />, { columns: 44 }),
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

      Repository: /Users/张涛/Configuration Repository/long-path
      Git: 1234 uncommitted changes
      Pending deployment: 226542 changes (123456 add, 98765 modify, 4321 delete)
      Local managed state: 9876 changed, 543 missing
      Environment: 2 missing variables
      IDE support:
        Codex: enabled, detected
        Claude Code: enabled, not detected
        Gemini: disabled, not detected
      Last operation: deploy · failure

      e Environment Details   q Quit   Ctrl+C Cancel",
        "narrow44": "MCV
      Overview

      Repository: /Users/张涛/Configuration
      Repository/long-path
      Git: 1234 uncommitted changes
      Pending deployment: 226542 changes (123456
      add, 98765 modify, 4321 delete)
      Local managed state: 9876 changed, 543
      missing
      Environment: 2 missing variables
      IDE support:
        Codex: enabled, detected
        Claude Code: enabled, not detected
        Gemini: disabled, not detected
      Last operation: deploy · failure

      e Environment Details   q Quit   Ctrl+C
      Cancel",
        "noColorFailure": "MCV
      Overview

      Failed: Repository unavailable.

      e Environment Details   q Quit   Ctrl+C Cancel",
        "windows120": "MCV
      Environment Details

      Codex: detected
        [found] C:\\Users\\张涛\\Configuration Repository\\very-long-directory
        [missing] /Users/张涛/Configuration Repository/very-long-directory/config.toml
      Missing variables: OPENAI_API_KEY

      Escape Overview   q Quit   Ctrl+C Cancel",
      }
    `);
    expect(Object.values(rendered).join('')).not.toMatch(/\u001b\[/);
    expect(Object.values(rendered).join('')).not.toContain('source-secret-value');
  });
});
