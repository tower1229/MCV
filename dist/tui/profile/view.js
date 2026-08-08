import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Box, Text } from 'ink';
import { FILTER_OPTIONS, filteredCatalogAssets, selectedAssetIds, } from './reducer.js';
import { padDisplay, truncateDisplay } from './display-width.js';
export function ProfileEditorView({ state, columns, rows }) {
    const leftWidth = Math.max(18, Math.floor(columns * 0.22));
    const rightWidth = Math.max(22, Math.floor(columns * 0.28));
    const centerWidth = Math.max(24, columns - leftWidth - rightWidth - 4);
    const listHeight = Math.max(4, rows - 8);
    const profiles = state.profileIds.map((id) => {
        const profile = state.draftProfiles[id];
        const count = profile?.assets.length ?? 0;
        const title = profile?.title ? ` · ${profile.title}` : '';
        const marker = id === state.selectedProfileId ? '›' : ' ';
        return truncateDisplay(`${marker} ${id}${title} (${count})`, leftWidth - 2);
    });
    const assets = filteredCatalogAssets(state);
    const assetLines = assets.map((asset, index) => {
        const selected = selectedAssetIds(state).includes(asset.id);
        const cursor = state.focus === 'assets' && index === state.assetCursor ? '›' : ' ';
        const mark = selected ? '[x]' : '[ ]';
        return truncateDisplay(`${cursor} ${mark} ${asset.id} · ${asset.displayName}`, centerWidth - 2);
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
    return (_jsxs(Box, { flexDirection: "column", width: columns, height: rows, children: [_jsx(Text, { bold: true, children: truncateDisplay('MCV Profile Editor', columns) }), _jsx(Text, { children: truncateDisplay(statusLine, columns) }), _jsx(Text, { children: truncateDisplay(`Search: ${state.searchQuery}${state.focus === 'search' ? '█' : ''}`, columns) }), _jsx(Text, { children: truncateDisplay(filterLine, columns) }), _jsxs(Box, { flexGrow: 1, children: [_jsxs(Box, { flexDirection: "column", width: leftWidth, borderStyle: "single", borderColor: paneColor(state, 'profiles'), children: [_jsx(Text, { bold: true, children: "Profiles" }), visibleWindow(profiles, state.profileCursor, listHeight).map((line, index) => (_jsx(Text, { children: padDisplay(line, leftWidth - 2) }, `profile-${index}`)))] }), _jsxs(Box, { flexDirection: "column", width: centerWidth, borderStyle: "single", borderColor: paneColor(state, 'assets'), children: [_jsx(Text, { bold: true, children: "Assets" }), visibleWindow(assetLines, state.assetCursor, listHeight).map((line, index) => (_jsx(Text, { children: padDisplay(line, centerWidth - 2) }, `asset-${index}`)))] }), _jsxs(Box, { flexDirection: "column", width: rightWidth, borderStyle: "single", borderColor: paneColor(state, 'selected'), children: [_jsx(Text, { bold: true, children: `Selected (${selected.length})` }), visibleWindow(selectedLines, state.selectedCursor, listHeight).map((line, index) => (_jsx(Text, { children: padDisplay(line, rightWidth - 2) }, `selected-${index}`)))] })] }), _jsx(Text, { children: truncateDisplay(`Changes: ${summary} · ${actions}`, columns) }), _jsx(Text, { children: truncateDisplay(help, columns) }), state.conflictMessage ? (_jsx(Text, { color: "yellow", children: truncateDisplay(`Conflict: ${state.conflictMessage}`, columns) })) : null, state.errorMessage ? (_jsx(Text, { color: "red", children: truncateDisplay(`Error: ${state.errorMessage}`, columns) })) : null] }));
}
function statusLabel(state) {
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
function paneColor(state, pane) {
    return state.focus === pane ? 'cyan' : undefined;
}
function visibleWindow(lines, cursor, height) {
    if (lines.length <= height)
        return lines;
    const start = Math.max(0, Math.min(cursor - Math.floor(height / 2), lines.length - height));
    return lines.slice(start, start + height);
}
