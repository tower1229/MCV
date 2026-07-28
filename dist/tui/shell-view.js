import { Fragment as _Fragment, jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Box, Text, useWindowSize } from 'ink';
import { buildDeploySelectionTree, flattenDeploySelectionTree, } from './deploy-selection-tree.js';
import { captureDecisionGroups, captureWarnings, deployWarnings, } from './shell-state.js';
import { PRIMARY_DESTINATIONS, } from './overview-navigation.js';
import { statusToneStyle, } from './status-tone.js';
export function ShellView({ state, terminalColumns, terminalRows, }) {
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
    return (_jsxs(Box, { flexDirection: "column", children: [!compactOverview && (_jsxs(_Fragment, { children: [_jsx(Text, { bold: true, children: "MCV" }), _jsx(Text, { children: title }), _jsx(Text, { children: " " })] })), _jsx(Box, { flexDirection: "column", maxHeight: scrollable ? contentRows : undefined, overflowY: scrollable ? 'hidden' : undefined, children: _jsxs(Box, { flexDirection: "column", marginTop: scrollable ? -state.scrollOffset : undefined, children: [page.status === 'loading' && (_jsxs(StatusLine, { tone: "info", label: "Loading", children: [title, "..."] })), page.status === 'failure' && (_jsx(StatusLine, { tone: "error", label: "Error", children: page.message })), page.status === 'ready' && page.route === 'overview' && (_jsx(Overview, { report: page.report, focusId: state.overviewFocusId, terminalColumns: columns, terminalRows: rows })), page.status === 'ready' && page.route === 'repository' && (page.workflow.status === 'result'
                            ? _jsx(ScrollablePageContent, { state: state })
                            : _jsx(RepositoryWorkflow, { workflow: page.workflow })), page.status === 'ready' && page.route === 'environment' && (_jsx(ScrollablePageContent, { state: state })), page.status === 'ready' && page.route === 'help' && (_jsx(ScrollablePageContent, { state: state })), page.status === 'ready' && page.route === 'capture' && (page.workflow.status === 'result'
                            ? _jsx(ScrollablePageContent, { state: state })
                            : _jsx(CaptureWorkflow, { workflow: page.workflow })), page.status === 'ready' && page.route === 'deploy' && (page.workflow.status === 'result'
                            ? _jsx(ScrollablePageContent, { state: state })
                            : (_jsx(DeployWorkflow, { workflow: page.workflow, terminalRows: rows }))), page.status === 'ready' && page.route === 'restore' && (page.workflow.status === 'result'
                            ? _jsx(ScrollablePageContent, { state: state })
                            : (_jsx(RestoreWorkflow, { workflow: page.workflow, terminalRows: rows })))] }) }), controls && (_jsxs(_Fragment, { children: [!compactOverview && _jsx(Text, { children: " " }), _jsx(Text, { dimColor: true, children: controls })] }))] }));
}
function isScrollablePage(state) {
    const { page } = state;
    if (page.status !== 'ready')
        return false;
    if (page.route === 'help' || page.route === 'environment')
        return true;
    if (page.route === 'overview')
        return false;
    return page.workflow.status === 'result';
}
export function maximumPageScrollOffset(state, terminalRows, terminalColumns) {
    if (!isScrollablePage(state))
        return 0;
    const renderedLines = scrollablePageLines(state).reduce((total, line) => total + wrappedLineCount(line.text, Math.max(1, terminalColumns)), 0);
    return Math.max(0, renderedLines - pageContentRows(state, terminalRows, terminalColumns));
}
function pageContentRows(state, terminalRows, terminalColumns) {
    const controls = pageControls(state, terminalRows);
    const compactOverview = state.page.status === 'ready'
        && state.page.route === 'overview'
        && terminalRows <= 16;
    return Math.max(1, terminalRows
        - (compactOverview ? 0 : 4)
        - (controls
            ? wrappedLineCount(controls, Math.max(1, terminalColumns))
            : 0));
}
function wrappedLineCount(value, columns) {
    return value.split('\n').reduce((total, line) => total + wrappedParagraphLineCount(line, columns), 0);
}
function wrappedParagraphLineCount(value, columns) {
    if (value.length === 0)
        return 1;
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
                }
                else {
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
function textWidth(value) {
    return Array.from(value).reduce((width, character) => width + (character.codePointAt(0) > 0xff ? 2 : 1), 0);
}
function scrollablePageLines(state) {
    const { page } = state;
    if (page.status !== 'ready')
        return [];
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
                ].map((item) => `  [${item.exists ? 'found' : 'missing'}] ${item.path}`),
            ]),
            ...(page.report.missingVariables.length > 0
                ? [`Missing variables: ${page.report.missingVariables.join(', ')}`]
                : []),
        ]);
    }
    if (page.route === 'overview')
        return [];
    if (page.route === 'repository') {
        if (page.workflow.status !== 'result')
            return [];
        const { operation, result } = page.workflow.step;
        if (result.status === 'succeeded') {
            return pageLines('repository-success', [`${operationLabel(operation)} succeeded.`], () => 'green');
        }
        const message = result.status === 'failed'
            ? result.error.message
            : result.issues[0]?.message ?? 'The operation was blocked.';
        return pageLines('repository-failure', [
            `${operationLabel(operation)} failed: ${message}`,
            ...result.nextActions.map((action) => `Next: ${action}`),
        ], (index) => index === 0 ? 'red' : undefined);
    }
    if (page.workflow.status !== 'result')
        return [];
    if (page.route === 'capture') {
        const result = page.workflow.result;
        if (result.status === 'succeeded') {
            return pageLines('capture-success', [
                'Capture succeeded.',
                `Applied: ${result.data?.appliedChangeIds.length ?? 0} changes`,
                `Written: ${result.data?.writtenPaths.length ?? 0} paths`,
                `Deleted: ${result.data?.deletedPaths.length ?? 0} paths`,
                ...result.issues.map((issue) => `Warning: ${issue.message}`),
            ], (index) => index === 0
                ? 'green'
                : index >= 4 ? 'yellow' : undefined);
        }
        if (result.status === 'blocked') {
            return pageLines('capture-blocked', [
                'Capture was blocked; Repository was not changed.',
                ...result.issues.map((issue) => issue.message),
            ], (index) => index === 0 ? 'yellow' : undefined);
        }
        return pageLines('capture-failed', [
            `Capture failed: ${result.error.message}`,
            'Repository transaction was not completed.',
        ], (index) => index === 0 ? 'red' : undefined);
    }
    if (page.route === 'deploy') {
        const result = page.workflow.result;
        if (result.status === 'succeeded') {
            return pageLines('deploy-success', [
                'Deploy succeeded.',
                `Applied: ${result.data?.appliedChangeIds.length ?? 0} changes`,
                `Written: ${result.data?.writtenPaths.length ?? 0} paths`,
                `Deleted: ${result.data?.deletedPaths.length ?? 0} paths`,
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
function pageLines(prefix, texts, colorForIndex = () => undefined) {
    return texts.map((text, index) => ({
        key: `${prefix}:${index}`,
        text,
        color: colorForIndex(index),
    }));
}
function ScrollablePageContent({ state, }) {
    return (_jsx(Box, { flexDirection: "column", children: scrollablePageLines(state).map((line) => (_jsx(Text, { color: line.color, wrap: "wrap", children: line.text }, line.key))) }));
}
function pageTitle(state) {
    const { page } = state;
    if (page.route === 'repository') {
        if (page.status !== 'ready')
            return 'Repository';
        switch (page.workflow.status) {
            case 'menu': return 'Repository';
            case 'path': return 'Repository · Enter Existing Path';
            case 'plan': return `Repository · ${operationLabel(page.workflow.step.operation)} Plan`;
            case 'applying': return `Repository · Applying ${operationLabel(page.workflow.step.operation)}`;
            case 'result': return `Repository · ${operationLabel(page.workflow.step.operation)} Result`;
        }
    }
    if (page.route === 'overview')
        return 'Overview';
    if (page.route === 'help')
        return 'Help';
    if (page.route === 'environment')
        return 'Environment Details';
    if (page.route === 'deploy') {
        if (page.status !== 'ready')
            return 'Deploy';
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
        if (page.status !== 'ready')
            return 'Restore Latest Deployment';
        switch (page.workflow.status) {
            case 'review': return 'Restore Latest Deployment · Review';
            case 'applying': return 'Restore Latest Deployment · Applying';
            case 'regenerating': return 'Restore Latest Deployment · Regenerating';
            case 'result': return 'Restore Latest Deployment · Result';
        }
    }
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
function pageControls(state, terminalRows) {
    const { page } = state;
    if (page.route === 'repository') {
        if (page.status !== 'ready')
            return 'q Quit   Ctrl+C Cancel';
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
                return '↑↓ Scroll   Enter/← Refresh Overview   q Quit';
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
                    ? '↑↓/Pg Move   ←→ Expand   Space Select   q Quit'
                    : '↑↓ Move   ←→ Expand/Collapse   Space Select   PgUp/PgDn Page   Home/End   d Diff   a Cleanup   Enter Continue   q Quit   Ctrl+C Cancel';
            case 'diff':
                return 'Escape Back   q Quit   Ctrl+C Cancel';
            case 'confirmation':
                return '↑↓ Move   Space Confirm Warning   Enter Apply   Escape Back   q Quit   Ctrl+C Cancel';
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
            return '↑↓ Scroll   Enter/← Refresh Overview   q Quit';
    }
}
function primaryNavigationControls() {
    return [
        '↑↓ Move   →/Enter Open   q Quit   Ctrl+C Cancel',
        'Accelerators: c Capture   d Deploy   s Restore   r Repository   h Help',
    ].join('\n');
}
function RepositoryWorkflow({ workflow, }) {
    if (workflow.status === 'menu') {
        const report = workflow.report.repositoryPath
            ? workflow.report
            : workflow.currentDirectory;
        return (_jsxs(Box, { flexDirection: "column", children: [_jsx(RepositoryIdentity, { report: report }), workflow.report.repositoryPath && !workflow.report.valid && (_jsx(Text, { color: "red", children: "Repository writes are blocked until the binding is recovered." })), _jsx(Text, { children: " " }), workflow.actions.map((action, index) => (_jsxs(Text, { children: [index === workflow.cursor ? '>' : ' ', ' ', repositoryActionLabel(action, workflow.resumeRoute)] }, action)))] }));
    }
    if (workflow.status === 'path') {
        return (_jsxs(Box, { flexDirection: "column", children: [_jsx(Text, { children: "Enter the path to an existing MCV Repository:" }), _jsxs(Text, { children: ['> ', workflow.value] })] }));
    }
    if (workflow.status === 'applying') {
        return (_jsxs(StatusLine, { tone: "info", label: "Applying", children: ["Reviewed ", operationLabel(workflow.step.operation), " Plan..."] }));
    }
    if (workflow.status === 'result') {
        const { operation, result } = workflow.step;
        if (result.status === 'succeeded') {
            return _jsxs(Text, { color: "green", children: [operationLabel(operation), " succeeded."] });
        }
        const message = result.status === 'failed'
            ? result.error.message
            : result.issues[0]?.message ?? 'The operation was blocked.';
        return (_jsxs(Box, { flexDirection: "column", children: [_jsxs(Text, { color: "red", children: [operationLabel(operation), " failed: ", message] }), result.nextActions.map((action) => (_jsxs(Text, { children: ["Next: ", action] }, action)))] }));
    }
    const { operation, plan } = workflow.step;
    return (_jsxs(Box, { flexDirection: "column", children: [_jsxs(Text, { children: ["Repository: ", plan.repositoryPath ?? 'not bound'] }), operation === 'unbind' && (_jsx(Text, { children: "This removes only the local binding. Repository files will not be changed." })), plan.changes.map((change) => (_jsxs(Text, { children: ["[", change.kind, "] ", repositoryChangeLabel(change)] }, change.id))), plan.issues.map((issue) => (_jsx(Text, { color: issue.severity === 'error' ? 'red' : 'yellow', children: issue.message }, issue.code))), plan.status === 'failed' && (_jsx(Text, { color: "red", children: "Apply disabled until the Repository selection is fixed." }))] }));
}
function RepositoryIdentity({ report, }) {
    return (_jsxs(Box, { flexDirection: "column", children: [_jsxs(Text, { children: ["Path: ", report.repositoryPath ?? 'not bound'] }), _jsxs(Text, { children: ["Repository ID: ", report.repositoryId ?? 'unknown'] }), _jsxs(Text, { children: ["Schema: ", report.repositorySchemaVersion ?? 'unknown'] }), report.git && (_jsxs(Text, { children: ["Git: ", report.git.clean ? 'clean' : `${report.git.uncommittedChanges} uncommitted changes`, report.git.branch ? ` (${report.git.branch})` : ''] })), report.issues.map((issue) => (_jsx(Text, { color: issue.severity === 'error' ? 'red' : 'yellow', children: issue.message }, issue.code)))] }));
}
function repositoryActionLabel(action, resumeRoute) {
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
function operationLabel(operation) {
    return operation.charAt(0).toUpperCase() + operation.slice(1);
}
function repositoryChangeLabel(change) {
    if ('path' in change && typeof change.path === 'string')
        return change.path;
    if ('repositoryPath' in change
        && typeof change.repositoryPath === 'string')
        return change.repositoryPath;
    if ('targetPath' in change
        && typeof change.targetPath === 'string')
        return change.targetPath;
    if ('previousRepositoryPath' in change
        && typeof change.previousRepositoryPath === 'string') {
        return change.previousRepositoryPath;
    }
    return String(change.id ?? 'Repository change');
}
function Overview({ report, focusId, terminalColumns, terminalRows, }) {
    if (terminalRows <= 16) {
        return (_jsx(CompactOverview, { report: report, focusId: focusId, terminalColumns: terminalColumns }));
    }
    const wide = terminalColumns >= 90;
    return (_jsxs(Box, { flexDirection: wide ? 'row' : 'column', children: [_jsxs(Box, { flexDirection: "column", width: wide ? 32 : undefined, flexShrink: 0, children: [_jsx(Text, { children: "Navigation" }), _jsx(PrimaryNavigation, { focusId: focusId })] }), !wide && _jsx(Text, { children: " " }), _jsxs(Box, { flexDirection: "column", flexGrow: 1, children: [_jsx(Text, { children: "Status Overview" }), _jsx(OverviewStatus, { report: report })] })] }));
}
function PrimaryNavigation({ focusId, }) {
    return (_jsx(_Fragment, { children: PRIMARY_DESTINATIONS.map((destination) => {
            const focused = destination.id === focusId;
            const focusStyle = statusToneStyle('info');
            return (_jsxs(Text, { color: focused ? focusStyle.color : undefined, children: [focused ? '›' : ' ', ' ', destination.label, 'accelerator' in destination
                        ? ` (${destination.accelerator})`
                        : ''] }, destination.id));
        }) }));
}
function OverviewStatus({ report }) {
    const status = createOverviewStatusViewModel(report);
    return (_jsxs(_Fragment, { children: [_jsx(StatusLine, { tone: status.repository.tone, label: status.repository.label, children: statusItemText(status.repository) }), _jsxs(Text, { wrap: "wrap", children: ['  ', "Path: ", report.repository.path] }), status.git && (_jsx(StatusLine, { tone: status.git.tone, label: status.git.label, children: statusItemText(status.git) })), _jsx(StatusLine, { tone: status.pending.tone, label: status.pending.label, children: statusItemText(status.pending) }), _jsx(StatusLine, { tone: status.drift.tone, label: status.drift.label, children: statusItemText(status.drift) }), _jsx(StatusLine, { tone: status.environment.tone, label: status.environment.label, children: statusItemText(status.environment) }), _jsx(Text, { children: "IDE support:" }), status.ideSupport.map((ide) => (_jsx(StatusLine, { tone: ide.tone, label: ide.label, indent: 2, children: statusItemText(ide) }, ide.key))), _jsx(StatusLine, { tone: status.lastOperation.tone, label: status.lastOperation.label, children: statusItemText(status.lastOperation) }), status.issues.map((issue) => (_jsx(StatusLine, { tone: issue.tone, label: issue.label, children: statusItemText(issue) }, issue.key)))] }));
}
function CompactOverview({ report, focusId, terminalColumns, }) {
    const status = createOverviewStatusViewModel(report);
    const pathLength = Math.max(16, Math.min(48, terminalColumns - 28));
    return (_jsxs(Box, { flexDirection: "column", children: [_jsxs(Text, { wrap: "wrap", children: ["Navigation:", PRIMARY_DESTINATIONS.map((destination) => {
                        const focused = destination.id === focusId;
                        const style = statusToneStyle('info');
                        return (_jsxs(Text, { color: focused ? style.color : undefined, children: ['  ', focused ? '› ' : '', destination.label, 'accelerator' in destination
                                    ? ` (${destination.accelerator})`
                                    : ''] }, destination.id));
                    })] }), _jsx(Text, { children: "Status Overview" }), _jsxs(StatusLine, { tone: status.repository.tone, label: status.repository.label, children: [statusItemText(status.repository), " \u00B7 Path: ", truncateLeading(report.repository.path, pathLength)] }), status.git && (_jsx(StatusLine, { tone: status.git.tone, label: status.git.label, children: statusItemText(status.git) })), _jsx(StatusLine, { tone: status.pending.tone, label: status.pending.label, children: statusItemText(status.pending) }), _jsxs(Text, { wrap: "wrap", children: [_jsxs(StatusFragment, { tone: status.drift.tone, children: [status.drift.label, ": ", statusItemText(status.drift)] }), '  ', _jsxs(StatusFragment, { tone: status.environment.tone, children: [status.environment.label, ": ", statusItemText(status.environment)] })] }), _jsxs(Text, { wrap: "wrap", children: ["IDE:", status.ideSupport.map((ide) => (_jsxs(StatusFragment, { tone: ide.tone, prefix: "  ", children: [ide.label, ": ", statusItemText(ide, false)] }, ide.key)))] }), _jsxs(Text, { wrap: "wrap", children: [_jsxs(StatusFragment, { tone: status.lastOperation.tone, children: [status.lastOperation.label, ": ", statusItemText(status.lastOperation)] }), status.issues.map((issue) => (_jsxs(StatusFragment, { tone: issue.tone, prefix: "  ", children: [issue.label, ": ", statusItemText(issue, false)] }, issue.key)))] })] }));
}
function createOverviewStatusViewModel(report) {
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
                    tone: git.clean ? 'success' : 'warning',
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
        drift: {
            key: 'drift',
            tone: local.drift > 0 || local.missing > 0 ? 'warning' : 'success',
            label: 'Drift',
            state: local.drift > 0 || local.missing > 0 ? 'Review' : 'None',
            details: `${local.drift} changed, ${local.missing} missing`,
        },
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
        issues: report.issues.map((issue) => ({
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
function statusItemText(item, includeDetails = true) {
    return includeDetails && item.details
        ? `${item.state} · ${item.details}`
        : item.state;
}
function StatusFragment({ tone, prefix = '', children, }) {
    const style = statusToneStyle(tone);
    return (_jsxs(Text, { color: style.color, dimColor: style.dimColor, children: [prefix, style.symbol, " ", children] }));
}
function truncateLeading(value, maximumLength) {
    const characters = Array.from(value);
    if (characters.length <= maximumLength)
        return value;
    return `…${characters.slice(-(maximumLength - 1)).join('')}`;
}
function StatusLine({ tone, label, indent = 0, children, }) {
    const style = statusToneStyle(tone);
    return (_jsxs(Text, { color: style.color, dimColor: style.dimColor, wrap: "wrap", children: [' '.repeat(indent), style.symbol, " ", label, ": ", children] }));
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
            return (_jsxs(Box, { flexDirection: "column", children: [_jsxs(StatusLine, { tone: "info", label: "Applying", children: [workflow.selectedIds.length, " selected changes transactionally..."] }), _jsx(Text, { children: " " }), _jsx(Text, { dimColor: true, children: "Please wait; input is disabled during Apply." })] }));
        case 'regenerating':
            return (_jsxs(Box, { flexDirection: "column", children: [_jsx(Text, { children: "The Capture Plan became stale. Regenerating a safe preview..." }), _jsx(Text, { children: " " }), _jsx(Text, { dimColor: true, children: "Please wait." })] }));
        case 'result':
            return null;
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
function DeployWorkflow({ workflow, terminalRows, }) {
    switch (workflow.status) {
        case 'selection':
            return _jsx(DeploySelection, { workflow: workflow, terminalRows: terminalRows });
        case 'diff':
            return _jsx(DeployDiff, { workflow: workflow });
        case 'confirmation':
            return _jsx(DeployConfirmation, { workflow: workflow });
        case 'applying':
            return (_jsxs(Box, { flexDirection: "column", children: [_jsxs(StatusLine, { tone: "info", label: "Applying", children: [workflow.selectedIds.length, " selected changes transactionally..."] }), _jsx(Text, { children: " " }), _jsx(Text, { dimColor: true, children: "Please wait; input is disabled during backup, Apply, and rollback." })] }));
        case 'regenerating':
            return (_jsxs(Box, { flexDirection: "column", children: [_jsx(Text, { children: "The Deploy Plan became stale. Regenerating a new preview for review..." }), _jsx(Text, { children: " " }), _jsx(Text, { dimColor: true, children: "Please wait." })] }));
        case 'result':
            return null;
    }
}
function DeploySelection({ workflow, terminalRows, }) {
    const tree = buildDeploySelectionTree(workflow.plan);
    const visible = flattenDeploySelectionTree(tree, workflow.expandedNodeIds);
    const advanced = workflow.plan.changes.filter((change) => change.group === 'advanced');
    const viewport = listViewport(visible, workflow.cursor, Math.max(1, terminalRows - (terminalRows <= 12 ? 8 : 10)));
    return (_jsxs(Box, { flexDirection: "column", children: [_jsxs(Text, { wrap: "truncate-middle", children: ["Repository: ", workflow.plan.repositoryPath ?? 'not bound'] }), _jsxs(Text, { children: [workflow.plan.changes.length, " changes \u00B7 ", workflow.selectedIds.length, " selected"] }), _jsx(Text, { children: " " }), !viewport.combinedIndicator && viewport.hiddenBefore > 0 && (_jsxs(Text, { dimColor: true, children: ["  \u2026 ", viewport.hiddenBefore, " earlier"] })), viewport.items.map(({ item: { node, depth } }, index) => {
                const visibleIndex = viewport.start + index;
                const expanded = workflow.expandedNodeIds.includes(node.id);
                const disclosure = node.children.length === 0
                    ? ' '
                    : expanded ? '▼' : '▶';
                if (node.kind === 'advanced') {
                    return (_jsxs(Text, { wrap: "truncate-middle", children: [visibleIndex === workflow.cursor ? '>' : ' ', ' ', deployNodeSelectionMarker(node.changeIds, workflow.selectedIds), ' ', disclosure, " Advanced Cleanup: ", expanded ? 'expanded' : 'collapsed', " (", advanced.length, ' ', advanced.length === 1 ? 'deletion' : 'deletions', ",", ' ', advanced.filter((change) => workflow.selectedIds.includes(change.id)).length || 'none', " selected)"] }, node.id));
                }
                return (_jsxs(Text, { wrap: "truncate-middle", children: ['  '.repeat(depth), visibleIndex === workflow.cursor ? '>' : ' ', ' ', deployNodeSelectionMarker(node.changeIds, workflow.selectedIds), ' ', disclosure, " ", node.label, node.kind !== 'file' && (_jsxs(_Fragment, { children: [" \u00B7 ", node.changeIds.length, ' ', node.changeIds.length === 1 ? 'file' : 'files'] }))] }, node.id));
            }), !viewport.combinedIndicator && viewport.hiddenAfter > 0 && (_jsxs(Text, { dimColor: true, children: ["  \u2026 ", viewport.hiddenAfter, " more"] })), viewport.combinedIndicator && (_jsxs(Text, { dimColor: true, children: ['  ', "\u2026 ", viewport.hiddenBefore, " earlier \u00B7 ", viewport.hiddenAfter, " more"] })), workflow.plan.issues.some((issue) => issue.severity === 'decisionRequired' || issue.severity === 'error') && (_jsx(Text, { color: "red", children: "Apply disabled: regenerate after resolving every required decision and error." }))] }));
}
function listViewport(items, cursor, maximumRows) {
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
        : Math.min(Math.max(cursor - Math.floor(itemRows / 2), 0), maximumStart);
    const end = Math.min(start + itemRows, items.length);
    return {
        items: items.slice(start, end).map((item) => ({ item })),
        start,
        hiddenBefore: maximumRows <= 1 ? 0 : start,
        hiddenAfter: maximumRows <= 1 ? 0 : items.length - end,
        combinedIndicator,
    };
}
function deployNodeSelectionMarker(changeIds, selectedIds) {
    const selected = changeIds.filter((id) => selectedIds.includes(id)).length;
    if (selected === 0)
        return '[ ]';
    if (selected === changeIds.length)
        return '[x]';
    return '[-]';
}
function DeployDiff({ workflow, }) {
    const change = workflow.plan.changes.find((item) => item.id === workflow.changeId);
    if (!change)
        return _jsx(Text, { children: "Selected Deploy change is no longer available." });
    return (_jsxs(Box, { flexDirection: "column", children: [_jsxs(Text, { children: [change.name, " \u00B7 ", change.change] }), _jsxs(Text, { children: ["Apply semantics: ", change.strategy === 'managed-merge'
                        ? 'Managed merge — preserve unowned Native and Local fields.'
                        : 'Whole-file replacement — replace the complete target file.'] }), _jsx(DeployPreviewView, { preview: change.preview })] }));
}
function DeployPreviewView({ preview, }) {
    if (preview.kind === 'binary') {
        return (_jsxs(Box, { flexDirection: "column", children: [_jsx(Text, { children: preview.targetPath }), _jsxs(Text, { children: ['  ', "binary \u00B7 ", preview.bytes, " bytes \u00B7 sha256 ", preview.sha256] })] }));
    }
    return (_jsxs(Box, { flexDirection: "column", children: [_jsx(Text, { children: preview.targetPath }), preview.diff.split('\n').map((line, index) => (_jsxs(Text, { children: ['  ', line] }, `${preview.targetPath}:${index}`)))] }));
}
function DeployConfirmation({ workflow, }) {
    const warnings = deployWarnings(workflow.plan);
    const allConfirmed = warnings.every((warning) => workflow.confirmedIssueCodes.includes(warning.code));
    return (_jsxs(Box, { flexDirection: "column", children: [_jsxs(Text, { children: [workflow.selectedIds.length, " selected changes"] }), warnings.length > 0 && _jsx(Text, { children: "Warnings require explicit confirmation:" }), warnings.map((warning, index) => (_jsxs(Text, { children: [index === workflow.warningCursor ? '>' : ' ', ' ', "[", workflow.confirmedIssueCodes.includes(warning.code) ? 'x' : ' ', "] ", warning.message] }, warning.code))), !allConfirmed && (_jsxs(_Fragment, { children: [_jsx(Text, { children: " " }), _jsx(Text, { color: "yellow", children: "Apply disabled: confirm every warning." })] }))] }));
}
function RestoreWorkflow({ workflow, terminalRows, }) {
    switch (workflow.status) {
        case 'review':
            return (_jsx(RestoreReview, { workflow: workflow, terminalRows: terminalRows }));
        case 'applying':
            return (_jsxs(Box, { flexDirection: "column", children: [_jsx(StatusLine, { tone: "info", label: "Applying", children: "Restoring the latest complete deployment backup transactionally..." }), _jsx(Text, { children: " " }), _jsx(Text, { dimColor: true, children: "Please wait; input is disabled during backup, Apply, and rollback." })] }));
        case 'regenerating':
            return (_jsxs(Box, { flexDirection: "column", children: [_jsx(Text, { children: "The Restore Plan became stale. Regenerating a new preview for review..." }), _jsx(Text, { children: " " }), _jsx(Text, { dimColor: true, children: "Please wait." })] }));
        case 'result':
            return null;
    }
}
function RestoreReview({ workflow, terminalRows, }) {
    const { plan } = workflow;
    const writeCount = plan.changes.filter((change) => change.action === 'restore').length;
    const deleteCount = plan.changes.length - writeCount;
    const hasConflict = plan.issues.some((issue) => issue.code === 'restore.conflict');
    const detail = plan.changes.find((change) => change.id === workflow.detailChangeId);
    if (detail) {
        return (_jsxs(Box, { flexDirection: "column", children: [_jsx(Text, { children: "Focused Restore detail" }), _jsxs(Text, { children: ["Action: ", detail.action === 'restore' ? 'write' : 'delete'] }), _jsxs(Text, { wrap: "wrap", children: ["Target: ", detail.targetPath] }), _jsx(Text, { children: detail.action === 'restore'
                        ? 'The deployment backup will replace this file.'
                        : 'Restore will delete this file because it did not exist in the deployment backup.' })] }));
    }
    const viewport = listViewport(plan.changes, workflow.cursor, Math.max(1, terminalRows - 13));
    return (_jsxs(Box, { flexDirection: "column", children: [_jsxs(Text, { children: ["Repository: ", plan.repositoryPath ?? 'not bound'] }), _jsxs(Text, { children: ["Backup time: ", plan.backup?.createdAt ?? 'not available'] }), _jsxs(Text, { children: ["Impact: ", writeCount, " file(s) to write, ", deleteCount, " file(s) to delete"] }), _jsx(Text, { children: " " }), viewport.hiddenBefore > 0 && (_jsxs(Text, { dimColor: true, children: ["\u2026 ", viewport.hiddenBefore, " earlier changes"] })), viewport.items.map(({ item: change }, visibleIndex) => (_jsxs(Text, { children: [viewport.start + visibleIndex === workflow.cursor ? '>' : ' ', ' ', "[", change.action === 'restore' ? 'write' : 'delete', "] ", change.targetPath] }, change.id))), viewport.hiddenAfter > 0 && (_jsxs(Text, { dimColor: true, children: ["\u2026 ", viewport.hiddenAfter, " more changes"] })), plan.issues.map((issue) => (_jsxs(Box, { flexDirection: "column", children: [_jsxs(StatusLine, { tone: "error", label: issue.code === 'restore.conflict'
                            ? 'Restore Conflict'
                            : 'Error', children: ["Blocked \u00B7 ", issue.message] }), issue.details?.split('\n').map((detail) => (_jsxs(Text, { children: ['  ', detail] }, `${issue.code}:${detail}`)))] }, issue.code))), (plan.status === 'failed' || !plan.readyToApply || hasConflict) && (_jsx(Text, { color: "red", children: "Apply disabled: resolve the blocking Restore error, then regenerate the Plan." })), plan.nextActions.map((action) => (_jsxs(Text, { children: ["Next: ", action] }, action)))] }));
}
