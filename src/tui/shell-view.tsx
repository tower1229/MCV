import { Box, Text } from 'ink';
import type { ReactNode } from 'react';
import type { EnvironmentReport } from '../operations/environment.js';
import type {
  CaptureChange,
  CapturePlan,
  CapturePreview,
  CaptureResult,
} from '../operations/capture.js';
import type { StatusReport } from '../operations/status.js';
import {
  captureDecisionGroups,
  captureWarnings,
  type CaptureWorkflowState,
  type ShellState,
} from './shell-state.js';

export interface ShellViewProps {
  state: ShellState;
}

export function ShellView({ state }: ShellViewProps): ReactNode {
  const { page } = state;
  const title = pageTitle(state);
  const controls = pageControls(state);

  return (
    <Box flexDirection="column">
      <Text bold>MCV</Text>
      <Text>{title}</Text>
      <Text> </Text>
      {page.status === 'loading' && <Text>Loading {title}...</Text>}
      {page.status === 'failure' && <Text color="red">Failed: {page.message}</Text>}
      {page.status === 'ready' && page.route === 'overview' && (
        <Overview report={page.report} />
      )}
      {page.status === 'ready' && page.route === 'environment' && (
        <EnvironmentDetails report={page.report} />
      )}
      {page.status === 'ready' && page.route === 'capture' && (
        <CaptureWorkflow workflow={page.workflow} />
      )}
      {controls && (
        <>
          <Text> </Text>
          <Text dimColor>{controls}</Text>
        </>
      )}
    </Box>
  );
}

