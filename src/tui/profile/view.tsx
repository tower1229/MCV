import { Box, Text } from 'ink';
import {
  FILTER_OPTIONS,
  filteredCatalogAssets,
  selectedAssetIds,
  type ProfileEditorState,
} from './reducer.js';
import { padDisplay, truncateDisplay } from './display-width.js';
import { inkColor, inkEmphasisProps, inkRoleProps } from '../../presentation/ink-theme.js';

export interface ProfileEditorViewProps {
  state: ProfileEditorState;
  columns: number;
  rows: number;
}

export function ProfileEditorView({ state, columns, rows }: ProfileEditorViewProps) {
  const leftWidth = Math.max(18, Math.floor(columns * 0.22));
  const rightWidth = Math.max(22, Math.floor(columns * 0.28));
  const centerWidth = Math.max(24, columns - leftWidth - rightWidth - 4);
  const listHeight = Math.max(4, rows - 8);
  const profiles = state.profileIds.map((id) => {
    const profile = state.draftProfiles[id];
    const count = profile?.assets.length ?? 0;
    const title = profile?.title ? ` · ${profile.title}` : '';
    const marker = id === state.selectedProfileId ? '›' : ' ';
    return truncateDisplay(
      `${marker} ${id}${title} (${count})`,
      leftWidth - 2,
    );
  });
  const assets = filteredCatalogAssets(state);
  const assetLines = assets.map((asset, index) => {
    const selected = selectedAssetIds(state).includes(asset.id);
    const cursor = state.focus === 'assets' && index === state.assetCursor ? '›' : ' ';
    const mark = selected ? '[x]' : '[ ]';
    return truncateDisplay(
      `${cursor} ${mark} ${asset.id} · ${asset.displayName}`,
      centerWidth - 2,
    );
  });
  const selected = selectedAssetIds(state);
  const selectedLines = selected.map((assetId, index) => {
    const cursor = state.focus === 'selected' && index === state.selectedCursor ? '›' : ' ';
    return truncateDisplay(`${cursor} ${assetId}`, rightWidth - 2);
  });
  const filterLine = FILTER_OPTIONS.map((option, index) => {
    const active = option.kind === 'type'
      ? state.typeFilter === option.value
      : state.compatibilityFilter === option.value;
    const focused = state.focus === 'filters' && index === state.filterCursor;
    const label = active ? `[${option.label}]` : option.label;
    return focused ? `›${label}` : label;
  }).join('  ');

  const statusLine = statusLabel(state);
  const summary = `+${state.changeSummary.added} / -${state.changeSummary.removed}`;
  const actions = state.status === 'dirty' || state.status === 'conflict'
    ? 'Enter Save · Esc Cancel'
    : 'Esc Close';
  const help = 'Tab focus · ↑↓ move · Space toggle · / search · ←→ panes · Ctrl+C quit';

  return (
    <Box flexDirection="column" width={columns} height={rows}>
      <Text {...inkEmphasisProps()}>{truncateDisplay('MCV Profile Editor', columns)}</Text>
      <Text>{truncateDisplay(statusLine, columns)}</Text>
      <Text>{truncateDisplay(`Search: ${state.searchQuery}${state.focus === 'search' ? '█' : ''}`, columns)}</Text>
      <Text>{truncateDisplay(filterLine, columns)}</Text>
      <Box flexGrow={1}>
        <Box flexDirection="column" width={leftWidth} borderStyle="single" borderColor={paneColor(state, 'profiles')}>
          <Text {...inkEmphasisProps()}>Profiles</Text>
          {visibleWindow(profiles, state.profileCursor, listHeight).map((line, index) => (
            <Text key={`profile-${index}`}>{padDisplay(line, leftWidth - 2)}</Text>
          ))}
        </Box>
        <Box flexDirection="column" width={centerWidth} borderStyle="single" borderColor={paneColor(state, 'assets')}>
          <Text {...inkEmphasisProps()}>Assets</Text>
          {visibleWindow(assetLines, state.assetCursor, listHeight).map((line, index) => (
            <Text key={`asset-${index}`}>{padDisplay(line, centerWidth - 2)}</Text>
          ))}
        </Box>
        <Box flexDirection="column" width={rightWidth} borderStyle="single" borderColor={paneColor(state, 'selected')}>
          <Text {...inkEmphasisProps()}>{`Selected (${selected.length})`}</Text>
          {visibleWindow(selectedLines, state.selectedCursor, listHeight).map((line, index) => (
            <Text key={`selected-${index}`}>{padDisplay(line, rightWidth - 2)}</Text>
          ))}
        </Box>
      </Box>
      <Text>{truncateDisplay(`Changes: ${summary} · ${actions}`, columns)}</Text>
      <Text>{truncateDisplay(help, columns)}</Text>
      {state.conflictMessage ? (
        <Text {...inkRoleProps('decision')}>{truncateDisplay(`Conflict: ${state.conflictMessage}`, columns)}</Text>
      ) : null}
      {state.errorMessage ? (
        <Text {...inkRoleProps('danger')}>{truncateDisplay(`Error: ${state.errorMessage}`, columns)}</Text>
      ) : null}
    </Box>
  );
}

function statusLabel(state: ProfileEditorState): string {
  switch (state.status) {
    case 'loading':
      return 'Status: loading inventory…';
    case 'ready':
      return `Status: ready · profile ${state.selectedProfileId}`;
    case 'dirty':
      return `Status: dirty · profile ${state.selectedProfileId}`;
    case 'saving':
      return 'Status: saving through ProfileService…';
    case 'conflict':
      return 'Status: Revision conflict — Esc dismisses, Enter retries save';
    default:
      return `Status: ${state.status}`;
  }
}

function paneColor(
  state: ProfileEditorState,
  pane: 'profiles' | 'assets' | 'selected',
): string | undefined {
  return state.focus === pane ? inkColor('information') : undefined;
}

function visibleWindow(lines: string[], cursor: number, height: number): string[] {
  if (lines.length <= height) return lines;
  const start = Math.max(0, Math.min(cursor - Math.floor(height / 2), lines.length - height));
  return lines.slice(start, start + height);
}
