import { Box, Text, useWindowSize } from 'ink';
import type { ReactNode } from 'react';
import type { EnvironmentReport } from '../operations/environment.js';
import type {
  CaptureChange,
  CapturePlan,
  CapturePreview,
  CaptureResult,
} from '../operations/capture.js';
import type { StatusReport } from '../operations/status.js';
import type { RepositoryReport } from '../operations/repository.js';
import type {
  DeployLinkOutcome,
  DeployPlan,
  DeployPreview,
  DeployResult,
} from '../operations/deploy.js';
import type {
  RestorePlan,
  RestoreResult,
} from '../operations/restore.js';
import {
  buildDeploySelectionTree,
  flattenDeploySelectionTree,
} from './deploy-selection-tree.js';
import {
  captureDecisionGroups,
  captureWarnings,
  deployWarnings,
  type CaptureWorkflowState,
  type DeployWorkflowState,
  type RepositoryMenuAction,
  type RepositoryOperation,
  type RepositoryPlan,
  type RepositoryWorkflowState,
  type RestoreWorkflowState,
  type ShellState,
} from './shell-state.js';
import {
  PRIMARY_DESTINATIONS,
  type PrimaryDestinationId,
} from './overview-navigation.js';
import {
  statusToneStyle,
  type StatusTone,
} from './status-tone.js';

export interface ShellViewProps {
  state: ShellState;
  terminalColumns?: number;
  terminalRows?: number;
}

export function ShellView({
  state,
  terminalColumns,
  terminalRows,
}: ShellViewProps): ReactNode {
  const windowSize = useWindowSize();
  const columns = terminalColumns ?? windowSize.columns;
  const rows = terminalRows ?? windowSize.rows;
  const { page } = state;
  const title = pageTitle(state);
  const controls = pageControls(state, rows);
  const compactOverview = page.status === 'ready'
    && page.route === 'overview'
    && rows <= 16;
  const scrollable = isScrollablePage(state);
  const contentRows = pageContentRows(state, rows, columns);
  return (
    <Box flexDirection="column">
      {!compactOverview && (
        <>
          <Text bold>MCV</Text>
          <Text>{title}</Text>
          <Text> </Text>
        </>
      )}
      <Box
        flexDirection="column"
        maxHeight={scrollable ? contentRows : undefined}
        overflowY={scrollable ? 'hidden' : undefined}
      >
        <Box
          flexDirection="column"
          marginTop={scrollable ? -state.scrollOffset : undefined}
        >
          {page.status === 'loading' && (
            <StatusLine tone="info" label="Loading">
              {title}...
            </StatusLine>
          )}
          {page.status === 'failure' && (
            <StatusLine tone="error" label="Error">
              {page.message}
            </StatusLine>
          )}
          {page.status === 'ready' && page.route === 'overview' && (
            <Overview
              report={page.report}
              focusId={state.overviewFocusId}
              terminalColumns={columns}
              terminalRows={rows}
            />
          )}
          {page.status === 'ready' && page.route === 'repository' && (
            page.workflow.status === 'result'
              ? <ScrollablePageContent state={state} />
              : (
                <RepositoryWorkflow
                  workflow={page.workflow}
                  latestResult={state.repositoryResult}
                />
              )
          )}
          {page.status === 'ready' && page.route === 'environment' && (
            <ScrollablePageContent state={state} />
          )}
          {page.status === 'ready' && page.route === 'help' && (
            <ScrollablePageContent state={state} />
          )}
          {page.status === 'ready' && page.route === 'capture' && (
            page.workflow.status === 'result'
              ? <ScrollablePageContent state={state} />
              : (
                <CaptureWorkflow
                  workflow={page.workflow}
                  terminalRows={rows}
                />
              )
          )}
          {page.status === 'ready' && page.route === 'deploy' && (
            page.workflow.status === 'result'
              ? <ScrollablePageContent state={state} />
              : (
                <DeployWorkflow
                  workflow={page.workflow}
                  terminalRows={rows}
                />
              )
          )}
          {page.status === 'ready' && page.route === 'restore' && (
            page.workflow.status === 'result'
              ? <ScrollablePageContent state={state} />
              : (
                <RestoreWorkflow
                  workflow={page.workflow}
                  terminalRows={rows}
                />
              )
          )}
        </Box>
      </Box>
      {controls && (
        <>
          {!compactOverview && <Text> </Text>}
          <Text dimColor>{controls}</Text>
        </>
      )}
    </Box>
  );
}

function isScrollablePage(state: ShellState): boolean {
  const { page } = state;
  if (page.status !== 'ready') return false;
  if (page.route === 'help' || page.route === 'environment') return true;
  if (page.route === 'overview') return false;
  return page.workflow.status === 'result';
}

export function maximumPageScrollOffset(
  state: ShellState,
  terminalRows: number,
  terminalColumns: number,
): number {
  if (!isScrollablePage(state)) return 0;
  const renderedLines = scrollablePageLines(state).reduce(
    (total, line) =>
      total + wrappedLineCount(line.text, Math.max(1, terminalColumns)),
    0,
  );
  return Math.max(
    0,
    renderedLines - pageContentRows(state, terminalRows, terminalColumns),
  );
}

function pageContentRows(
  state: ShellState,
  terminalRows: number,
  terminalColumns: number,
): number {
  const controls = pageControls(state, terminalRows);
  const compactOverview = state.page.status === 'ready'
    && state.page.route === 'overview'
    && terminalRows <= 16;
  return Math.max(
    1,
    terminalRows
      - (compactOverview ? 0 : 4)
      - (controls
        ? wrappedLineCount(controls, Math.max(1, terminalColumns))
        : 0),
  );
}

function wrappedLineCount(value: string, columns: number): number {
  return value.split('\n').reduce(
    (total, line) => total + wrappedParagraphLineCount(line, columns),
    0,
  );
}

function wrappedParagraphLineCount(value: string, columns: number): number {
  if (value.length === 0) return 1;
  const tokens = value.match(/\s+|\S+/gu) ?? [];
  let lines = 1;
  let width = 0;
  for (const token of tokens) {
    const tokenWidth = textWidth(token);
    if (/^\s+$/u.test(token)) {
      for (const character of token) {
        const characterWidth = textWidth(character);
        if (width + characterWidth > columns) {
          lines += 1;
          width = characterWidth;
        } else {
          width += characterWidth;
        }
      }
      continue;
    }
    if (tokenWidth <= columns && width + tokenWidth <= columns) {
      width += tokenWidth;
      continue;
    }
    if (width > 0) {
      lines += 1;
      width = 0;
    }
    const fullWordLines = Math.floor(tokenWidth / columns);
    lines += fullWordLines;
    width = tokenWidth % columns;
    if (width === 0) {
      lines -= 1;
      width = columns;
    }
  }
  return lines;
}

function textWidth(value: string): number {
  return Array.from(value).reduce(
    (width, character) =>
      width + (character.codePointAt(0)! > 0xff ? 2 : 1),
    0,
  );
}

interface ScrollablePageLine {
  key: string;
  text: string;
  color?: 'green' | 'yellow' | 'red';
  tone?: StatusTone;
}

