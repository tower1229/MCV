import { Box, Text } from 'ink';
import type { CaptureChange, CapturePreview } from '../../operations/capture.js';
import { truncateDisplay } from '../profile/display-width.js';
import { inkEmphasisProps, inkRoleProps } from '../../presentation/ink-theme.js';
import {
  captureTuiCanApply,
  captureTuiSummary,
  currentCaptureDecisionChoices,
  visibleCaptureChanges,
  type CaptureTuiState,
} from './reducer.js';

export interface CaptureTuiViewProps {
  state: CaptureTuiState;
  columns: number;
  rows: number;
  reviewPath?: string;
}

export function CaptureTuiView({ state, columns, rows, reviewPath }: CaptureTuiViewProps) {
  return (
    <Box flexDirection="column" width={columns} height={rows}>
      <Text {...inkEmphasisProps()}>{truncateDisplay('MCV Capture Review', columns)}</Text>
      <Text>{truncateDisplay(statusLine(state), columns)}</Text>
      {state.notice ? <Text {...inkRoleProps('attention')}>! {truncateDisplay(state.notice, columns - 2)}</Text> : null}
      <Box flexDirection="column" flexGrow={1}>
        <CaptureBody state={state} columns={columns} rows={rows} />
      </Box>
      {reviewPath ? <Text {...inkRoleProps('muted')}>{truncateDisplay(`Review: ${reviewPath}`, columns)}</Text> : null}
      <Text>{truncateDisplay(helpLine(state), columns)}</Text>
    </Box>
  );
}

function CaptureBody({ state, columns, rows }: Omit<CaptureTuiViewProps, 'reviewPath'>) {
  const height = Math.max(4, rows - 6);
  switch (state.status) {
    case 'changes':
      return <Changes state={state} columns={columns} height={height} />;
    case 'diff':
      return <Diff state={state} columns={columns} height={height} />;
    case 'decisions':
      return <Decisions state={state} columns={columns} height={height} />;
    case 'warnings':
      return <Warnings state={state} columns={columns} height={height} />;
    case 'final':
      return <Final state={state} />;
    case 'applying':
      return <Text>Applying the reviewed Capture selection transactionally…</Text>;
    case 'regenerating':
      return <Text>The Capture Plan became stale. Regenerating a safe preview…</Text>;
    case 'result':
      return <Result state={state} />;
  }
}

function Changes({ state, columns, height }: { state: CaptureTuiState; columns: number; height: number }) {
  const changes = visibleCaptureChanges(state);
  const visible = visibleWindow(changes, state.changeCursor, height - 2);
  return (
    <Box flexDirection="column">
      <Text {...inkEmphasisProps()}>Changes · {state.draft.selectedChangeIds.length} selection IDs</Text>
      {visible.map(({ item, index }) => {
        const selected = state.draft.selectedChangeIds.includes(item.id);
        const destructive = item.change === 'delete' ? ' × Destructive ·' : '';
        return (
          <Text key={item.id} {...inkRoleProps(item.change === 'delete' ? 'danger' : selected ? 'information' : 'muted')}>
            {truncateDisplay(
              `${index === state.changeCursor ? '›' : ' '} [${selected ? 'x' : ' '}]${destructive} ${groupLabel(item)} · ${item.change} · ${item.name}`,
              columns,
            )}
          </Text>
        );
      })}
      {changes.length === 0 ? <Text>No ordinary Capture changes.</Text> : null}
    </Box>
  );
}

function Decisions({ state, columns, height }: { state: CaptureTuiState; columns: number; height: number }) {
  const group = state.model.decisionGroups[state.decisionGroupIndex];
  const choices = currentCaptureDecisionChoices(state);
  const visible = visibleWindow(choices, state.decisionCursor, height - 3);
  return (
    <Box flexDirection="column">
      <Text {...inkRoleProps('decision', { emphasis: true })}>Decision {state.decisionGroupIndex + 1}/{state.model.decisionGroups.length}</Text>
      <Text>{truncateDisplay(group?.issue?.message ?? 'Choose exactly one authoritative source.', columns)}</Text>
      <Text {...inkRoleProps('muted')}>{truncateDisplay(`Target: ${choices[0]?.repositoryPaths.join(', ') ?? 'unknown'}`, columns)}</Text>
      {visible.map(({ item, index }) => {
        const selected = state.draft.selectedChangeIds.includes(item.id);
        return (
          <Text key={item.id} {...inkRoleProps(selected ? 'information' : 'muted')}>
            {truncateDisplay(
              `${index === state.decisionCursor ? '›' : ' '} [${selected ? 'x' : ' '}] ${item.sourceLabel ?? item.name}`,
              columns,
            )}
          </Text>
        );
      })}
    </Box>
  );
}