function pageTitle(state: ShellState): string {
  const { page } = state;
  if (page.route === 'overview') return 'Overview';
  if (page.route === 'environment') return 'Environment Details';
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

function pageControls(state: ShellState): string | undefined {
  const { page } = state;
  if (page.status !== 'ready') {
    return page.route === 'overview'
      ? 'c Capture   e Environment Details   q Quit   Ctrl+C Cancel'
      : page.route === 'environment'
        ? 'Escape Overview   q Quit   Ctrl+C Cancel'
        : 'q Quit   Ctrl+C Cancel';
  }
  if (page.route === 'overview') {
    return 'c Capture   e Environment Details   q Quit   Ctrl+C Cancel';
  }
  if (page.route === 'environment') {
    return 'Escape Overview   q Quit   Ctrl+C Cancel';
  }
  switch (page.workflow.status) {
    case 'selection':
      return '↑↓ Move   Space Select   d Diff   Enter Continue   q Quit   Ctrl+C Cancel';
    case 'diff':
      return 'Escape Back   q Quit   Ctrl+C Cancel';
    case 'decision':
      return '↑↓ Move   Space Choose   Enter Continue   Escape Back   q Quit   Ctrl+C Cancel';
    case 'confirmation':
      return '↑↓ Move   Space Confirm Warning   Enter Apply   Escape Back   q Quit   Ctrl+C Cancel';
    case 'applying':
      return undefined;
    case 'regenerating':
      return undefined;
    case 'result':
      return 'Enter Refresh Overview   q Quit';
  }
}

function Overview({ report }: { report: StatusReport }): ReactNode {
  const pending = report.pendingDeployment;
  const local = report.postDeployLocalState;

  return (
    <Box flexDirection="column">
      <Text>Repository: {report.repository.path}</Text>
      {report.repository.git && (
        <Text>
          Git: {report.repository.git.clean
            ? 'clean'
            : `${report.repository.git.uncommittedChanges} uncommitted changes`}
        </Text>
      )}
      <Text>
        Pending deployment: {pending.total} changes ({pending.add} add,{' '}
        {pending.modify} modify, {pending.delete} delete)
      </Text>
      <Text>
        Local managed state: {local.drift} changed, {local.missing} missing
      </Text>
      <Text>
        Environment: {report.environment.missingVariables.length} missing variables
      </Text>
      <Text>IDE support:</Text>
      {report.environment.ideSupport.map((ide) => (
        <Text key={ide.id}>
          {'  '}{ide.name}: {ide.enabled ? 'enabled' : 'disabled'},{' '}
          {ide.detected ? 'detected' : 'not detected'}
        </Text>
      ))}
      <Text>
        Last operation: {report.lastOperation
          ? `${report.lastOperation.kind} · ${report.lastOperation.success ? 'success' : 'failure'}`
          : 'none'}
      </Text>
    </Box>
  );
}

function EnvironmentDetails({ report }: { report: EnvironmentReport }): ReactNode {
  return (
    <Box flexDirection="column">
      {report.environments.map((environment) => (
        <Box key={environment.id} flexDirection="column">
          <Text>
            {environment.name}: {environment.detected ? 'detected' : 'not detected'}
          </Text>
          {[...environment.configDirectories, ...environment.configFiles].map((item) => (
            <Text key={`${environment.id}:${item.path}`}>
              {'  '}[{item.exists ? 'found' : 'missing'}] {item.path}
            </Text>
          ))}
        </Box>
      ))}
      {report.missingVariables.length > 0 && (
        <Text>Missing variables: {report.missingVariables.join(', ')}</Text>
      )}
    </Box>
  );
}

function CaptureWorkflow({
  workflow,
}: {
  workflow: CaptureWorkflowState;
}): ReactNode {
  switch (workflow.status) {
    case 'selection':
      return <CaptureSelection workflow={workflow} />;
    case 'diff':
      return <CaptureDiff workflow={workflow} />;
    case 'decision':
      return <CaptureDecision workflow={workflow} />;
    case 'confirmation':
      return <CaptureConfirmation workflow={workflow} />;
    case 'applying':
      return (
        <Box flexDirection="column">
          <Text>
            Applying {workflow.selectedIds.length} selected changes transactionally...
          </Text>
          <Text> </Text>
          <Text dimColor>Please wait; input is disabled during Apply.</Text>
        </Box>
      );
    case 'regenerating':
      return (
        <Box flexDirection="column">
          <Text>The Capture Plan became stale. Regenerating a safe preview...</Text>
          <Text> </Text>
          <Text dimColor>Please wait.</Text>
        </Box>
      );
    case 'result':
      return <CaptureResultView result={workflow.result} />;
  }
}

function CaptureSelection({
  workflow,
}: {
  workflow: Extract<CaptureWorkflowState, { status: 'selection' }>;
}): ReactNode {
  const maximumVisible = 12;
  const visibleStart = Math.min(
    Math.max(workflow.cursor - maximumVisible + 1, 0),
    Math.max(workflow.plan.changes.length - maximumVisible, 0),
  );
  const visibleChanges = workflow.plan.changes.slice(
    visibleStart,
    visibleStart + maximumVisible,
  );
  let previousGroup = '';

  return (
    <Box flexDirection="column">
      <Text>Repository: {workflow.plan.repositoryPath ?? 'not bound'}</Text>
      <Text>
        {workflow.plan.changes.length} changes · {workflow.selectedIds.length} selected
      </Text>
      <Text> </Text>
      {visibleStart > 0 && <Text>… {visibleStart} earlier changes</Text>}
      {visibleChanges.map((change, visibleIndex) => {
        const index = visibleStart + visibleIndex;
        const group = `${change.ide}/${change.itemType}`;
        const showGroup = group !== previousGroup;
        previousGroup = group;
        return (
          <Box key={change.id} flexDirection="column">
            {showGroup && <Text>{displayGroup(change)}</Text>}
            <Text>
              {index === workflow.cursor ? '>' : ' '}{' '}
              [{workflow.selectedIds.includes(change.id) ? 'x' : ' '}] [{change.change}] {change.name}
            </Text>
          </Box>
        );
      })}
      {workflow.plan.changes.length > visibleStart + visibleChanges.length && (
        <Text>
          … {workflow.plan.changes.length - visibleStart - visibleChanges.length} more changes
        </Text>
      )}
      {workflow.plan.issues.some((issue) => issue.severity === 'error') && (
        <Text color="red">Apply disabled: resolve every error before continuing.</Text>
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
}: {
  workflow: Extract<CaptureWorkflowState, { status: 'decision' }>;
}): ReactNode {
  const groups = captureDecisionGroups(workflow.plan);
  const choices = groups[workflow.groupIndex] ?? [];
  const groupName = choices[0]?.name ?? 'required choice';
  const selected = choices.some((choice) => workflow.selectedIds.includes(choice.id));
  return (
    <Box flexDirection="column">
      <Text>Decision {workflow.groupIndex + 1}/{groups.length}: {groupName}</Text>
      {choices.map((choice, index) => (
        <Text key={choice.id}>
          {index === workflow.cursor ? '>' : ' '}{' '}
          [{workflow.selectedIds.includes(choice.id) ? 'x' : ' '}] {choice.sourceLabel ?? choice.name}
        </Text>
      ))}
      {!selected && (
        <>
          <Text> </Text>
          <Text color="yellow">Continue disabled: choose exactly one option.</Text>
        </>
      )}
    </Box>
  );
}

function CaptureConfirmation({
  workflow,
}: {
  workflow: Extract<CaptureWorkflowState, { status: 'confirmation' }>;
}): ReactNode {
  const warnings = captureWarnings(workflow.plan);
  const allConfirmed = warnings.every((warning) =>
    workflow.confirmedIssueCodes.includes(warning.code));
  return (
    <Box flexDirection="column">
      <Text>{workflow.selectedIds.length} selected changes</Text>
      {warnings.length > 0 && <Text>Warnings require explicit confirmation:</Text>}
      {warnings.map((warning, index) => (
        <Text key={warning.code}>
          {index === workflow.warningCursor ? '>' : ' '}{' '}
          [{workflow.confirmedIssueCodes.includes(warning.code) ? 'x' : ' '}] {warning.message}
        </Text>
      ))}
      {!allConfirmed && (
        <>
          <Text> </Text>
          <Text color="yellow">Apply disabled: confirm every warning.</Text>
        </>
      )}
    </Box>
  );
}

function CaptureResultView({ result }: { result: CaptureResult }): ReactNode {
  if (result.status === 'succeeded') {
    return (
      <Box flexDirection="column">
        <Text color="green">Capture succeeded.</Text>
        <Text>Applied: {result.data?.appliedChangeIds.length ?? 0} changes</Text>
        <Text>Written: {result.data?.writtenPaths.length ?? 0} paths</Text>
        <Text>Deleted: {result.data?.deletedPaths.length ?? 0} paths</Text>
        {result.issues.map((issue) => (
          <Text key={issue.code} color="yellow">Warning: {issue.message}</Text>
        ))}
      </Box>
    );
  }
  if (result.status === 'blocked') {
    return (
      <Box flexDirection="column">
        <Text color="yellow">Capture was blocked; Repository was not changed.</Text>
        {result.issues.map((issue) => <Text key={issue.code}>{issue.message}</Text>)}
      </Box>
    );
  }
  return (
    <Box flexDirection="column">
      <Text color="red">Capture failed: {result.error.message}</Text>
      <Text>Repository transaction was not completed.</Text>
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