function scrollablePageLines(state: ShellState): ScrollablePageLine[] {
  const { page } = state;
  if (page.status !== 'ready') return [];
  if (page.route === 'help') {
    return pageLines('help', [
      'Primary navigation:',
      '  Overview',
      '  Capture',
      '  Deploy',
      '  Restore Latest Deployment',
      '  Repository',
      '  Help',
      ' ',
      'Direct commands open the same Shell when attached to a terminal.',
      'Use --dry-run, --yes, --plain, or --json for one-shot output.',
    ]);
  }
  if (page.route === 'environment') {
    return pageLines('environment', [
      ...page.report.environments.flatMap((environment) => [
        `${environment.name}: ${environment.detected ? 'detected' : 'not detected'}`,
        ...[
          ...environment.configDirectories,
          ...environment.configFiles,
        ].map((item) =>
          `  [${item.exists ? 'found' : 'missing'}] ${item.path}`),
      ]),
      ...(page.report.missingVariables.length > 0
        ? [`Missing variables: ${page.report.missingVariables.join(', ')}`]
        : []),
    ]);
  }
  if (page.route === 'overview') return [];
  if (page.route === 'repository') {
    if (page.workflow.status !== 'result') return [];
    const { operation, result } = page.workflow.step;
    if (result.status === 'succeeded') {
      return statusPageLines('repository-success', 'success', [
        `Succeeded: ${operationLabel(operation)} completed.`,
      ]);
    }
    const message = result.status === 'failed'
      ? result.error.message
      : result.issues[0]?.message ?? 'The operation was blocked.';
    return statusPageLines(
      result.status === 'blocked'
        ? 'repository-blocked'
        : 'repository-failure',
      'error',
      [
      result.status === 'blocked'
        ? `Blocked: ${operationLabel(operation)} did not change Repository state: ${message}`
        : `Failed: ${operationLabel(operation)}: ${message}`,
      ...result.nextActions.map((action) => `Next: ${action}`),
      ],
    );
  }
  if (page.workflow.status !== 'result') return [];
  if (page.route === 'capture') {
    const result = page.workflow.result;
    if (result.status === 'succeeded') {
      return statusPageLines('capture-success', 'success', [
        'Succeeded: Capture completed.',
        `Applied: ${result.data?.appliedChangeIds.length ?? 0} changes`,
        `Written: ${result.data?.writtenPaths.length ?? 0} paths`,
        `Deleted: ${result.data?.deletedPaths.length ?? 0} paths`,
        ...result.issues.map((issue) => `Warning: ${issue.message}`),
      ], (index) => index >= 4 ? 'warning' : undefined);
    }
    if (result.status === 'blocked') {
      return statusPageLines('capture-blocked', 'error', [
        'Blocked: Capture did not change the Repository.',
        ...result.issues.map((issue) => issue.message),
      ]);
    }
    return statusPageLines('capture-failed', 'error', [
      `Failed: ${result.error.message}`,
      'Repository transaction was not completed.',
    ]);
  }
  if (page.route === 'deploy') {
    const result = page.workflow.result;
    if (result.status === 'succeeded') {
      const skillChanges = result.changes.filter((change) => change.capability === 'skills');
      const managedLinks = skillChanges.filter(
        (change) => change.deploymentKind === 'managed-link-projection',
      );
      const migrations = skillChanges.filter(
        (change) => change.deploymentKind === 'topology-migration',
      );
      const copies = skillChanges.filter(
        (change) => change.deploymentKind === 'copy-projection',
      );
      const satisfied = result.linkOutcomes?.filter((outcome) =>
        outcome.status === 'satisfied-via-link' && outcome.ownership === 'managed') ?? [];
      const surfaceLabel = (
        target: { owner: 'canonical-store' | 'ide'; ide?: string },
      ): string => {
        if (target.owner === 'canonical-store') return 'Canonical Device Skill Store';
        if (target.ide === 'claude-code') return 'Claude Code';
        if (target.ide === 'gemini-cli') return 'Gemini CLI';
        if (target.ide === 'antigravity') return 'Antigravity';
        return target.ide
          ? target.ide.charAt(0).toUpperCase() + target.ide.slice(1)
          : 'Unknown';
      };
      const listSurfaces = (
        items: Array<{ owner: 'canonical-store' | 'ide'; ide?: string }>,
      ): string => {
        const names = [...new Set(items.map(surfaceLabel))].sort();
        return names.length === 0 ? '' : ` (${names.join(', ')})`;
      };
      return pageLines('deploy-success', [
        'Deploy succeeded.',
        `Applied: ${result.data?.appliedChangeIds.length ?? 0} changes`,
        `Written: ${result.data?.writtenPaths.length ?? 0} paths`,
        `Deleted: ${result.data?.deletedPaths.length ?? 0} paths`,
        `Managed-link projections: ${managedLinks.length}${listSurfaces(managedLinks)}`,
        `Topology migrations: ${migrations.length}${listSurfaces(migrations)}`,
        `Copy projections: ${copies.length}${listSurfaces(copies)}`,
        ...(satisfied.length > 0
          ? [`Already satisfied projections: ${satisfied.length}${listSurfaces(satisfied)}`]
          : []),
      ], (index) => index === 0 ? 'green' : undefined);
    }
    if (result.status === 'blocked') {
      return pageLines('deploy-blocked', [
        'Deploy was blocked; device configuration was not changed.',
        ...result.issues.map((issue) => issue.message),
      ], (index) => index === 0 ? 'yellow' : undefined);
    }
    return pageLines('deploy-failed', [
      `Deploy failed: ${result.error.message}`,
      ...result.nextActions.map((action) => `Next: ${action}`),
    ], (index) => index === 0 ? 'red' : undefined);
  }
  const result = page.workflow.result;
  if (result.status === 'succeeded') {
    return pageLines('restore-success', [
      'Restore succeeded.',
      `Written: ${result.data?.restoredPaths.length ?? 0} paths`,
      `Deleted: ${result.data?.deletedPaths.length ?? 0} paths`,
      `Pre-restore backup: ${result.data?.backupPath}`,
    ], (index) => index === 0 ? 'green' : undefined);
  }
  if (result.status === 'blocked') {
    return pageLines('restore-blocked', [
      'Restore was blocked; device configuration was not changed.',
      ...result.issues.map((issue) => `${issue.code}: ${issue.message}`),
    ], (index) => index === 0 ? 'yellow' : undefined);
  }
  return pageLines('restore-failed', [
    `Restore failed: ${result.error.message}`,
    `Error code: ${result.error.code}`,
    ...result.nextActions.map((action) => `Next: ${action}`),
  ], (index) => index === 0 ? 'red' : undefined);
}

function pageLines(
  prefix: string,
  texts: string[],
  colorForIndex: (
    index: number,
  ) => ScrollablePageLine['color'] = () => undefined,
): ScrollablePageLine[] {
  return texts.map((text, index) => ({
    key: `${prefix}:${index}`,
    text,
    color: colorForIndex(index),
  }));
}

function statusPageLines(
  prefix: string,
  tone: StatusTone,
  texts: string[],
  toneForIndex: (index: number) => StatusTone | undefined = () => undefined,
): ScrollablePageLine[] {
  return texts.map((text, index) => ({
    key: `${prefix}:${index}`,
    text,
    tone: index === 0 ? tone : toneForIndex(index),
  }));
}

function ScrollablePageContent({
  state,
}: {
  state: ShellState;
}): ReactNode {
  return (
    <Box flexDirection="column">
      {scrollablePageLines(state).map((line) => (
        line.tone
          ? (
            <Text
              key={line.key}
              color={statusToneStyle(line.tone).color}
              dimColor={statusToneStyle(line.tone).dimColor}
              wrap="wrap"
            >
              {statusToneStyle(line.tone).symbol} {line.text}
            </Text>
          )
          : (
            <Text key={line.key} color={line.color} wrap="wrap">
              {line.text}
            </Text>
          )
      ))}
    </Box>
  );
}

function pageTitle(state: ShellState): string {
  const { page } = state;
  if (page.route === 'repository') {
    if (page.status !== 'ready') return 'Repository';
    switch (page.workflow.status) {
      case 'menu': return 'Repository';
      case 'path': return 'Repository · Enter Existing Path';
      case 'plan': return `Repository · ${operationLabel(page.workflow.step.operation)} Plan`;
      case 'applying': return `Repository · Applying ${operationLabel(page.workflow.step.operation)}`;
      case 'result': return `Repository · ${operationLabel(page.workflow.step.operation)} Result`;
    }
  }
  if (page.route === 'overview') return 'Overview';
  if (page.route === 'help') return 'Help';
  if (page.route === 'environment') return 'Environment Details';
  if (page.route === 'deploy') {
    if (page.status !== 'ready') return 'Deploy';
    switch (page.workflow.status) {
      case 'selection': return 'Deploy · Select Changes';
      case 'diff': return 'Deploy · Diff';
      case 'confirmation': return 'Deploy · Confirm Apply';
      case 'applying': return 'Deploy · Applying';
      case 'regenerating': return 'Deploy · Regenerating';
      case 'result': return 'Deploy · Result';
    }
  }
  if (page.route === 'restore') {
    if (page.status !== 'ready') return 'Restore Latest Deployment';
    switch (page.workflow.status) {
      case 'review': return 'Restore Latest Deployment · Review';
      case 'applying': return 'Restore Latest Deployment · Applying';
      case 'regenerating': return 'Restore Latest Deployment · Regenerating';
      case 'result': return 'Restore Latest Deployment · Result';
    }
  }
  if (page.status !== 'ready') return 'Capture';
  switch (page.workflow.status) {
    case 'selection': return 'Capture · Select Changes';
    case 'diff': return 'Capture · Diff';
    case 'decision': return 'Capture · Resolve Decisions';
    case 'confirmation': return 'Capture · Confirm Apply';
    case 'applying': return 'Capture · Applying';
    case 'regenerating': return 'Capture · Regenerating';
    case 'result': return 'Capture · Result';
  }
}

