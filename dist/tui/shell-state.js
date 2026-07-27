export function createInitialShellState(route) {
    return {
        page: { route, status: 'loading' },
        reports: {},
        exitReason: null,
    };
}
export function shellReducer(state, action) {
    switch (action.type) {
        case 'overview.loaded':
            if (state.page.route !== 'overview')
                return state;
            return {
                ...state,
                reports: {
                    ...state.reports,
                    overview: action.report,
                },
                page: {
                    route: 'overview',
                    status: 'ready',
                    report: action.report,
                },
            };
        case 'environment.loaded':
            if (state.page.route !== 'environment')
                return state;
            return {
                ...state,
                reports: {
                    ...state.reports,
                    environment: action.report,
                },
                page: {
                    route: 'environment',
                    status: 'ready',
                    report: action.report,
                },
            };
        case 'capture.loaded':
            if (state.page.route !== 'capture')
                return state;
            if (action.plan.status === 'failed') {
                return {
                    ...state,
                    page: {
                        route: 'capture',
                        status: 'failure',
                        message: action.plan.error.message,
                    },
                };
            }
            return {
                ...state,
                page: {
                    route: 'capture',
                    status: 'ready',
                    workflow: {
                        status: 'selection',
                        plan: action.plan,
                        cursor: 0,
                        selectedIds: action.plan.changes
                            .filter((change) => change.defaultSelected && change.change !== 'delete')
                            .map((change) => change.id),
                    },
                },
            };
        case 'capture.move':
            return updateCaptureWorkflow(state, (workflow) => moveCaptureCursor(workflow, action.delta));
        case 'capture.toggleSelection':
            return updateCaptureWorkflow(state, toggleCaptureSelection);
        case 'capture.openDiff':
            return updateCaptureWorkflow(state, openCaptureDiff);
        case 'capture.closeDiff':
            return updateCaptureWorkflow(state, closeCaptureDiff);
        case 'capture.chooseDecision':
            return updateCaptureWorkflow(state, chooseCaptureDecision);
        case 'capture.toggleWarning':
            return updateCaptureWorkflow(state, toggleCaptureWarning);
        case 'capture.continue':
            return updateCaptureWorkflow(state, continueCaptureWorkflow);
        case 'capture.back':
            return updateCaptureWorkflow(state, backCaptureWorkflow);
        case 'capture.apply':
            return updateCaptureWorkflow(state, beginCaptureApply);
        case 'capture.applied':
            if (state.page.route !== 'capture'
                || state.page.status !== 'ready'
                || state.page.workflow.status !== 'applying')
                return state;
            if (action.result.status === 'failed'
                && action.result.error.code === 'operation.stalePlan') {
                return {
                    ...state,
                    page: {
                        route: 'capture',
                        status: 'ready',
                        workflow: { status: 'regenerating' },
                    },
                };
            }
            return {
                ...state,
                captureResult: action.result,
                page: {
                    route: 'capture',
                    status: 'ready',
                    workflow: {
                        status: 'result',
                        result: action.result,
                    },
                },
            };
        case 'page.failed':
            if (state.page.route !== action.route)
                return state;
            return {
                ...state,
                page: {
                    route: action.route,
                    status: 'failure',
                    message: action.message,
                },
            };
        case 'navigate':
            return {
                ...state,
                page: {
                    route: action.route,
                    status: 'loading',
                },
            };
        case 'exit':
            return { ...state, exitReason: 'completed' };
        case 'cancel':
            return { ...state, exitReason: 'interrupted' };
    }
}
function updateCaptureWorkflow(state, update) {
    if (state.page.route !== 'capture' || state.page.status !== 'ready')
        return state;
    return {
        ...state,
        page: {
            ...state.page,
            workflow: update(state.page.workflow),
        },
    };
}
function moveCaptureCursor(workflow, delta) {
    if (workflow.status === 'selection') {
        return {
            ...workflow,
            cursor: wrapIndex(workflow.cursor + delta, workflow.plan.changes.length),
        };
    }
    if (workflow.status === 'decision') {
        return {
            ...workflow,
            cursor: wrapIndex(workflow.cursor + delta, currentDecisionChoices(workflow).length),
        };
    }
    if (workflow.status === 'confirmation') {
        return {
            ...workflow,
            warningCursor: wrapIndex(workflow.warningCursor + delta, captureWarnings(workflow.plan).length),
        };
    }
    return workflow;
}
function toggleCaptureSelection(workflow) {
    if (workflow.status !== 'selection')
        return workflow;
    const change = workflow.plan.changes[workflow.cursor];
    if (!change || change.decisionGroupId)
        return workflow;
    return {
        ...workflow,
        selectedIds: toggleId(workflow.selectedIds, change.id),
    };
}
function openCaptureDiff(workflow) {
    if (workflow.status !== 'selection')
        return workflow;
    const change = workflow.plan.changes[workflow.cursor];
    if (!change)
        return workflow;
    return {
        status: 'diff',
        plan: workflow.plan,
        cursor: workflow.cursor,
        selectedIds: workflow.selectedIds,
        changeId: change.id,
    };
}
function closeCaptureDiff(workflow) {
    if (workflow.status !== 'diff')
        return workflow;
    return {
        status: 'selection',
        plan: workflow.plan,
        cursor: workflow.cursor,
        selectedIds: workflow.selectedIds,
    };
}
function chooseCaptureDecision(workflow) {
    if (workflow.status !== 'decision')
        return workflow;
    const choices = currentDecisionChoices(workflow);
    const choice = choices[workflow.cursor];
    if (!choice?.decisionGroupId)
        return workflow;
    const groupIds = new Set(choices.map((item) => item.id));
    return {
        ...workflow,
        selectedIds: [
            ...workflow.selectedIds.filter((id) => !groupIds.has(id)),
            choice.id,
        ],
    };
}
function toggleCaptureWarning(workflow) {
    if (workflow.status !== 'confirmation')
        return workflow;
    const warning = captureWarnings(workflow.plan)[workflow.warningCursor];
    if (!warning)
        return workflow;
    return {
        ...workflow,
        confirmedIssueCodes: toggleId(workflow.confirmedIssueCodes, warning.code),
    };
}
function continueCaptureWorkflow(workflow) {
    if (workflow.status === 'selection') {
        if (workflow.plan.issues.some((issue) => issue.severity === 'error')) {
            return workflow;
        }
        const groups = captureDecisionGroups(workflow.plan);
        if (groups.length > 0) {
            return {
                status: 'decision',
                plan: workflow.plan,
                selectedIds: workflow.selectedIds,
                groupIndex: 0,
                cursor: 0,
            };
        }
        if (hasUnresolvedDecisionIssue(workflow.plan))
            return workflow;
        return createCaptureConfirmation(workflow.plan, workflow.selectedIds);
    }
    if (workflow.status === 'decision') {
        const choices = currentDecisionChoices(workflow);
        if (!choices.some((choice) => workflow.selectedIds.includes(choice.id))) {
            return workflow;
        }
        const nextGroup = workflow.groupIndex + 1;
        if (nextGroup < captureDecisionGroups(workflow.plan).length) {
            return {
                ...workflow,
                groupIndex: nextGroup,
                cursor: 0,
            };
        }
        return createCaptureConfirmation(workflow.plan, workflow.selectedIds);
    }
    return workflow;
}
function backCaptureWorkflow(workflow) {
    if (workflow.status === 'diff')
        return closeCaptureDiff(workflow);
    if (workflow.status === 'decision' || workflow.status === 'confirmation') {
        return {
            status: 'selection',
            plan: workflow.plan,
            cursor: 0,
            selectedIds: workflow.selectedIds,
        };
    }
    return workflow;
}
function beginCaptureApply(workflow) {
    if (workflow.status !== 'confirmation')
        return workflow;
    const warnings = captureWarnings(workflow.plan);
    const allWarningsConfirmed = warnings.every((warning) => workflow.confirmedIssueCodes.includes(warning.code));
    if (!allWarningsConfirmed)
        return workflow;
    if (workflow.plan.issues.some((issue) => issue.severity === 'error')) {
        return workflow;
    }
    return {
        status: 'applying',
        plan: workflow.plan,
        selectedIds: workflow.selectedIds,
        confirmedIssueCodes: workflow.confirmedIssueCodes,
    };
}
function createCaptureConfirmation(plan, selectedIds) {
    return {
        status: 'confirmation',
        plan,
        selectedIds,
        confirmedIssueCodes: [],
        warningCursor: 0,
    };
}
export function captureDecisionGroups(plan) {
    const groups = new Map();
    for (const change of plan.changes) {
        if (!change.decisionGroupId)
            continue;
        groups.set(change.decisionGroupId, [...(groups.get(change.decisionGroupId) ?? []), change]);
    }
    return [...groups.values()];
}
export function captureWarnings(plan) {
    return plan.issues.filter((issue) => issue.severity === 'warning');
}
function currentDecisionChoices(workflow) {
    return captureDecisionGroups(workflow.plan)[workflow.groupIndex] ?? [];
}
function hasUnresolvedDecisionIssue(plan) {
    return plan.issues.some((issue) => issue.severity === 'decisionRequired')
        && captureDecisionGroups(plan).length === 0;
}
function toggleId(ids, id) {
    return ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id];
}
function wrapIndex(index, length) {
    if (length === 0)
        return 0;
    return ((index % length) + length) % length;
}
