import { jsx as _jsx } from "react/jsx-runtime";
import { render, useApp, useInput, } from 'ink';
import { useEffect, useReducer } from 'react';
import { applyCapturePlan, createCapturePlan, } from '../operations/capture.js';
import { inspectEnvironment, } from '../operations/environment.js';
import { inspectStatus, } from '../operations/status.js';
import { readState, writeState } from '../utils/state.js';
import { createInitialShellState, shellReducer, } from './shell-state.js';
import { ShellView } from './shell-view.js';
export async function runTuiShell(context, initialRoute, dependencies = {}, runtime = {}) {
    let instance;
    const wasRaw = Boolean(process.stdin.isRaw);
    try {
        instance = (runtime.render ?? render)(_jsx(Shell, { context: context, initialRoute: initialRoute, dependencies: dependencies }), {
            alternateScreen: true,
            exitOnCtrlC: false,
            patchConsole: false,
        });
        return await instance.waitUntilExit();
    }
    catch (error) {
        if (!instance) {
            (runtime.restoreAfterRenderFailure ?? restoreAfterRenderFailure)(wasRaw);
        }
        throw error;
    }
    finally {
        instance?.unmount();
    }
}
function Shell({ context, initialRoute, dependencies }) {
    const [state, dispatch] = useReducer(shellReducer, initialRoute, createInitialShellState);
    const { exit } = useApp();
    useEffect(() => {
        if (state.page.status !== 'loading')
            return;
        const route = state.page.route;
        let active = true;
        const load = loadRoute(context, route, dependencies);
        void load.then((report) => {
            if (!active)
                return;
            if (report.operation === 'status') {
                dispatch({ type: 'overview.loaded', report });
            }
            else if (report.operation === 'discover') {
                dispatch({ type: 'environment.loaded', report });
            }
            else {
                dispatch({ type: 'capture.loaded', plan: report });
            }
        }, (error) => {
            if (!active)
                return;
            dispatch({
                type: 'page.failed',
                route,
                message: error instanceof Error ? error.message : String(error),
            });
        });
        return () => {
            active = false;
        };
    }, [context, dependencies, state.page]);
    useEffect(() => {
        if (state.page.route !== 'capture'
            || state.page.status !== 'ready'
            || state.page.workflow.status !== 'regenerating')
            return;
        let active = true;
        void (dependencies.createCapturePlan ?? createCapturePlan)(context).then((plan) => {
            if (active)
                dispatch({ type: 'capture.loaded', plan });
        }, (error) => {
            if (!active)
                return;
            dispatch({
                type: 'page.failed',
                route: 'capture',
                message: error instanceof Error ? error.message : String(error),
            });
        });
        return () => {
            active = false;
        };
    }, [context, dependencies, state.page]);
    useEffect(() => {
        if (state.page.route !== 'capture'
            || state.page.status !== 'ready'
            || state.page.workflow.status !== 'applying')
            return;
        const workflow = state.page.workflow;
        let active = true;
        void (dependencies.applyCapturePlan ?? applyCapturePlan)(context, workflow.plan, {
            changeIds: workflow.selectedIds,
            confirmedIssueCodes: workflow.confirmedIssueCodes,
        }).then((result) => {
            if (!active)
                return;
            let finalResult = result;
            if (result.status === 'succeeded') {
                try {
                    (dependencies.recordCaptureSuccess ?? recordCaptureSuccess)(context);
                }
                catch {
                    finalResult = {
                        ...result,
                        issues: [
                            ...result.issues,
                            {
                                severity: 'warning',
                                code: 'capture.stateRecordFailed',
                                message: 'Capture succeeded, but local operation history could not be updated.',
                            },
                        ],
                        nextActions: [
                            'Check local MCV state permissions before the next operation.',
                        ],
                    };
                }
            }
            dispatch({ type: 'capture.applied', result: finalResult });
        }, (error) => {
            if (!active)
                return;
            dispatch({
                type: 'page.failed',
                route: 'capture',
                message: error instanceof Error ? error.message : String(error),
            });
        });
        return () => {
            active = false;
        };
    }, [context, dependencies, state.page]);
    useInput((input, key) => {
        const captureWorkflow = state.page.route === 'capture'
            && state.page.status === 'ready'
            ? state.page.workflow
            : undefined;
        if (captureWorkflow?.status === 'applying'
            || captureWorkflow?.status === 'regenerating')
            return;
        if (key.ctrl && input === 'c') {
            dispatch({ type: 'cancel' });
            return;
        }
        if (input === 'q') {
            dispatch({ type: 'exit' });
            return;
        }
        if (state.page.route === 'overview'
            && input === 'e') {
            dispatch({ type: 'navigate', route: 'environment' });
            return;
        }
        if (state.page.route === 'overview'
            && (input === 'c' || key.return)) {
            dispatch({ type: 'navigate', route: 'capture' });
            return;
        }
        if (state.page.route === 'environment' && key.escape) {
            dispatch({ type: 'navigate', route: 'overview' });
            return;
        }
        if (state.page.route !== 'capture' || state.page.status !== 'ready')
            return;
        if (captureWorkflow?.status === 'result' && key.return) {
            dispatch({ type: 'navigate', route: 'overview' });
            return;
        }
        if (key.upArrow) {
            dispatch({ type: 'capture.move', delta: -1 });
            return;
        }
        if (key.downArrow) {
            dispatch({ type: 'capture.move', delta: 1 });
            return;
        }
        if (captureWorkflow?.status === 'selection') {
            if (input === ' ')
                dispatch({ type: 'capture.toggleSelection' });
            else if (input === 'd')
                dispatch({ type: 'capture.openDiff' });
            else if (key.return)
                dispatch({ type: 'capture.continue' });
            else if (key.escape)
                dispatch({ type: 'navigate', route: 'overview' });
            return;
        }
        if (captureWorkflow?.status === 'diff' && key.escape) {
            dispatch({ type: 'capture.closeDiff' });
            return;
        }
        if (captureWorkflow?.status === 'decision') {
            if (input === ' ')
                dispatch({ type: 'capture.chooseDecision' });
            else if (key.return)
                dispatch({ type: 'capture.continue' });
            else if (key.escape)
                dispatch({ type: 'capture.back' });
            return;
        }
        if (captureWorkflow?.status === 'confirmation') {
            if (input === ' ')
                dispatch({ type: 'capture.toggleWarning' });
            else if (key.return)
                dispatch({ type: 'capture.apply' });
            else if (key.escape)
                dispatch({ type: 'capture.back' });
        }
    });
    useEffect(() => {
        if (!state.exitReason)
            return;
        exit(createOutcome(state, initialRoute));
    }, [exit, initialRoute, state]);
    return _jsx(ShellView, { state: state });
}
function createOutcome(state, initialRoute) {
    const failureMessage = state.page.status === 'failure'
        ? state.page.message
        : state.captureResult?.status === 'failed'
            ? state.captureResult.error.message
            : undefined;
    const summary = summarizeDirectRoute(state, initialRoute);
    return {
        reason: state.exitReason ?? 'completed',
        route: state.page.route,
        ...(summary ? { summary } : {}),
        ...(failureMessage ? { failureMessage } : {}),
        ...(state.captureResult
            ? { operationStatus: state.captureResult.status }
            : {}),
    };
}
function summarizeDirectRoute(state, initialRoute) {
    if (initialRoute === 'overview') {
        const report = state.reports.overview;
        if (!report)
            return undefined;
        return `Overview: ${report.pendingDeployment.total} pending deployment changes; ${report.postDeployLocalState.drift} local managed changes; ${report.environment.missingVariables.length} missing variables.`;
    }
    if (initialRoute === 'environment') {
        const report = state.reports.environment;
        if (!report)
            return undefined;
        const detected = report.environments.filter((environment) => environment.detected).length;
        return `Environment: ${detected}/${report.environments.length} IDEs detected; ${report.missingVariables.length} missing variables.`;
    }
    const result = state.captureResult;
    if (!result)
        return 'Capture closed without applying changes.';
    if (result.status === 'succeeded') {
        return `Captured ${result.data?.appliedChangeIds.length ?? 0} selected item(s) into ${result.repositoryPath}.`;
    }
    return result.status === 'blocked'
        ? 'Capture was blocked; Repository was not changed.'
        : `Capture failed: ${result.error.message}`;
}
function loadRoute(context, route, dependencies) {
    if (route === 'overview') {
        return (dependencies.inspectOverview ?? inspectStatus)(context);
    }
    if (route === 'environment') {
        return (dependencies.inspectEnvironment ?? inspectEnvironment)(context);
    }
    return (dependencies.createCapturePlan ?? createCapturePlan)(context);
}
function recordCaptureSuccess(context) {
    const deviceState = readState(context);
    deviceState.lastOperation = {
        kind: 'capture',
        time: new Date().toISOString(),
        success: true,
    };
    writeState(context, deviceState);
}
function restoreAfterRenderFailure(wasRaw) {
    if (typeof process.stdin.setRawMode === 'function'
        && Boolean(process.stdin.isRaw) !== wasRaw) {
        process.stdin.setRawMode(wasRaw);
    }
    process.stdout.write('\u001b[?25h\u001b[?1049l');
}