function pageControls(
  state: ShellState,
  terminalRows: number,
): string | undefined {
  const { page } = state;
  if (page.route === 'repository') {
    if (page.status !== 'ready') return 'q Quit   Ctrl+C Cancel';
    switch (page.workflow.status) {
      case 'menu':
        return '↑↓ Move   →/Enter Open   ←/Escape Overview   q Quit   Ctrl+C Cancel';
      case 'path':
        return 'Type path   Enter Review Bind   ←/Escape Back   Ctrl+C Cancel';
      case 'plan':
        return page.workflow.step.plan.status === 'planned'
          ? 'Enter Apply   ←/Escape Back   Ctrl+C Cancel'
          : '←/Escape Back   Ctrl+C Cancel';
      case 'applying':
        return undefined;
      case 'result':
        return '↑↓ Scroll   Enter/←/Escape Refresh Overview   q Quit';
    }
  }
  if (page.status !== 'ready') {
    return page.route === 'overview'
      ? primaryNavigationControls()
      : page.route === 'environment'
        ? 'Escape Overview   q Quit   Ctrl+C Cancel'
        : 'q Quit   Ctrl+C Cancel';
  }
  if (page.route === 'overview') {
    return primaryNavigationControls();
  }
  if (page.route === 'help') {
    return '↑↓ Scroll   ←/Escape Overview   q Quit   Ctrl+C Cancel';
  }
  if (page.route === 'environment') {
    return state.postInitOnboarding
      ? '↑↓ Scroll   Enter Continue to Capture   ←/Escape Overview   q Quit   Ctrl+C Cancel'
      : '↑↓ Scroll   ←/Escape Overview   q Quit   Ctrl+C Cancel';
  }
  if (page.route === 'deploy') {
    switch (page.workflow.status) {
      case 'selection':
        return terminalRows <= 12
          ? '↑↓/Pg Move   ← Back   → Open   Space Select   Enter Review   q Quit'
          : [
            '↑↓ Move   ← Collapse/Back   → Expand/Diff   Space Select   PgUp/PgDn Page   Home/End   Enter Review   q Quit   Ctrl+C Cancel',
            'Accelerators: d Diff   a Cleanup',
          ].join('\n');
      case 'diff':
        return '←/Escape Close Diff   q Quit   Ctrl+C Cancel';
      case 'confirmation':
        return terminalRows <= 12
          ? '↑↓/Pg Move   Home/End   Space Confirm   Enter Apply   ← Back   q Quit'
          : '↑↓/Pg Move   Home/End   Space Confirm Warning   Enter Apply   ←/Escape Back   q Quit   Ctrl+C Cancel';
      case 'applying':
      case 'regenerating':
        return undefined;
      case 'result':
        return '↑↓ Scroll   Enter/← Refresh Overview   q Quit';
    }
  }
  if (page.route === 'restore') {
    switch (page.workflow.status) {
      case 'review':
        if (page.workflow.detailChangeId) {
          return '←/Escape Close Detail   q Quit   Ctrl+C Cancel';
        }
        return page.workflow.plan.status === 'planned'
          && page.workflow.plan.readyToApply
          ? '↑↓ Browse   → Detail   Enter Apply   ←/Escape Overview   q Quit   Ctrl+C Cancel'
          : '↑↓ Browse   → Detail   ←/Escape Overview   q Quit   Ctrl+C Cancel';
      case 'applying':
      case 'regenerating':
        return undefined;
      case 'result':
        return '↑↓ Scroll   Enter/← Refresh Overview   q Quit';
    }
  }
  switch (page.workflow.status) {
    case 'selection':
      return terminalRows <= 12
        ? '↑↓/PgUp/PgDn Move   Home/End   ← Back   → Diff   Space Select   Enter Review   q Quit'
        : '↑↓ Move   PgUp/PgDn Page   Home/End   ← Back   → Diff   Space Select   Enter Review   q Quit   Ctrl+C Cancel';
    case 'diff':
      return '←/Escape Close Diff   q Quit   Ctrl+C Cancel';
    case 'decision':
      return terminalRows <= 12
        ? '↑↓/Pg Move   Home/End   ← Back   → Next   Space Choose   q Quit'
        : '↑↓/Pg Move   Home/End   ← Back   →/Enter Next   Space Choose   q Quit   Ctrl+C Cancel';
    case 'confirmation':
      return terminalRows <= 12
        ? '↑↓/Pg Move   Home/End   Space Confirm   Enter Apply   ← Back   q Quit'
        : '↑↓/Pg Move   Home/End   Space Confirm Warning   Enter Apply   ←/Escape Back   q Quit   Ctrl+C Cancel';
    case 'applying':
      return undefined;
    case 'regenerating':
      return undefined;
    case 'result':
      return '↑↓ Scroll   Enter/← Refresh Overview   q Quit';
  }
}

function primaryNavigationControls(): string {
  return [
    '↑↓ Move   →/Enter Open   q Quit   Ctrl+C Cancel',
    'Accelerators: c Capture   d Deploy   s Restore   r Repository   h Help',
  ].join('\n');
}

function RepositoryWorkflow({
  workflow,
  latestResult,
}: {
  workflow: RepositoryWorkflowState;
  latestResult?: ShellState['repositoryResult'];
}): ReactNode {
  if (workflow.status === 'menu') {
    const report = workflow.report.repositoryPath
      ? workflow.report
      : workflow.currentDirectory;
    const focusStyle = statusToneStyle('info');
    return (
      <Box flexDirection="column">
        <RepositoryIdentity report={report} />
        {latestResult?.result.status === 'succeeded' && (
          <StatusLine tone="success" label="Succeeded">
            {operationLabel(latestResult.operation)} completed.
          </StatusLine>
        )}
        {workflow.report.repositoryPath && !workflow.report.valid && (
          <StatusLine tone="error" label="Blocked">
            Repository writes are blocked until the binding is recovered.
          </StatusLine>
        )}
        <Text> </Text>
        {workflow.actions.map((action, index) => {
          const focused = index === workflow.cursor;
          return (
            <Text
              key={action}
              color={focused ? focusStyle.color : undefined}
            >
              {focused ? '›' : ' '}{' '}
              {repositoryActionLabel(action, workflow.resumeRoute)}
            </Text>
          );
        })}
      </Box>
    );
  }
  if (workflow.status === 'path') {
    return (
      <Box flexDirection="column">
        <StatusLine tone="info" label="Input">
          Enter the path to an existing MCV Repository:
        </StatusLine>
        <Text>{'> '}{workflow.value}</Text>
      </Box>
    );
  }
  if (workflow.status === 'applying') {
    return (
      <StatusLine tone="info" label="Applying">
        Reviewed {operationLabel(workflow.step.operation)} Plan...
      </StatusLine>
    );
  }
  if (workflow.status === 'result') {
    const { operation, result } = workflow.step;
    if (result.status === 'succeeded') {
      return <Text color="green">{operationLabel(operation)} succeeded.</Text>;
    }
    const message = result.status === 'failed'
      ? result.error.message
      : result.issues[0]?.message ?? 'The operation was blocked.';
    return (
      <Box flexDirection="column">
        <Text color="red">
          {operationLabel(operation)} failed: {message}
        </Text>
        {result.nextActions.map((action) => (
          <Text key={action}>Next: {action}</Text>
        ))}
      </Box>
    );
  }

  const { operation, plan } = workflow.step;
  const hasError = plan.status === 'failed'
    || plan.issues.some((issue) =>
      issue.severity === 'error'
      || issue.severity === 'decisionRequired');
  const hasWarning = plan.issues.some((issue) => issue.severity === 'warning');
  return (
    <Box flexDirection="column">
      <StatusLine
        tone={hasError ? 'error' : hasWarning ? 'warning' : 'info'}
        label={hasError ? 'Blocked' : hasWarning ? 'Warning' : 'Ready'}
      >
        {operationLabel(operation)} Plan {hasError
          ? 'cannot be applied.'
          : hasWarning
            ? 'requires review.'
            : 'reviewed.'}
      </StatusLine>
      <Text>Repository: {plan.repositoryPath ?? 'not bound'}</Text>
      {operation === 'unbind' && (
        <>
          <StatusLine tone="error" label="Destructive">
            Local binding removal.
          </StatusLine>
          <Text>
            This removes only the local binding. Repository files will not be changed.
          </Text>
        </>
      )}
      {plan.changes.map((change) => (
        <Text key={change.id}>[{change.kind}] {repositoryChangeLabel(change)}</Text>
      ))}
      {plan.issues.map((issue) => (
        <StatusLine
          key={issue.code}
          tone={repositoryIssueTone(issue.severity)}
          label={repositoryIssueLabel(issue.severity)}
        >
          {issue.message}
        </StatusLine>
      ))}
      {plan.status === 'failed' && (
        <Text color="red">Apply disabled until the Repository selection is fixed.</Text>
      )}
    </Box>
  );
}

