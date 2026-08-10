import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Box, Text } from 'ink';
import { truncateDisplay } from '../profile/display-width.js';
import { captureTuiCanApply, captureTuiSummary, currentCaptureDecisionChoices, visibleCaptureChanges, } from './reducer.js';
export function CaptureTuiView({ state, columns, rows, reviewPath }) {
    return (_jsxs(Box, { flexDirection: "column", width: columns, height: rows, children: [_jsx(Text, { bold: true, children: truncateDisplay('MCV Capture Review', columns) }), _jsx(Text, { children: truncateDisplay(statusLine(state), columns) }), state.notice ? _jsxs(Text, { color: "yellow", children: ["! ", truncateDisplay(state.notice, columns - 2)] }) : null, _jsx(Box, { flexDirection: "column", flexGrow: 1, children: _jsx(CaptureBody, { state: state, columns: columns, rows: rows }) }), reviewPath ? _jsx(Text, { dimColor: true, children: truncateDisplay(`Review: ${reviewPath}`, columns) }) : null, _jsx(Text, { children: truncateDisplay(helpLine(state), columns) })] }));
}
function CaptureBody({ state, columns, rows }) {
    const height = Math.max(4, rows - 6);
    switch (state.status) {
        case 'changes':
            return _jsx(Changes, { state: state, columns: columns, height: height });
        case 'diff':
            return _jsx(Diff, { state: state, columns: columns, height: height });
        case 'decisions':
            return _jsx(Decisions, { state: state, columns: columns, height: height });
        case 'warnings':
            return _jsx(Warnings, { state: state, columns: columns, height: height });
        case 'final':
            return _jsx(Final, { state: state });
        case 'applying':
            return _jsx(Text, { children: "Applying the reviewed Capture selection transactionally\u2026" });
        case 'regenerating':
            return _jsx(Text, { children: "The Capture Plan became stale. Regenerating a safe preview\u2026" });
        case 'result':
            return _jsx(Result, { state: state });
    }
}
function Changes({ state, columns, height }) {
    const changes = visibleCaptureChanges(state);
    const visible = visibleWindow(changes, state.changeCursor, height - 2);
    return (_jsxs(Box, { flexDirection: "column", children: [_jsxs(Text, { bold: true, children: ["Changes \u00B7 ", state.draft.selectedChangeIds.length, " selection IDs"] }), visible.map(({ item, index }) => {
                const selected = state.draft.selectedChangeIds.includes(item.id);
                const destructive = item.change === 'delete' ? ' × Destructive ·' : '';
                return (_jsx(Text, { color: item.change === 'delete' ? 'red' : selected ? 'green' : undefined, children: truncateDisplay(`${index === state.changeCursor ? '›' : ' '} [${selected ? 'x' : ' '}]${destructive} ${groupLabel(item)} · ${item.change} · ${item.name}`, columns) }, item.id));
            }), changes.length === 0 ? _jsx(Text, { children: "No ordinary Capture changes." }) : null] }));
}
function Decisions({ state, columns, height }) {
    const group = state.model.decisionGroups[state.decisionGroupIndex];
    const choices = currentCaptureDecisionChoices(state);
    const visible = visibleWindow(choices, state.decisionCursor, height - 3);
    return (_jsxs(Box, { flexDirection: "column", children: [_jsxs(Text, { bold: true, children: ["Decision ", state.decisionGroupIndex + 1, "/", state.model.decisionGroups.length] }), _jsx(Text, { children: truncateDisplay(group?.issue?.message ?? 'Choose exactly one authoritative source.', columns) }), _jsx(Text, { dimColor: true, children: truncateDisplay(`Target: ${choices[0]?.repositoryPaths.join(', ') ?? 'unknown'}`, columns) }), visible.map(({ item, index }) => {
                const selected = state.draft.selectedChangeIds.includes(item.id);
                return (_jsx(Text, { color: selected ? 'green' : undefined, children: truncateDisplay(`${index === state.decisionCursor ? '›' : ' '} [${selected ? 'x' : ' '}] ${item.sourceLabel ?? item.name}`, columns) }, item.id));
            })] }));
}
function Warnings({ state, columns, height }) {
    const visible = visibleWindow(state.model.warnings, state.warningCursor, height);
    return (_jsxs(Box, { flexDirection: "column", children: [_jsx(Text, { bold: true, children: "Warnings \u00B7 explicit confirmation required" }), visible.map(({ item, index }) => {
                const confirmed = state.draft.confirmedIssueIds.includes(item.confirmationId);
                return (_jsxs(Box, { flexDirection: "column", children: [_jsx(Text, { color: confirmed ? 'green' : 'yellow', children: truncateDisplay(`${index === state.warningCursor ? '›' : ' '} [${confirmed ? 'x' : ' '}] ${item.message}`, columns) }), index === state.warningCursor && item.details
                            ? _jsx(Text, { dimColor: true, children: truncateDisplay(`  ${item.details}`, columns) })
                            : null] }, item.confirmationId));
            })] }));
}
function Diff({ state, columns, height }) {
    const change = state.model.plan.changes.find((candidate) => candidate.id === state.detailChangeId);
    if (!change)
        return _jsx(Text, { children: "Selected Capture change is no longer available." });
    const lines = change.previews.flatMap(previewLines).slice(0, height - 2);
    return (_jsxs(Box, { flexDirection: "column", children: [_jsx(Text, { bold: true, children: truncateDisplay(`Diff · ${change.sourceLabel ?? change.name}`, columns) }), _jsx(Text, { dimColor: true, children: truncateDisplay(change.repositoryPaths.join(', '), columns) }), lines.map((line, index) => _jsx(Text, { children: truncateDisplay(line, columns) }, index))] }));
}
function Final({ state }) {
    const summary = captureTuiSummary(state);
    return (_jsxs(Box, { flexDirection: "column", children: [_jsx(Text, { bold: true, children: "Final confirmation" }), _jsxs(Text, { children: ["Selected repository changes: ", summary.selectedRepositoryChanges] }), _jsxs(Text, { children: ["Excluded repository changes: ", summary.unselectedRepositoryChanges] }), _jsxs(Text, { children: ["Resolved decisions: ", summary.resolvedDecisions, " (", summary.skippedDecisions, " skipped)"] }), _jsxs(Text, { children: ["Confirmed warnings: ", summary.confirmedWarnings, "/", state.model.warnings.length] }), _jsx(Text, { color: captureTuiCanApply(state) ? 'green' : 'yellow', children: captureTuiCanApply(state) ? 'Ready: Enter applies this selection.' : 'Blocked: finish every required review item.' })] }));
}
function Result({ state }) {
    const result = state.result;
    if (!result)
        return _jsx(Text, { children: "Capture finished without a Result." });
    if (result.status === 'succeeded') {
        const applied = result.changes.filter((change) => change.decision !== 'skip').length;
        return _jsxs(Text, { color: "green", children: ["\u2713 Succeeded: captured ", applied, " repository change(s)."] });
    }
    return (_jsxs(Box, { flexDirection: "column", children: [_jsxs(Text, { color: result.status === 'failed' ? 'red' : 'yellow', children: [result.status === 'failed' ? '× Failed' : '! Blocked', ": Capture did not change the Repository."] }), result.issues.map((issue) => _jsx(Text, { children: issue.message }, `${issue.code}-${issue.message}`))] }));
}
function statusLine(state) {
    return `Status: ${state.status} · ${state.model.plan.changes.length} changes · ${state.model.interactionCount} review items`;
}
function helpLine(state) {
    if (state.status === 'changes')
        return '↑↓ Move · Space Select · → Diff · Enter/n Review · Esc/q Cancel · Ctrl+C Interrupt';
    if (state.status === 'diff')
        return '←/Esc Close Diff · Ctrl+C Interrupt';
    if (state.status === 'decisions')
        return '↑↓ Move · Space Choose · → Diff · Enter/n Next · ← Back · Esc/q Cancel';
    if (state.status === 'warnings')
        return '↑↓ Move · Space Confirm · Enter/n Next · ← Back · Esc/q Cancel';
    if (state.status === 'final')
        return 'Enter Apply · ← Back · Esc/q Cancel · Ctrl+C Interrupt';
    if (state.status === 'result')
        return 'Enter/q Exit';
    return 'Capture transaction in progress; input is locked.';
}
function previewLines(preview) {
    if (preview.kind === 'binary') {
        return [`${preview.repositoryPath}: binary, ${preview.bytes} bytes, sha256 ${preview.sha256}`];
    }
    return [`${preview.repositoryPath}:`, ...preview.diff.split('\n')];
}
function groupLabel(change) {
    return `${change.ide} / ${change.itemType}`;
}
function visibleWindow(items, cursor, height) {
    const safeHeight = Math.max(1, height);
    const start = items.length <= safeHeight
        ? 0
        : Math.max(0, Math.min(cursor - Math.floor(safeHeight / 2), items.length - safeHeight));
    return items.slice(start, start + safeHeight).map((item, offset) => ({ item, index: start + offset }));
}
