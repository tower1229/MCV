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
import type { RepositoryReport } from '../operations/repository.js';
import type {
  DeployChange,
  DeployPreview,
  DeployResult,
} from '../operations/deploy.js';
import type {
  RestorePlan,
  RestoreResult,
} from '../operations/restore.js';
import {
  captureDecisionGroups,
  captureWarnings,
  deployVisibleChanges,
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
      {page.status === 'ready' && page.route === 'repository' && (
        <RepositoryWorkflow workflow={page.workflow} />
      )}
      {page.status === 'ready' && page.route === 'environment' && (
        <EnvironmentDetails report={page.report} />
      )}
      {page.status === 'ready' && page.route === 'capture' && (
        <CaptureWorkflow workflow={page.workflow} />
      )}
      {page.status === 'ready' && page.route === 'deploy' && (
        <DeployWorkflow workflow={page.workflow} />
      )}
      {page.status === 'ready' && page.route === 'restore' && (
        <RestoreWorkflow workflow={page.workflow} />
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

function pageControls(state: ShellState): string | undefined {
  const { page } = state;
  if (page.route === 'repository') {
    if (page.status !== 'ready') return 'q Quit   Ctrl+C Cancel';
    switch (page.workflow.status) {
      case 'menu':
        return '↑↓ Move   Enter Select   q Quit   Ctrl+C Cancel';
      case 'path':
        return 'Type path   Enter Review Bind   Escape Back   Ctrl+C Cancel';
      case 'plan':
        return page.workflow.step.plan.status === 'planned'
          ? 'Enter Apply   Escape Back   Ctrl+C Cancel'
          : 'Escape Back   Ctrl+C Cancel';
      case 'applying':
        return undefined;
      case 'result':
        return 'Enter Back   q Quit';
    }
  }
  if (page.status !== 'ready') {
    return page.route === 'overview'
      ? 'c Capture   d Deploy   s Restore   e Environment Details   q Quit   Ctrl+C Cancel'
      : page.route === 'environment'
        ? 'Escape Overview   q Quit   Ctrl+C Cancel'
        : 'q Quit   Ctrl+C Cancel';
  }
  if (page.route === 'overview') {
    return 'c Capture   d Deploy   s Restore   e Environment Details   r Repository   q Quit   Ctrl+C Cancel';
  }
  if (page.route === 'environment') {
    return state.postInitOnboarding
      ? 'Enter Continue to Capture   Escape Overview   q Quit   Ctrl+C Cancel'
      : 'Escape Overview   q Quit   Ctrl+C Cancel';
  }
  if (page.route === 'deploy') {
    switch (page.workflow.status) {
      case 'selection':
        return '↑↓ Move   Space Select   d Diff   a Advanced Cleanup   Enter Continue   q Quit   Ctrl+C Cancel';
      case 'diff':
        return 'Escape Back   q Quit   Ctrl+C Cancel';
      case 'confirmation':
        return '↑↓ Move   Space Confirm Warning   Enter Apply   Escape Back   q Quit   Ctrl+C Cancel';
      case 'applying':
      case 'regenerating':
        return undefined;
      case 'result':
        return 'Enter Refresh Overview   q Quit';
    }
  }
  if (page.route === 'restore') {
    switch (page.workflow.status) {
      case 'review':
        return page.workflow.plan.status === 'planned'
          && page.workflow.plan.readyToApply
          ? 'Enter Apply   Escape Overview   q Quit   Ctrl+C Cancel'
          : 'Escape Overview   q Quit   Ctrl+C Cancel';
      case 'applying':
      case 'regenerating':
        return undefined;
      case 'result':
        return 'Enter Refresh Overview   q Quit';
    }
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

function RepositoryWorkflow({
  workflow,
}: {
  workflow: RepositoryWorkflowState;
}): ReactNode {
  if (workflow.status === 'menu') {
    const report = workflow.report.repositoryPath
      ? workflow.report
      : workflow.currentDirectory;
    return (
      <Box flexDirection="column">
        <RepositoryIdentity report={report} />
        {workflow.report.repositoryPath && !workflow.report.valid && (
          <Text color="red">
            Repository writes are blocked until the binding is recovered.
          </Text>
        )}
        <Text> </Text>
        {workflow.actions.map((action, index) => (
          <Text key={action}>
            {index === workflow.cursor ? '>' : ' '}{' '}
            {repositoryActionLabel(action, workflow.resumeRoute)}
          </Text>
        ))}
      </Box>
    );
  }
  if (workflow.status === 'path') {
    return (
      <Box flexDirection="column">
        <Text>Enter the path to an existing MCV Repository:</Text>
        <Text>{'> '}{workflow.value}</Text>
      </Box>
    );
  }
  if (workflow.status === 'applying') {
    return (
      <Text>
        Applying the reviewed {operationLabel(workflow.step.operation)} Plan...
      </Text>
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
  return (
    <Box flexDirection="column">
      <Text>Repository: {plan.repositoryPath ?? 'not bound'}</Text>
      {operation === 'unbind' && (
        <Text>
          This removes only the local binding. Repository files will not be changed.
        </Text>
      )}
      {plan.changes.map((change) => (
        <Text key={change.id}>[{change.kind}] {repositoryChangeLabel(change)}</Text>
      ))}
      {plan.issues.map((issue) => (
        <Text
          key={issue.code}
          color={issue.severity === 'error' ? 'red' : 'yellow'}
        >
          {issue.message}
        </Text>
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
  return (
    <Box flexDirection="column">
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
        <Text key={issue.code} color={issue.severity === 'error' ? 'red' : 'yellow'}>
          {issue.message}
        </Text>
      ))}
    </Box>
  );
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

function DeployWorkflow({
  workflow,
}: {
  workflow: DeployWorkflowState;
}): ReactNode {
  switch (workflow.status) {
    case 'selection':
      return <DeploySelection workflow={workflow} />;
    case 'diff':
      return <DeployDiff workflow={workflow} />;
    case 'confirmation':
      return <DeployConfirmation workflow={workflow} />;
    case 'applying':
      return (
        <Box flexDirection="column">
          <Text>
            Applying {workflow.selectedIds.length} selected changes transactionally...
          </Text>
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
      return <DeployResultView result={workflow.result} />;
  }
}

function DeploySelection({
  workflow,
}: {
  workflow: Extract<DeployWorkflowState, { status: 'selection' }>;
}): ReactNode {
  const visibleChanges = deployVisibleChanges(workflow);
  const advanced = workflow.plan.changes.filter(
    (change) => change.group === 'advanced',
  );
  let previousGroup = '';

  return (
    <Box flexDirection="column">
      <Text>Repository: {workflow.plan.repositoryPath ?? 'not bound'}</Text>
      <Text>
        {workflow.plan.changes.length} changes · {workflow.selectedIds.length} selected
      </Text>
      <Text> </Text>
      {visibleChanges.map((change, index) => {
        const group = `${change.group}/${change.ide}/${change.capability}`;
        const showGroup = group !== previousGroup;
        previousGroup = group;
        return (
          <Box key={change.id} flexDirection="column">
            {showGroup && change.group === 'standard' && (
              <Text>{displayDeployGroup(change)}</Text>
            )}
            {showGroup && change.group === 'advanced' && (
              <Text>Advanced Cleanup / {displayDeployGroup(change)}</Text>
            )}
            <Text>
              {index === workflow.cursor ? '>' : ' '}{' '}
              [{workflow.selectedIds.includes(change.id) ? 'x' : ' '}] [{change.change}] {change.name}
            </Text>
          </Box>
        );
      })}
      {advanced.length > 0 && (
        <>
          <Text> </Text>
          <Text>
            Advanced Cleanup: {workflow.advancedExpanded ? 'expanded' : 'collapsed'} ({advanced.length}{' '}
            {advanced.length === 1 ? 'deletion' : 'deletions'},{' '}
            {advanced.filter((change) => workflow.selectedIds.includes(change.id)).length || 'none'} selected)
          </Text>
        </>
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
      <Text>
        Apply semantics: {change.strategy === 'managed-merge'
          ? 'Managed merge — preserve unowned Native and Local fields.'
          : 'Whole-file replacement — replace the complete target file.'}
      </Text>
      <DeployPreviewView preview={change.preview} />
    </Box>
  );
}

function DeployPreviewView({
  preview,
}: {
  preview: DeployPreview;
}): ReactNode {
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
}: {
  workflow: Extract<DeployWorkflowState, { status: 'confirmation' }>;
}): ReactNode {
  const warnings = deployWarnings(workflow.plan);
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

function DeployResultView({ result }: { result: DeployResult }): ReactNode {
  if (result.status === 'succeeded') {
    return (
      <Box flexDirection="column">
        <Text color="green">Deploy succeeded.</Text>
        <Text>Applied: {result.data?.appliedChangeIds.length ?? 0} changes</Text>
        <Text>Written: {result.data?.writtenPaths.length ?? 0} paths</Text>
        <Text>Deleted: {result.data?.deletedPaths.length ?? 0} paths</Text>
      </Box>
    );
  }
  if (result.status === 'blocked') {
    return (
      <Box flexDirection="column">
        <Text color="yellow">Deploy was blocked; device configuration was not changed.</Text>
        {result.issues.map((issue) => <Text key={issue.code}>{issue.message}</Text>)}
      </Box>
    );
  }
  return (
    <Box flexDirection="column">
      <Text color="red">Deploy failed: {result.error.message}</Text>
      {result.nextActions.map((action) => (
        <Text key={action}>Next: {action}</Text>
      ))}
    </Box>
  );
}

function RestoreWorkflow({
  workflow,
}: {
  workflow: RestoreWorkflowState;
}): ReactNode {
  switch (workflow.status) {
    case 'review':
      return <RestoreReview plan={workflow.plan} />;
    case 'applying':
      return (
        <Box flexDirection="column">
          <Text>Restoring the latest complete deployment backup transactionally...</Text>
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
      return <RestoreResultView result={workflow.result} />;
  }
}

function RestoreReview({ plan }: { plan: RestorePlan }): ReactNode {
  const writeCount = plan.changes.filter(
    (change) => change.action === 'restore',
  ).length;
  const deleteCount = plan.changes.length - writeCount;
  const hasConflict = plan.issues.some(
    (issue) => issue.code === 'restore.conflict',
  );
  return (
    <Box flexDirection="column">
      <Text>Repository: {plan.repositoryPath ?? 'not bound'}</Text>
      <Text>Backup time: {plan.backup?.createdAt ?? 'not available'}</Text>
      <Text>
        Impact: {writeCount} file(s) to write, {deleteCount} file(s) to delete
      </Text>
      <Text> </Text>
      {plan.changes.map((change) => (
        <Text key={change.id}>
          [{change.action === 'restore' ? 'write' : 'delete'}] {change.targetPath}
        </Text>
      ))}
      {plan.issues.map((issue) => (
        <Box key={issue.code} flexDirection="column">
          <Text color="red">
            {issue.code === 'restore.conflict' ? 'Restore Conflict: ' : 'Error: '}
            {issue.message}
          </Text>
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

function RestoreResultView({ result }: { result: RestoreResult }): ReactNode {
  if (result.status === 'succeeded') {
    return (
      <Box flexDirection="column">
        <Text color="green">Restore succeeded.</Text>
        <Text>Written: {result.data?.restoredPaths.length ?? 0} paths</Text>
        <Text>Deleted: {result.data?.deletedPaths.length ?? 0} paths</Text>
        <Text>Pre-restore backup: {result.data?.backupPath}</Text>
      </Box>
    );
  }
  if (result.status === 'blocked') {
    return (
      <Box flexDirection="column">
        <Text color="yellow">Restore was blocked; device configuration was not changed.</Text>
        {result.issues.map((issue) => (
          <Text key={issue.code}>{issue.code}: {issue.message}</Text>
        ))}
      </Box>
    );
  }
  return (
    <Box flexDirection="column">
      <Text color="red">Restore failed: {result.error.message}</Text>
      <Text>Error code: {result.error.code}</Text>
      {result.nextActions.map((action) => (
        <Text key={action}>Next: {action}</Text>
      ))}
    </Box>
  );
}

function displayDeployGroup(change: DeployChange): string {
  const ide = change.ide === 'claude-code'
    ? 'Claude Code'
    : change.ide.charAt(0).toUpperCase() + change.ide.slice(1);
  const capability: Record<DeployChange['capability'], string> = {
    rules: 'Shared Rules',
    skills: 'Skills',
    mcp: 'MCP',
    native: 'IDE Configuration',
  };
  return `${ide} / ${capability[change.capability]}`;
}