function RepositoryIdentity({
  report,
}: {
  report: RepositoryReport;
}): ReactNode {
  const hasError = report.issues.some((issue) => issue.severity === 'error');
  const hasWarning = report.issues.some((issue) => issue.severity === 'warning');
  return (
    <Box flexDirection="column">
      <StatusLine
        tone={report.valid ? 'success' : hasError ? 'error' : hasWarning ? 'warning' : 'muted'}
        label={report.valid ? 'Valid' : hasError ? 'Blocked' : hasWarning ? 'Warning' : 'Unavailable'}
      >
        Repository {report.valid ? 'is ready.' : 'is not ready.'}
      </StatusLine>
      <Text>Path: {report.repositoryPath ?? 'not bound'}</Text>
      <Text>Repository ID: {report.repositoryId ?? 'unknown'}</Text>
      <Text>Schema: {report.repositorySchemaVersion ?? 'unknown'}</Text>
      {report.git && (
        <Text>
          Git: {report.git.clean ? 'clean' : `${report.git.uncommittedChanges} uncommitted changes`}
          {report.git.branch ? ` (${report.git.branch})` : ''}
        </Text>
      )}
      {report.issues.map((issue) => (
        <StatusLine
          key={issue.code}
          tone={repositoryIssueTone(issue.severity)}
          label={repositoryIssueLabel(issue.severity)}
        >
          {issue.message}
        </StatusLine>
      ))}
    </Box>
  );
}

function repositoryIssueTone(
  severity: RepositoryReport['issues'][number]['severity'],
): StatusTone {
  if (severity === 'notice') return 'info';
  return severity === 'warning' ? 'warning' : 'error';
}

function repositoryIssueLabel(
  severity: RepositoryReport['issues'][number]['severity'],
): string {
  if (severity === 'notice') return 'Notice';
  return severity === 'warning' ? 'Warning' : 'Blocked';
}

function repositoryActionLabel(
  action: RepositoryMenuAction,
  resumeRoute: Exclude<ShellState['page']['route'], 'repository'>,
): string {
  switch (action) {
    case 'continue':
      return resumeRoute === 'capture'
        ? 'Continue to Capture'
        : resumeRoute === 'deploy'
          ? 'Continue to Deploy'
          : resumeRoute === 'restore'
            ? 'Continue to Restore'
          : 'Continue to Overview';
    case 'bind-current': return 'Bind current repository';
    case 'enter-path': return 'Enter existing path';
    case 'init-here': return 'Initialize here';
    case 'migrate': return 'Review Migration Plan';
    case 'rebind': return 'Rebind moved Repository';
    case 'unbind': return 'Unbind this device';
  }
}

function operationLabel(
  operation: RepositoryOperation,
): string {
  return operation.charAt(0).toUpperCase() + operation.slice(1);
}

function repositoryChangeLabel(
  change: RepositoryPlan['changes'][number],
): string {
  if ('path' in change && typeof change.path === 'string') return change.path;
  if (
    'repositoryPath' in change
    && typeof change.repositoryPath === 'string'
  ) return change.repositoryPath;
  if (
    'targetPath' in change
    && typeof change.targetPath === 'string'
  ) return change.targetPath;
  if (
    'previousRepositoryPath' in change
    && typeof change.previousRepositoryPath === 'string'
  ) {
    return change.previousRepositoryPath;
  }
  return String(change.id ?? 'Repository change');
}

function Overview({
  report,
  focusId,
  terminalColumns,
  terminalRows,
}: {
  report: StatusReport;
  focusId: PrimaryDestinationId;
  terminalColumns: number;
  terminalRows: number;
}): ReactNode {
  if (terminalRows <= 16) {
    return (
      <CompactOverview
        report={report}
        focusId={focusId}
        terminalColumns={terminalColumns}
      />
    );
  }
  const wide = terminalColumns >= 90;

  return (
    <Box flexDirection={wide ? 'row' : 'column'}>
      <Box
        flexDirection="column"
        width={wide ? 32 : undefined}
        flexShrink={0}
      >
        <Text>Navigation</Text>
        <PrimaryNavigation focusId={focusId} />
      </Box>
      {!wide && <Text> </Text>}
      <Box flexDirection="column" flexGrow={1}>
        <Text>Status Overview</Text>
        <OverviewStatus report={report} />
      </Box>
    </Box>
  );
}

function PrimaryNavigation({
  focusId,
}: {
  focusId: PrimaryDestinationId;
}): ReactNode {
  return (
    <>
      {PRIMARY_DESTINATIONS.map((destination) => {
        const focused = destination.id === focusId;
        const focusStyle = statusToneStyle('info');
        return (
          <Text
            key={destination.id}
            color={focused ? focusStyle.color : undefined}
          >
            {focused ? '›' : ' '}{' '}
            {destination.label}
            {'accelerator' in destination
              ? ` (${destination.accelerator})`
              : ''}
          </Text>
        );
      })}
    </>
  );
}

function OverviewStatus({ report }: { report: StatusReport }): ReactNode {
  const status = createOverviewStatusViewModel(report);

  return (
    <>
      <StatusLine tone={status.repository.tone} label={status.repository.label}>
        {statusItemText(status.repository)}
      </StatusLine>
      <Text wrap="wrap">{'  '}Path: {report.repository.path}</Text>
      {status.git && (
        <StatusLine tone={status.git.tone} label={status.git.label}>
          {statusItemText(status.git)}
        </StatusLine>
      )}
      <StatusLine tone={status.pending.tone} label={status.pending.label}>
        {statusItemText(status.pending)}
      </StatusLine>
      {status.linkedSkills.map((item) => (
        <StatusLine key={item.key} tone={item.tone} label={item.label}>
          {statusItemText(item)}
        </StatusLine>
      ))}
      <StatusLine tone={status.drift.tone} label={status.drift.label}>
        {statusItemText(status.drift)}
      </StatusLine>
      {status.contentDrifts.map((item) => (
        <StatusLine key={item.key} tone={item.tone} label={item.label}>
          {statusItemText(item)}
        </StatusLine>
      ))}
      {status.topologyDrifts.map((item) => (
        <StatusLine key={item.key} tone={item.tone} label={item.label}>
          {statusItemText(item)}
        </StatusLine>
      ))}
      <StatusLine tone={status.environment.tone} label={status.environment.label}>
        {statusItemText(status.environment)}
      </StatusLine>
      <Text>IDE support:</Text>
      {status.ideSupport.map((ide) => (
        <StatusLine
          key={ide.key}
          tone={ide.tone}
          label={ide.label}
          indent={2}
        >
          {statusItemText(ide)}
        </StatusLine>
      ))}
      <StatusLine tone={status.lastOperation.tone} label={status.lastOperation.label}>
        {statusItemText(status.lastOperation)}
      </StatusLine>
      {status.issues.map((issue) => (
        <StatusLine
          key={issue.key}
          tone={issue.tone}
          label={issue.label}
        >
          {statusItemText(issue)}
        </StatusLine>
      ))}
    </>
  );
}

function CompactOverview({
  report,
  focusId,
  terminalColumns,
}: {
  report: StatusReport;
  focusId: PrimaryDestinationId;
  terminalColumns: number;
}): ReactNode {
  const status = createOverviewStatusViewModel(report);
  const pathLength = Math.max(16, Math.min(48, terminalColumns - 28));

  return (
    <Box flexDirection="column">
      <Text wrap="wrap">
        Navigation:
        {PRIMARY_DESTINATIONS.map((destination) => {
          const focused = destination.id === focusId;
          const style = statusToneStyle('info');
          return (
            <Text
              key={destination.id}
              color={focused ? style.color : undefined}
            >
              {'  '}{focused ? '› ' : ''}{destination.label}
              {'accelerator' in destination
                ? ` (${destination.accelerator})`
                : ''}
            </Text>
          );
        })}
      </Text>
      <Text>Status Overview</Text>
      <StatusLine tone={status.repository.tone} label={status.repository.label}>
        {statusItemText(status.repository)} · Path: {truncateLeading(report.repository.path, pathLength)}
      </StatusLine>
      {status.git && (
        <StatusLine tone={status.git.tone} label={status.git.label}>
          {statusItemText(status.git)}
        </StatusLine>
      )}
      <StatusLine tone={status.pending.tone} label={status.pending.label}>
        {statusItemText(status.pending)}
      </StatusLine>
      {status.linkedSkills.length > 0 && (
        <Text wrap="wrap">
          {status.linkedSkills.map((item) => (
            <StatusFragment key={item.key} tone={item.tone} prefix="  ">
              {item.label}: {statusItemText(item)}
            </StatusFragment>
          ))}
        </Text>
      )}
      <Text wrap="wrap">
        <StatusFragment tone={status.drift.tone}>
          {status.drift.label}: {statusItemText(status.drift)}
        </StatusFragment>
        {'  '}
        <StatusFragment tone={status.environment.tone}>
          {status.environment.label}: {statusItemText(status.environment)}
        </StatusFragment>
      </Text>
      <Text wrap="wrap">
        IDE:
        {status.ideSupport.map((ide) => (
          <StatusFragment
            key={ide.key}
            tone={ide.tone}
            prefix="  "
          >
            {ide.label}: {statusItemText(ide, false)}
          </StatusFragment>
        ))}
      </Text>
      <Text wrap="wrap">
        <StatusFragment tone={status.lastOperation.tone}>
          {status.lastOperation.label}: {statusItemText(status.lastOperation)}
        </StatusFragment>
        {status.issues.map((issue) => (
          <StatusFragment
            key={issue.key}
            tone={issue.tone}
            prefix="  "
          >
            {issue.label}: {statusItemText(issue, false)}
          </StatusFragment>
        ))}
      </Text>
    </Box>
  );
}