function Warnings({ state, columns, height }: { state: CaptureTuiState; columns: number; height: number }) {
  const visible = visibleWindow(state.model.warnings, state.warningCursor, height);
  return (
    <Box flexDirection="column">
      <Text {...inkRoleProps('attention', { emphasis: true })}>Warnings · explicit confirmation required</Text>
      {visible.map(({ item, index }) => {
        const confirmed = state.draft.confirmedIssueIds.includes(item.confirmationId);
        return (
          <Box key={item.confirmationId} flexDirection="column">
            <Text {...inkRoleProps('attention')}>
              {truncateDisplay(
                `${index === state.warningCursor ? '›' : ' '} [${confirmed ? 'x' : ' '}] ${item.message}`,
                columns,
              )}
            </Text>
            {index === state.warningCursor && item.details
              ? <Text {...inkRoleProps('muted')}>{truncateDisplay(`  ${item.details}`, columns)}</Text>
              : null}
          </Box>
        );
      })}
    </Box>
  );
}

function Diff({ state, columns, height }: { state: CaptureTuiState; columns: number; height: number }) {
  const change = state.model.plan.changes.find((candidate) => candidate.id === state.detailChangeId);
  if (!change) return <Text>Selected Capture change is no longer available.</Text>;
  const lines = change.previews.flatMap(previewLines).slice(0, height - 2);
  return (
    <Box flexDirection="column">
      <Text {...inkEmphasisProps()}>{truncateDisplay(`Diff · ${change.sourceLabel ?? change.name}`, columns)}</Text>
      <Text {...inkRoleProps('muted')}>{truncateDisplay(change.repositoryPaths.join(', '), columns)}</Text>
      {lines.map((line, index) => <Text key={index}>{truncateDisplay(line, columns)}</Text>)}
    </Box>
  );
}

function Final({ state }: { state: CaptureTuiState }) {
  const summary = captureTuiSummary(state);
  return (
    <Box flexDirection="column">
      <Text {...inkRoleProps('decision', { emphasis: true })}>Final confirmation</Text>
      <Text>Selected repository changes: {summary.selectedRepositoryChanges}</Text>
      <Text>Excluded repository changes: {summary.unselectedRepositoryChanges}</Text>
      <Text>Resolved decisions: {summary.resolvedDecisions} ({summary.skippedDecisions} skipped)</Text>
      <Text>Confirmed warnings: {summary.confirmedWarnings}/{state.model.warnings.length}</Text>
      <Text {...inkRoleProps(captureTuiCanApply(state) ? 'success' : 'decision')}>
        {captureTuiCanApply(state) ? 'Ready: Enter applies this selection.' : 'Blocked: finish every required review item.'}
      </Text>
    </Box>
  );
}

function Result({ state }: { state: CaptureTuiState }) {
  const result = state.result;
  if (!result) return <Text>Capture finished without a Result.</Text>;
  if (result.status === 'succeeded') {
    const applied = result.changes.filter((change) => change.decision !== 'skip').length;
    return <Text {...inkRoleProps('success')}>✓ Succeeded: captured {applied} repository change(s).</Text>;
  }
  return (
    <Box flexDirection="column">
      <Text {...inkRoleProps(result.status === 'failed' ? 'danger' : 'attention')}>
        {result.status === 'failed' ? '× Failed' : '! Blocked'}: Capture did not change the Repository.
      </Text>
      {result.issues.map((issue) => <Text key={`${issue.code}-${issue.message}`}>{issue.message}</Text>)}
    </Box>
  );
}

function statusLine(state: CaptureTuiState): string {
  return `Status: ${state.status} · ${state.model.plan.changes.length} changes · ${state.model.interactionCount} review items`;
}

function helpLine(state: CaptureTuiState): string {
  if (state.status === 'changes') return '↑↓ Move · Space Select · → Diff · Enter/n Review · Esc/q Cancel · Ctrl+C Interrupt';
  if (state.status === 'diff') return '←/Esc Close Diff · Ctrl+C Interrupt';
  if (state.status === 'decisions') return '↑↓ Move · Space Choose · → Diff · Enter/n Next · ← Back · Esc/q Cancel';
  if (state.status === 'warnings') return '↑↓ Move · Space Confirm · Enter/n Next · ← Back · Esc/q Cancel';
  if (state.status === 'final') return 'Enter Apply · ← Back · Esc/q Cancel · Ctrl+C Interrupt';
  if (state.status === 'result') return 'Enter/q Exit';
  return 'Capture transaction in progress; input is locked.';
}

function previewLines(preview: CapturePreview): string[] {
  if (preview.kind === 'binary') {
    return [`${preview.repositoryPath}: binary, ${preview.bytes} bytes, sha256 ${preview.sha256}`];
  }
  return [`${preview.repositoryPath}:`, ...preview.diff.split('\n')];
}

function groupLabel(change: CaptureChange): string {
  return `${change.ide} / ${change.itemType}`;
}

function visibleWindow<T>(items: T[], cursor: number, height: number): Array<{ item: T; index: number }> {
  const safeHeight = Math.max(1, height);
  const start = items.length <= safeHeight
    ? 0
    : Math.max(0, Math.min(cursor - Math.floor(safeHeight / 2), items.length - safeHeight));
  return items.slice(start, start + safeHeight).map((item, offset) => ({ item, index: start + offset }));
}
