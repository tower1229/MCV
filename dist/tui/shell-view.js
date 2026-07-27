import { Fragment as _Fragment, jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Box, Text } from 'ink';
import { captureDecisionGroups, captureWarnings, } from './shell-state.js';
export function ShellView({ state }) {
    const { page } = state;
    const title = pageTitle(state);
    const controls = pageControls(state);
    return (_jsxs(Box, { flexDirection: "column", children: [_jsx(Text, { bold: true, children: "MCV" }), _jsx(Text, { children: title }), _jsx(Text, { children: " " }), page.status === 'loading' && _jsxs(Text, { children: ["Loading ", title, "..."] }), page.status === 'failure' && _jsxs(Text, { color: "red", children: ["Failed: ", page.message] }), page.status === 'ready' && page.route === 'overview' && (_jsx(Overview, { report: page.report })), page.status === 'ready' && page.route === 'environment' && (_jsx(EnvironmentDetails, { report: page.report })), page.status === 'ready' && page.route === 'capture' && (_jsx(CaptureWorkflow, { workflow: page.workflow })), controls && (_jsxs(_Fragment, { children: [_jsx(Text, { children: " " }), _jsx(Text, { dimColor: true, children: controls })] }))] }));
}
function pageTitle(state) {
    const { page } = state;
    if (page.route === 'overview')
        return 'Overview';
    if (page.route === 'environment')
        return 'Environment Details';
    if (page.status !== 'ready')
        return 'Capture';
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
function pageControls(state) {
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
function Overview({ report }) {
    const pending = report.pendingDeployment;
    const local = report.postDeployLocalState;
    return (_jsxs(Box, { flexDirection: "column", children: [_jsxs(Text, { children: ["Repository: ", report.repository.path] }), report.repository.git && (_jsxs(Text, { children: ["Git: ", report.repository.git.clean
                        ? 'clean'
                        : `${report.repository.git.uncommittedChanges} uncommitted changes`] })), _jsxs(Text, { children: ["Pending deployment: ", pending.total, " changes (", pending.add, " add,", ' ', pending.modify, " modify, ", pending.delete, " delete)"] }), _jsxs(Text, { children: ["Local managed state: ", local.drift, " changed, ", local.missing, " missing"] }), _jsxs(Text, { children: ["Environment: ", report.environment.missingVariables.length, " missing variables"] }), _jsx(Text, { children: "IDE support:" }), report.environment.ideSupport.map((ide) => (_jsxs(Text, { children: ['  ', ide.name, ": ", ide.enabled ? 'enabled' : 'disabled', ",", ' ', ide.detected ? 'detected' : 'not detected'] }, ide.id))), _jsxs(Text, { children: ["Last operation: ", report.lastOperation
                        ? `${report.lastOperation.kind} · ${report.lastOperation.success ? 'success' : 'failure'}`
                        : 'none'] })] }));
}
function EnvironmentDetails({ report }) {
    return (_jsxs(Box, { flexDirection: "column", children: [report.environments.map((environment) => (_jsxs(Box, { flexDirection: "column", children: [_jsxs(Text, { children: [environment.name, ": ", environment.detected ? 'detected' : 'not detected'] }), [...environment.configDirectories, ...environment.configFiles].map((item) => (_jsxs(Text, { children: ['  ', "[", item.exists ? 'found' : 'missing', "] ", item.path] }, `${environment.id}:${item.path}`)))] }, environment.id))), report.missingVariables.length > 0 && (_jsxs(Text, { children: ["Missing variables: ", report.missingVariables.join(', ')] }))] }));
}
function CaptureWorkflow({ workflow, }) {
    switch (workflow.status) {
        case 'selection':
            return _jsx(CaptureSelection, { workflow: workflow });
        case 'diff':
            return _jsx(CaptureDiff, { workflow: workflow });
        case 'decision':
            return _jsx(CaptureDecision, { workflow: workflow });
        case 'confirmation':
            return _jsx(CaptureConfirmation, { workflow: workflow });
        case 'applying':
            return (_jsxs(Box, { flexDirection: "column", children: [_jsxs(Text, { children: ["Applying ", workflow.selectedIds.length, " selected changes transactionally..."] }), _jsx(Text, { children: " " }), _jsx(Text, { dimColor: true, children: "Please wait; input is disabled during Apply." })] }));
        case 'regenerating':
            return (_jsxs(Box, { flexDirection: "column", children: [_jsx(Text, { children: "The Capture Plan became stale. Regenerating a safe preview..." }), _jsx(Text, { children: " " }), _jsx(Text, { dimColor: true, children: "Please wait." })] }));
        case 'result':
            return _jsx(CaptureResultView, { result: workflow.result });
    }
}
function CaptureSelection({ workflow, }) {
    const maximumVisible = 12;
    const visibleStart = Math.min(Math.max(workflow.cursor - maximumVisible + 1, 0), Math.max(workflow.plan.changes.length - maximumVisible, 0));
    const visibleChanges = workflow.plan.changes.slice(visibleStart, visibleStart + maximumVisible);
    let previousGroup = '';
    return (_jsxs(Box, { flexDirection: "column", children: [_jsxs(Text, { children: ["Repository: ", workflow.plan.repositoryPath ?? 'not bound'] }), _jsxs(Text, { children: [workflow.plan.changes.length, " changes \u00B7 ", workflow.selectedIds.length, " selected"] }), _jsx(Text, { children: " " }), visibleStart > 0 && _jsxs(Text, { children: ["\u2026 ", visibleStart, " earlier changes"] }), visibleChanges.map((change, visibleIndex) => {
                const index = visibleStart + visibleIndex;
                const group = `${change.ide}/${change.itemType}`;
                const showGroup = group !== previousGroup;
                previousGroup = group;
                return (_jsxs(Box, { flexDirection: "column", children: [showGroup && _jsx(Text, { children: displayGroup(change) }), _jsxs(Text, { children: [index === workflow.cursor ? '>' : ' ', ' ', "[", workflow.selectedIds.includes(change.id) ? 'x' : ' ', "] [", change.change, "] ", change.name] })] }, change.id));
            }), workflow.plan.changes.length > visibleStart + visibleChanges.length && (_jsxs(Text, { children: ["\u2026 ", workflow.plan.changes.length - visibleStart - visibleChanges.length, " more changes"] })), workflow.plan.issues.some((issue) => issue.severity === 'error') && (_jsx(Text, { color: "red", children: "Apply disabled: resolve every error before continuing." }))] }));
}
function CaptureDiff({ workflow, }) {
    const change = workflow.plan.changes.find((item) => item.id === workflow.changeId);
    if (!change)
        return _jsx(Text, { children: "Selected Capture change is no longer available." });
    return (_jsxs(Box, { flexDirection: "column", children: [_jsxs(Text, { children: [change.name, " \u00B7 ", change.change] }), change.previews.map((preview) => (_jsx(CapturePreviewView, { preview: preview }, `${change.id}:${preview.repositoryPath}`))), change.previews.length === 0 && _jsx(Text, { children: "No content preview is available." })] }));
}
function CapturePreviewView({ preview, }) {
    if (preview.kind === 'binary') {
        return (_jsxs(Box, { flexDirection: "column", children: [_jsx(Text, { children: preview.repositoryPath }), _jsxs(Text, { children: ['  ', "binary \u00B7 ", preview.bytes, " bytes \u00B7 sha256 ", preview.sha256] })] }));
    }
    return (_jsxs(Box, { flexDirection: "column", children: [_jsx(Text, { children: preview.repositoryPath }), preview.diff.split('\n').map((line, index) => (_jsxs(Text, { children: ['  ', line] }, `${preview.repositoryPath}:${index}`)))] }));
}
function CaptureDecision({ workflow, }) {
    const groups = captureDecisionGroups(workflow.plan);
    const choices = groups[workflow.groupIndex] ?? [];
    const groupName = choices[0]?.name ?? 'required choice';
    const selected = choices.some((choice) => workflow.selectedIds.includes(choice.id));
    return (_jsxs(Box, { flexDirection: "column", children: [_jsxs(Text, { children: ["Decision ", workflow.groupIndex + 1, "/", groups.length, ": ", groupName] }), choices.map((choice, index) => (_jsxs(Text, { children: [index === workflow.cursor ? '>' : ' ', ' ', "[", workflow.selectedIds.includes(choice.id) ? 'x' : ' ', "] ", choice.sourceLabel ?? choice.name] }, choice.id))), !selected && (_jsxs(_Fragment, { children: [_jsx(Text, { children: " " }), _jsx(Text, { color: "yellow", children: "Continue disabled: choose exactly one option." })] }))] }));
}
function CaptureConfirmation({ workflow, }) {
    const warnings = captureWarnings(workflow.plan);
    const allConfirmed = warnings.every((warning) => workflow.confirmedIssueCodes.includes(warning.code));
    return (_jsxs(Box, { flexDirection: "column", children: [_jsxs(Text, { children: [workflow.selectedIds.length, " selected changes"] }), warnings.length > 0 && _jsx(Text, { children: "Warnings require explicit confirmation:" }), warnings.map((warning, index) => (_jsxs(Text, { children: [index === workflow.warningCursor ? '>' : ' ', ' ', "[", workflow.confirmedIssueCodes.includes(warning.code) ? 'x' : ' ', "] ", warning.message] }, warning.code))), !allConfirmed && (_jsxs(_Fragment, { children: [_jsx(Text, { children: " " }), _jsx(Text, { color: "yellow", children: "Apply disabled: confirm every warning." })] }))] }));
}
function CaptureResultView({ result }) {
    if (result.status === 'succeeded') {
        return (_jsxs(Box, { flexDirection: "column", children: [_jsx(Text, { color: "green", children: "Capture succeeded." }), _jsxs(Text, { children: ["Applied: ", result.data?.appliedChangeIds.length ?? 0, " changes"] }), _jsxs(Text, { children: ["Written: ", result.data?.writtenPaths.length ?? 0, " paths"] }), _jsxs(Text, { children: ["Deleted: ", result.data?.deletedPaths.length ?? 0, " paths"] }), result.issues.map((issue) => (_jsxs(Text, { color: "yellow", children: ["Warning: ", issue.message] }, issue.code)))] }));
    }
    if (result.status === 'blocked') {
        return (_jsxs(Box, { flexDirection: "column", children: [_jsx(Text, { color: "yellow", children: "Capture was blocked; Repository was not changed." }), result.issues.map((issue) => _jsx(Text, { children: issue.message }, issue.code))] }));
    }
    return (_jsxs(Box, { flexDirection: "column", children: [_jsxs(Text, { color: "red", children: ["Capture failed: ", result.error.message] }), _jsx(Text, { children: "Repository transaction was not completed." })] }));
}
function displayGroup(change) {
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