interface OverviewStatusItem {
  key: string;
  tone: StatusTone;
  label: string;
  state: string;
  details?: string;
}

interface OverviewStatusViewModel {
  repository: OverviewStatusItem;
  git?: OverviewStatusItem;
  pending: OverviewStatusItem;
  linkedSkills: OverviewStatusItem[];
  drift: OverviewStatusItem;
  contentDrifts: OverviewStatusItem[];
  topologyDrifts: OverviewStatusItem[];
  environment: OverviewStatusItem;
  ideSupport: OverviewStatusItem[];
  lastOperation: OverviewStatusItem;
  issues: OverviewStatusItem[];
}

function createOverviewStatusViewModel(
  report: StatusReport,
): OverviewStatusViewModel {
  const pending = report.pendingDeployment;
  const local = report.postDeployLocalState;
  const missingVariables = report.environment.missingVariables.length;
  const git = report.repository.git;

  return {
    repository: {
      key: 'repository',
      tone: 'success',
      label: 'Repository',
      state: 'Ready',
    },
    ...(git
      ? {
        git: {
          key: 'git',
          tone: git.clean ? 'success' as const : 'warning' as const,
          label: 'Git',
          state: git.clean ? 'Clean' : 'Changes',
          details: [
            ...(!git.clean
              ? [`${git.uncommittedChanges} uncommitted changes`]
              : []),
            ...(git.branch ? [git.branch] : []),
          ].join(' · ') || undefined,
        },
      }
      : {}),
    pending: {
      key: 'pending',
      tone: pending.total > 0 ? 'warning' : 'muted',
      label: 'Pending Deployment Changes',
      state: pending.total > 0 ? 'Review' : 'None',
      details: `${pending.total} changes (${pending.add} add, ${pending.modify} modify, ${pending.delete} delete)`,
    },
    linkedSkills: summarizeLinkOutcomes(report.linkOutcomes).map((summary) => ({
      key: `linked-skills:${summary.key}`,
      tone: summary.status === 'satisfied-via-link' ? 'info' : 'error',
      label: 'Linked Skills',
      state: summary.outcomeCount === 1
        ? summary.state
        : `${summary.outcomeCount} ${summary.state.toLowerCase()} outcomes`,
      details: `${displaySkillSurface(summary.surface)} · ${summary.ownership === 'managed' ? 'Managed' : 'External'} · ${summary.packageCount} ${summary.packageCount === 1 ? 'package' : 'packages'} · ${summary.affectedFileCount} affected ${summary.affectedFileCount === 1 ? 'file' : 'files'}`,
    })),
    drift: {
      key: 'drift',
      tone: local.drift > 0 || local.missing > 0 ? 'warning' : 'success',
      label: 'Drift',
      state: local.drift > 0 || local.missing > 0 ? 'Review' : 'None',
      details: `${local.contentDrift} content, ${local.topologyDrift} topology, ${local.drift} changed, ${local.missing} missing`,
    },
    contentDrifts: local.contentDrifts.map((entry) => ({
      key: `content-drift:${entry.storePath}`,
      tone: 'warning' as const,
      label: 'Content Drift',
      state: entry.packageName,
      details: 'Canonical Skill package',
    })),
    topologyDrifts: local.topologyDrifts.map((entry) => ({
      key: `topology-drift:${entry.projectionPath}`,
      tone: 'warning' as const,
      label: 'Topology Drift',
      state: entry.reason,
      details: `${displaySkillSurface(entry.surface)} · ${entry.packageName}`,
    })),
    environment: {
      key: 'environment',
      tone: missingVariables > 0 ? 'warning' : 'success',
      label: 'Environment',
      state: missingVariables > 0 ? 'Warning' : 'Ready',
      details: `${missingVariables} missing variables`,
    },
    ideSupport: report.environment.ideSupport.map((ide) => ({
      key: ide.id,
      tone: ide.enabled && ide.detected ? 'success' : 'muted',
      label: ide.name,
      state: ide.enabled
        ? ide.detected ? 'Ready' : 'Not detected'
        : 'Disabled',
      details: `${ide.enabled ? 'enabled' : 'disabled'}, ${ide.detected ? 'detected' : 'not detected'}`,
    })),
    lastOperation: report.lastOperation
      ? {
        key: 'last-operation',
        tone: report.lastOperation.success ? 'success' : 'error',
        label: 'Last operation',
        state: report.lastOperation.success ? 'Succeeded' : 'Failed',
        details: report.lastOperation.kind,
      }
      : {
        key: 'last-operation',
        tone: 'muted',
        label: 'Last operation',
        state: 'None',
      },
    issues: report.issues
      .filter((issue) => !issue.code.startsWith('deploy.skillsLinked.'))
      .map((issue) => ({
      key: issue.code,
      tone: issue.severity === 'error'
        ? 'error'
        : issue.severity === 'notice'
          ? 'info'
          : 'warning',
      label: issue.severity === 'error'
        ? 'Error'
        : issue.severity === 'notice'
          ? 'Info'
          : 'Warning',
      state: issue.code,
      details: issue.message,
      })),
  };
}

interface LinkOutcomeSummary {
  key: string;
  status: DeployLinkOutcome['status'];
  ownership: DeployLinkOutcome['ownership'];
  surface: string;
  state: 'Satisfied via link' | 'Already satisfied projection' | 'Blocked';
  outcomeCount: number;
  packageCount: number;
  affectedFileCount: number;
}

function summarizeLinkOutcomes(
  outcomes: DeployLinkOutcome[],
): LinkOutcomeSummary[] {
  const groups = new Map<string, DeployLinkOutcome[]>();
  for (const outcome of outcomes) {
    const surface = outcome.owner === 'canonical-store' ? 'canonical-store' : outcome.ide;
    const key = `${outcome.ownership}:${outcome.status}:${surface}`;
    const matching = groups.get(key) ?? [];
    matching.push(outcome);
    groups.set(key, matching);
  }
  return [...groups.entries()].map(([key, matching]) => {
    const [ownership, status, surface] = key.split(':') as [
      DeployLinkOutcome['ownership'],
      DeployLinkOutcome['status'],
      string,
    ];
    return {
      key,
      status,
      ownership,
      surface,
      state: status === 'blocked'
        ? 'Blocked' as const
        : ownership === 'managed'
          ? 'Already satisfied projection' as const
          : 'Satisfied via link' as const,
      outcomeCount: matching.length,
      packageCount: matching.reduce(
        (total, outcome) => total + outcome.packageNames.length,
        0,
      ),
      affectedFileCount: matching.reduce(
        (total, outcome) => total + outcome.affectedFileCount,
        0,
      ),
    };
  });
}

function displaySkillSurface(surface: string): string {
  if (surface === 'canonical-store') return 'Canonical Device Skill Store';
  if (surface === 'claude-code') return 'Claude Code';
  if (surface === 'gemini-cli') return 'Gemini CLI';
  if (surface === 'antigravity') return 'Antigravity';
  return surface.charAt(0).toUpperCase() + surface.slice(1);
}

function statusItemText(
  item: OverviewStatusItem,
  includeDetails = true,
): string {
  return includeDetails && item.details
    ? `${item.state} · ${item.details}`
    : item.state;
}

function StatusFragment({
  tone,
  prefix = '',
  children,
}: {
  tone: StatusTone;
  prefix?: string;
  children: ReactNode;
}): ReactNode {
  const style = statusToneStyle(tone);
  return (
    <Text color={style.color} dimColor={style.dimColor}>
      {prefix}{style.symbol} {children}
    </Text>
  );
}

function truncateLeading(value: string, maximumLength: number): string {
  const characters = Array.from(value);
  if (characters.length <= maximumLength) return value;
  return `…${characters.slice(-(maximumLength - 1)).join('')}`;
}

function StatusLine({
  tone,
  label,
  indent = 0,
  children,
}: {
  tone: StatusTone;
  label: string;
  indent?: number;
  children: ReactNode;
}): ReactNode {
  const style = statusToneStyle(tone);
  return (
    <Text color={style.color} dimColor={style.dimColor} wrap="wrap">
      {' '.repeat(indent)}{style.symbol} {label}: {children}
    </Text>
  );
}

function CaptureWorkflow({
  workflow,
  terminalRows,
}: {
  workflow: CaptureWorkflowState;
  terminalRows: number;
}): ReactNode {
  switch (workflow.status) {
    case 'selection':
      return (
        <CaptureSelection
          workflow={workflow}
          terminalRows={terminalRows}
        />
      );
    case 'diff':
      return <CaptureDiff workflow={workflow} />;
    case 'decision':
      return (
        <CaptureDecision
          workflow={workflow}
          terminalRows={terminalRows}
        />
      );
    case 'confirmation':
      return (
        <CaptureConfirmation
          workflow={workflow}
          terminalRows={terminalRows}
        />
      );
    case 'applying':
      return (
        <Box flexDirection="column">
          <StatusLine tone="info" label="Applying">
            {workflow.selectedIds.length} selected changes transactionally...
          </StatusLine>
          <Text> </Text>
          <Text dimColor>Please wait; input is disabled during Apply.</Text>
        </Box>
      );
    case 'regenerating':
      return (
        <Box flexDirection="column">
          <StatusLine tone="warning" label="Review required">
            The Capture Plan became stale. Regenerating a safe preview...
          </StatusLine>
          <Text> </Text>
          <Text dimColor>Please wait.</Text>
        </Box>
      );
    case 'result':
      return null;
  }
}

function CaptureSelection({
  workflow,
  terminalRows,
}: {
  workflow: Extract<CaptureWorkflowState, { status: 'selection' }>;
  terminalRows: number;
}): ReactNode {
  const viewport = listViewport(
    workflow.plan.changes,
    workflow.cursor,
    Math.max(1, terminalRows - (terminalRows <= 12 ? 9 : 10)),
  );

  return (
    <Box flexDirection="column">
      <Text wrap="truncate-middle">
        Repository: {workflow.plan.repositoryPath ?? 'not bound'}
      </Text>
      <Text>
        {workflow.plan.changes.length} changes · {workflow.selectedIds.length} selected
      </Text>
      <Text> </Text>
      {!viewport.combinedIndicator && viewport.hiddenBefore > 0 && (
        <Text dimColor>  … {viewport.hiddenBefore} earlier</Text>
      )}
      {viewport.items.map(({ item: change }, visibleIndex) => {
        const index = viewport.start + visibleIndex;
        const selected = workflow.selectedIds.includes(change.id);
        const destructive = change.change === 'delete';
        const tone: StatusTone = destructive
          ? 'error'
          : selected ? 'success' : 'muted';
        const style = statusToneStyle(tone);
        const label = destructive
          ? 'Destructive'
          : selected ? 'Selected' : 'Unselected';
        return (
          <Text
            key={change.id}
            color={style.color}
            dimColor={style.dimColor}
            wrap="truncate-end"
          >
            {index === workflow.cursor ? '>' : ' '}{' '}
            [{selected ? 'x' : ' '}] {style.symbol} {label} · [{change.change}]{' '}
            {change.name} · {displayGroup(change)}
          </Text>
        );
      })}
      {!viewport.combinedIndicator && viewport.hiddenAfter > 0 && (
        <Text dimColor>  … {viewport.hiddenAfter} more</Text>
      )}
      {viewport.combinedIndicator && (
        <Text dimColor>
          {'  '}… {viewport.hiddenBefore} earlier · {viewport.hiddenAfter} more
        </Text>
      )}
      {workflow.plan.issues.some((issue) => issue.severity === 'error') && (
        <StatusLine tone="error" label="Blocked">
          resolve every error before continuing.
        </StatusLine>
      )}
    </Box>
  );
}

function CaptureDiff({
  workflow,
}: {
  workflow: Extract<CaptureWorkflowState, { status: 'diff' }>;
}): ReactNode {
  const change = workflow.plan.changes.find((item) => item.id === workflow.changeId);
  if (!change) return <Text>Selected Capture change is no longer available.</Text>;
  return (
    <Box flexDirection="column">
      <Text>{change.name} · {change.change}</Text>
      {change.previews.map((preview) => (
        <CapturePreviewView
          key={`${change.id}:${preview.repositoryPath}`}
          preview={preview}
        />
      ))}
      {change.previews.length === 0 && <Text>No content preview is available.</Text>}
    </Box>
  );
}

function CapturePreviewView({
  preview,
}: {
  preview: CapturePreview;
}): ReactNode {
  if (preview.kind === 'binary') {
    return (
      <Box flexDirection="column">
        <Text>{preview.repositoryPath}</Text>
        <Text>
          {'  '}binary · {preview.bytes} bytes · sha256 {preview.sha256}
        </Text>
      </Box>
    );
  }
  return (
    <Box flexDirection="column">
      <Text>{preview.repositoryPath}</Text>
      {preview.diff.split('\n').map((line, index) => (
        <Text key={`${preview.repositoryPath}:${index}`}>{'  '}{line}</Text>
      ))}
    </Box>
  );
}

function CaptureDecision({
  workflow,
  terminalRows,
}: {
  workflow: Extract<CaptureWorkflowState, { status: 'decision' }>;
  terminalRows: number;
}): ReactNode {
  const groups = captureDecisionGroups(workflow.plan);
  const choices = groups[workflow.groupIndex] ?? [];
  const groupName = choices[0]?.name ?? 'required choice';
  const selected = choices.some((choice) => workflow.selectedIds.includes(choice.id));
  const viewport = listViewport(
    choices,
    workflow.cursor,
    Math.max(1, terminalRows - (terminalRows <= 12 ? 8 : 10)),
  );
  return (
    <Box flexDirection="column">
      <Text>Decision {workflow.groupIndex + 1}/{groups.length}: {groupName}</Text>
      {!viewport.combinedIndicator && viewport.hiddenBefore > 0 && (
        <Text dimColor>  … {viewport.hiddenBefore} earlier</Text>
      )}
      {viewport.items.map(({ item: choice }, index) => (
        <CaptureChoiceLine
          key={choice.id}
          choice={choice}
          focused={viewport.start + index === workflow.cursor}
          selected={workflow.selectedIds.includes(choice.id)}
        />
      ))}
      {!viewport.combinedIndicator && viewport.hiddenAfter > 0 && (
        <Text dimColor>  … {viewport.hiddenAfter} more</Text>
      )}
      {viewport.combinedIndicator && (
        <Text dimColor>
          {'  '}… {viewport.hiddenBefore} earlier · {viewport.hiddenAfter} more
        </Text>
      )}
      {!selected && (
        <>
          <Text> </Text>
          <StatusLine tone="error" label="Blocked">
            choose exactly one option before continuing.
          </StatusLine>
        </>
      )}
    </Box>
  );
}

function CaptureChoiceLine({
  choice,
  focused,
  selected,
}: {
  choice: CaptureChange;
  focused: boolean;
  selected: boolean;
}): ReactNode {
  const style = statusToneStyle(selected ? 'success' : 'muted');
  return (
    <Text color={style.color} dimColor={style.dimColor}>
      {focused ? '>' : ' '}{' '}
      [{selected ? 'x' : ' '}] {style.symbol} {selected ? 'Selected' : 'Unselected'} ·{' '}
      {choice.sourceLabel ?? choice.name}
    </Text>
  );
}

function CaptureConfirmation({
  workflow,
  terminalRows,
}: {
  workflow: Extract<CaptureWorkflowState, { status: 'confirmation' }>;
  terminalRows: number;
}): ReactNode {
  const warnings = captureWarnings(workflow.plan);
  const allConfirmed = warnings.every((warning) =>
    workflow.confirmedIssueCodes.includes(warning.code));
  const viewport = listViewport(
    warnings,
    workflow.warningCursor,
    Math.max(1, terminalRows - (terminalRows <= 12 ? 8 : 10)),
  );
  return (
    <Box flexDirection="column">
      <Text>{workflow.selectedIds.length} selected changes</Text>
      {warnings.length > 0 && <Text>Warnings require explicit confirmation:</Text>}
      {!viewport.combinedIndicator && viewport.hiddenBefore > 0 && (
        <Text dimColor>  … {viewport.hiddenBefore} earlier</Text>
      )}
      {viewport.items.map(({ item: warning }, index) => {
        const confirmed = workflow.confirmedIssueCodes.includes(warning.code);
        const style = statusToneStyle(confirmed ? 'success' : 'warning');
        return (
          <Text
            key={warning.code}
            color={style.color}
            dimColor={style.dimColor}
          >
            {viewport.start + index === workflow.warningCursor ? '>' : ' '}{' '}
            [{confirmed ? 'x' : ' '}] {style.symbol}{' '}
            {confirmed ? 'Confirmed' : 'Warning'} · {warning.message}
          </Text>
        );
      })}
      {!viewport.combinedIndicator && viewport.hiddenAfter > 0 && (
        <Text dimColor>  … {viewport.hiddenAfter} more</Text>
      )}
      {viewport.combinedIndicator && (
        <Text dimColor>
          {'  '}… {viewport.hiddenBefore} earlier · {viewport.hiddenAfter} more
        </Text>
      )}
      {!allConfirmed && (
        <StatusLine tone="error" label="Blocked">
          confirm every warning.
        </StatusLine>
      )}
    </Box>
  );
}

function displayGroup(change: CaptureChange): string {
  const ide = change.ide === 'shared'
    ? 'Shared'
    : change.ide === 'claude-code'
      ? 'Claude Code'
      : change.ide.charAt(0).toUpperCase() + change.ide.slice(1);
  const itemType = change.itemType === 'mcp'
    ? 'MCP'
    : change.itemType.charAt(0).toUpperCase() + change.itemType.slice(1);
  return `${ide} / ${itemType}`;
}

function DeployWorkflow({
  workflow,
  terminalRows,
}: {
  workflow: DeployWorkflowState;
  terminalRows: number;
}): ReactNode {
  switch (workflow.status) {
    case 'selection':
      return <DeploySelection workflow={workflow} terminalRows={terminalRows} />;
    case 'diff':
      return <DeployDiff workflow={workflow} />;
    case 'confirmation':
      return (
        <DeployConfirmation
          workflow={workflow}
          terminalRows={terminalRows}
        />
      );
    case 'applying':
      return (
        <Box flexDirection="column">
          <StatusLine tone="info" label="Applying">
            {workflow.selectedIds.length} selected changes transactionally...
          </StatusLine>
          <Text> </Text>
          <Text dimColor>
            Please wait; input is disabled during backup, Apply, and rollback.
          </Text>
        </Box>
      );
    case 'regenerating':
      return (
        <Box flexDirection="column">
          <Text>
            The Deploy Plan became stale. Regenerating a new preview for review...
          </Text>
          <Text> </Text>
          <Text dimColor>Please wait.</Text>
        </Box>
      );
    case 'result':
      return null;
  }
}

function DeploySelection({
  workflow,
  terminalRows,
}: {
  workflow: Extract<DeployWorkflowState, { status: 'selection' }>;
  terminalRows: number;
}): ReactNode {
  const tree = buildDeploySelectionTree(workflow.plan);
  const visible = flattenDeploySelectionTree(tree, workflow.expandedNodeIds);
  const advanced = workflow.plan.changes.filter(
    (change) => change.group === 'advanced',
  );
  const linkOutcomeSummaries = summarizeLinkOutcomes(workflow.plan.linkOutcomes);
  const linkOutcomeRows = workflow.plan.linkOutcomes.length === 1
    ? 2
    : linkOutcomeSummaries.length;
  const viewport = listViewport(
    visible,
    workflow.cursor,
    Math.max(1, terminalRows - (terminalRows <= 12 ? 9 : 10) - linkOutcomeRows),
  );

  return (
    <Box flexDirection="column">
      <Text wrap="truncate-middle">
        Repository: {workflow.plan.repositoryPath ?? 'not bound'}
      </Text>
      <Text>
        {workflow.plan.changes.length} changes · {workflow.selectedIds.length} selected
      </Text>
      {workflow.plan.linkOutcomes.length === 1 && workflow.plan.linkOutcomes.map((outcome) => (
        <Box key={`${outcome.owner}:${outcome.owner === 'ide' ? outcome.ide : 'store'}:${outcome.linkPath}`} flexDirection="column">
          <Text wrap="truncate-middle">
            {outcome.status === 'satisfied-via-link'
              ? outcome.ownership === 'managed'
                ? 'Already satisfied projection'
                : 'Satisfied via link'
              : `Blocked · ${outcome.reason?.replaceAll('-', ' ') ?? 'unclassified'}`}
            {' '}· {outcome.ownership === 'managed' ? 'Managed' : 'External'} · {outcome.packageNames.length} Skill{' '}
            {outcome.packageNames.length === 1 ? 'package' : 'packages'} ·{' '}
            {outcome.affectedFileCount} affected{' '}
            {outcome.affectedFileCount === 1 ? 'file' : 'files'} ·{' '}
            {outcome.linkPaths.length} {outcome.linkPaths.length === 1 ? 'link' : 'links'}
          </Text>
          <Text wrap="truncate-middle">
            {'  '}{outcome.linkPath}
            {outcome.resolvedPath ? ` → ${outcome.resolvedPath}` : ''}
          </Text>
        </Box>
      ))}
      {workflow.plan.linkOutcomes.length > 1 && linkOutcomeSummaries.map((summary) => (
        <Text key={summary.key} wrap="truncate-middle">
          {displaySkillSurface(summary.surface)} · {summary.outcomeCount} {summary.ownership}{' '}
          {summary.state.toLowerCase()} outcomes ·{' '}
          {summary.packageCount} Skill {summary.packageCount === 1 ? 'package' : 'packages'} ·{' '}
          {summary.affectedFileCount} affected{' '}
          {summary.affectedFileCount === 1 ? 'file' : 'files'}
        </Text>
      ))}
      <Text> </Text>
      {!viewport.combinedIndicator && viewport.hiddenBefore > 0 && (
        <Text dimColor>  … {viewport.hiddenBefore} earlier</Text>
      )}
      {viewport.items.map(({ item: { node, depth } }, index) => {
        const visibleIndex = viewport.start + index;
        const expanded = workflow.expandedNodeIds.includes(node.id);
        const disclosure = node.children.length === 0
          ? ' '
          : expanded ? '▼' : '▶';
        if (node.kind === 'advanced') {
          const style = statusToneStyle('error');
          return (
            <Text
              key={node.id}
              color={style.color}
              dimColor={style.dimColor}
              wrap="truncate-middle"
            >
              {visibleIndex === workflow.cursor ? '>' : ' '}{' '}
              {deployNodeSelectionMarker(node.changeIds, workflow.selectedIds)}{' '}
              {disclosure} {style.symbol} Destructive · Advanced Cleanup · {advanced.length}{' '}
              {advanced.length === 1 ? 'deletion' : 'deletions'} ·{' '}
              {advanced.filter((change) => workflow.selectedIds.includes(change.id)).length || 'none'} selected
            </Text>
          );
        }
        const destructive = node.change?.change === 'delete'
          || node.change?.deploymentKind === 'topology-migration';
        const style = destructive ? statusToneStyle('error') : undefined;
        return (
          <Text
            key={node.id}
            color={style?.color}
            dimColor={style?.dimColor}
            wrap="truncate-middle"
          >
            {'  '.repeat(depth)}
            {visibleIndex === workflow.cursor ? '>' : ' '}{' '}
            {deployNodeSelectionMarker(node.changeIds, workflow.selectedIds)}{' '}
            {disclosure} {style && <>{style.symbol} Destructive · </>}{node.label}
            {node.kind !== 'file' && (
              <> · {node.changeIds.length}{' '}
                {node.changeIds.length === 1 ? 'file' : 'files'}</>
            )}
          </Text>
        );
      })}
      {!viewport.combinedIndicator && viewport.hiddenAfter > 0 && (
        <Text dimColor>  … {viewport.hiddenAfter} more</Text>
      )}
      {viewport.combinedIndicator && (
        <Text dimColor>
          {'  '}… {viewport.hiddenBefore} earlier · {viewport.hiddenAfter} more
        </Text>
      )}
      {workflow.plan.issues.some((issue) =>
        issue.severity === 'decisionRequired' || issue.severity === 'error') && (
        <Text color="red">
          Apply disabled: regenerate after resolving every required decision and error.
        </Text>
      )}
    </Box>
  );
}

function listViewport<T>(
  items: T[],
  cursor: number,
  maximumRows: number,
): {
  items: Array<{ item: T }>;
  start: number;
  hiddenBefore: number;
  hiddenAfter: number;
  combinedIndicator: boolean;
} {
  if (items.length <= maximumRows) {
    return {
      items: items.map((item) => ({ item })),
      start: 0,
      hiddenBefore: 0,
      hiddenAfter: 0,
      combinedIndicator: false,
    };
  }
  const combinedIndicator = maximumRows === 2;
  const indicatorRows = maximumRows <= 1 ? 0 : combinedIndicator ? 1 : 2;
  const itemRows = Math.max(1, maximumRows - indicatorRows);
  const maximumStart = Math.max(0, items.length - itemRows);
  const start = maximumRows <= 2
    ? Math.min(Math.max(cursor, 0), maximumStart)
    : Math.min(
      Math.max(cursor - Math.floor(itemRows / 2), 0),
      maximumStart,
    );
  const end = Math.min(start + itemRows, items.length);
  return {
    items: items.slice(start, end).map((item) => ({ item })),
    start,
    hiddenBefore: maximumRows <= 1 ? 0 : start,
    hiddenAfter: maximumRows <= 1 ? 0 : items.length - end,
    combinedIndicator,
  };
}

function deployNodeSelectionMarker(
  changeIds: string[],
  selectedIds: string[],
): string {
  const selected = changeIds.filter((id) => selectedIds.includes(id)).length;
  if (selected === 0) return '[ ]';
  if (selected === changeIds.length) return '[x]';
  return '[-]';
}

function DeployDiff({
  workflow,
}: {
  workflow: Extract<DeployWorkflowState, { status: 'diff' }>;
}): ReactNode {
  const change = workflow.plan.changes.find(
    (item) => item.id === workflow.changeId,
  );
  if (!change) return <Text>Selected Deploy change is no longer available.</Text>;
  return (
    <Box flexDirection="column">
      <Text>{change.name} · {change.change}</Text>
      <Text>Layout: {deployLayoutLabel(change.deploymentKind)}</Text>
      <Text>
        Apply semantics: {change.strategy === 'managed-merge'
          ? 'Managed merge — preserve unowned Native and Local fields.'
          : 'Whole-file replacement — replace the complete target file.'}
      </Text>
      <DeployPreviewView preview={change.preview} />
    </Box>
  );
}

function deployLayoutLabel(kind: DeployPlan['changes'][number]['deploymentKind']): string {
  switch (kind) {
    case 'physical-materialization': return 'Physical materialization';
    case 'managed-link-projection': return 'Managed-link projection';
    case 'topology-migration': return 'Topology migration';
    case 'copy-projection': return 'Copy projection';
    default: return 'Ordinary file';
  }
}

function DeployPreviewView({
  preview,
}: {
  preview: DeployPreview;
}): ReactNode {
  if (preview.kind === 'link') {
    return (
      <Box flexDirection="column">
        <Text>Managed Skill link</Text>
        <Text wrap="truncate-middle">{preview.targetPath}</Text>
        <Text wrap="truncate-middle">→ {preview.linkTarget}</Text>
      </Box>
    );
  }
  if (preview.kind === 'binary') {
    return (
      <Box flexDirection="column">
        <Text>{preview.targetPath}</Text>
        <Text>
          {'  '}binary · {preview.bytes} bytes · sha256 {preview.sha256}
        </Text>
      </Box>
    );
  }
  return (
    <Box flexDirection="column">
      <Text>{preview.targetPath}</Text>
      {preview.diff.split('\n').map((line, index) => (
        <Text key={`${preview.targetPath}:${index}`}>{'  '}{line}</Text>
      ))}
    </Box>
  );
}

function DeployConfirmation({
  workflow,
  terminalRows,
}: {
  workflow: Extract<DeployWorkflowState, { status: 'confirmation' }>;
  terminalRows: number;
}): ReactNode {
  const warnings = deployWarnings(workflow.plan);
  const allConfirmed = warnings.every((warning) =>
    workflow.confirmedIssueCodes.includes(warning.code));
  const viewport = listViewport(
    warnings,
    workflow.warningCursor,
    Math.max(1, terminalRows - (terminalRows <= 12 ? 8 : 10)),
  );
  return (
    <Box flexDirection="column">
      <Text>{workflow.selectedIds.length} selected changes</Text>
      {warnings.length > 0 && <Text>Warnings require explicit confirmation:</Text>}
      {!viewport.combinedIndicator && viewport.hiddenBefore > 0 && (
        <Text dimColor>  … {viewport.hiddenBefore} earlier</Text>
      )}
      {viewport.items.map(({ item: warning }, index) => (
        <Text key={warning.code}>
          {viewport.start + index === workflow.warningCursor ? '>' : ' '}{' '}
          [{workflow.confirmedIssueCodes.includes(warning.code) ? 'x' : ' '}] {warning.message}
        </Text>
      ))}
      {!viewport.combinedIndicator && viewport.hiddenAfter > 0 && (
        <Text dimColor>  … {viewport.hiddenAfter} more</Text>
      )}
      {viewport.combinedIndicator && (
        <Text dimColor>
          {'  '}… {viewport.hiddenBefore} earlier · {viewport.hiddenAfter} more
        </Text>
      )}
      {!allConfirmed && (
        <Text color="yellow">Apply disabled: confirm every warning.</Text>
      )}
    </Box>
  );
}

function RestoreWorkflow({
  workflow,
  terminalRows,
}: {
  workflow: RestoreWorkflowState;
  terminalRows: number;
}): ReactNode {
  switch (workflow.status) {
    case 'review':
      return (
        <RestoreReview
          workflow={workflow}
          terminalRows={terminalRows}
        />
      );
    case 'applying':
      return (
        <Box flexDirection="column">
          <StatusLine tone="info" label="Applying">
            Restoring the latest complete deployment backup transactionally...
          </StatusLine>
          <Text> </Text>
          <Text dimColor>
            Please wait; input is disabled during backup, Apply, and rollback.
          </Text>
        </Box>
      );
    case 'regenerating':
      return (
        <Box flexDirection="column">
          <Text>
            The Restore Plan became stale. Regenerating a new preview for review...
          </Text>
          <Text> </Text>
          <Text dimColor>Please wait.</Text>
        </Box>
      );
    case 'result':
      return null;
  }
}

function RestoreReview({
  workflow,
  terminalRows,
}: {
  workflow: Extract<RestoreWorkflowState, { status: 'review' }>;
  terminalRows: number;
}): ReactNode {
  const { plan } = workflow;
  const writeCount = plan.changes.filter(
    (change) => change.action === 'restore',
  ).length;
  const deleteCount = plan.changes.length - writeCount;
  const hasConflict = plan.issues.some(
    (issue) => issue.code === 'restore.conflict',
  );
  const detail = plan.changes.find(
    (change) => change.id === workflow.detailChangeId,
  );
  if (detail) {
    return (
      <Box flexDirection="column">
        <Text>Focused Restore detail</Text>
        <Text>Action: {detail.action === 'restore' ? 'write' : 'delete'}</Text>
        <Text wrap="wrap">Target: {detail.targetPath}</Text>
        <Text>
          {detail.action === 'restore'
            ? 'The deployment backup will replace this file.'
            : 'Restore will delete this file because it did not exist in the deployment backup.'}
        </Text>
      </Box>
    );
  }
  const viewport = listViewport(
    plan.changes,
    workflow.cursor,
    Math.max(1, terminalRows - 13),
  );
  return (
    <Box flexDirection="column">
      <Text>Repository: {plan.repositoryPath ?? 'not bound'}</Text>
      <Text>Backup time: {plan.backup?.createdAt ?? 'not available'}</Text>
      <Text>
        Impact: {writeCount} file(s) to write, {deleteCount} file(s) to delete
      </Text>
      <Text> </Text>
      {viewport.hiddenBefore > 0 && (
        <Text dimColor>… {viewport.hiddenBefore} earlier changes</Text>
      )}
      {viewport.items.map(({ item: change }, visibleIndex) => (
        <Text key={change.id}>
          {viewport.start + visibleIndex === workflow.cursor ? '>' : ' '}{' '}
          [{change.action === 'restore' ? 'write' : 'delete'}] {change.targetPath}
        </Text>
      ))}
      {viewport.hiddenAfter > 0 && (
        <Text dimColor>… {viewport.hiddenAfter} more changes</Text>
      )}
      {plan.issues.map((issue) => (
        <Box key={issue.code} flexDirection="column">
          <StatusLine
            tone="error"
            label={issue.code === 'restore.conflict'
              ? 'Restore Conflict'
              : 'Error'}
          >
            Blocked · {issue.message}
          </StatusLine>
          {issue.details?.split('\n').map((detail) => (
            <Text key={`${issue.code}:${detail}`}>{'  '}{detail}</Text>
          ))}
        </Box>
      ))}
      {(plan.status === 'failed' || !plan.readyToApply || hasConflict) && (
        <Text color="red">
          Apply disabled: resolve the blocking Restore error, then regenerate the Plan.
        </Text>
      )}
      {plan.nextActions.map((action) => (
        <Text key={action}>Next: {action}</Text>
      ))}
    </Box>
  );
}
