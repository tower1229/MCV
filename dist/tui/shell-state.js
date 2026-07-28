import { buildDeploySelectionTree, flattenDeploySelectionTree, } from './deploy-selection-tree.js';
import { PRIMARY_DESTINATION_IDS, } from './overview-navigation.js';
export function createInitialShellState(route) {
    return {
        page: route === 'help'
            ? { route, status: 'ready' }
            : { route, status: 'loading' },
        reports: {},
        postInitOnboarding: false,
        repositoryResumeRoute: route === 'repository' ? 'overview' : route,
        overviewFocusId: 'overview',
        scrollOffset: 0,
        exitReason: null,
    };
}
export function shellReducer(state, action) {
    if (isTransactionApplying(state)
        && !isTransactionCompletion(action)
        && action.type !== 'page.failed')
        return state;
    switch (action.type) {
        case 'repository.loaded':
            return {
                ...state,
                repositoryResumeRoute: action.resumeRoute,
                page: {
                    route: 'repository',
                    status: 'ready',
                    workflow: {
                        status: 'menu',
                        report: action.report,
                        currentDirectory: action.currentDirectory,
                        cursor: 0,
                        actions: repositoryMenuActions(action.report, action.currentDirectory),
                        resumeRoute: action.resumeRoute,
                    },
                },
            };
        case 'repository.move':
            return updateRepositoryWorkflow(state, (workflow) => {
                if (workflow.status !== 'menu')
                    return workflow;
                return {
                    ...workflow,
                    cursor: wrapIndex(workflow.cursor + action.delta, workflow.actions.length),
                };
            });
        case 'repository.path':
            return updateRepositoryWorkflow(state, (workflow) => workflow.status === 'path'
                ? { ...workflow, value: action.value }
                : workflow);
        case 'repository.enterPath':
            return updateRepositoryWorkflow(state, (workflow) => workflow.status === 'menu'
                ? {
                    status: 'path',
                    report: workflow.report,
                    currentDirectory: workflow.currentDirectory,
                    value: '',
                    resumeRoute: workflow.resumeRoute,
                }
                : workflow);
        case 'repository.plan':
            return updateRepositoryWorkflow(state, (workflow) => ({
                status: 'plan',
                step: action,
                report: workflow.report,
                currentDirectory: workflow.currentDirectory,
                resumeRoute: workflow.resumeRoute,
            }));
        case 'repository.apply':
            return updateRepositoryWorkflow(state, (workflow) => workflow.status === 'plan' && workflow.step.plan.status === 'planned'
                ? { ...workflow, status: 'applying' }
                : workflow);
        case 'repository.applied': {
            const stateWithRepositoryResult = {
                ...state,
                repositoryResult: {
                    operation: action.operation,
                    result: action.result,
                },
            };
            if (action.result.status === 'succeeded') {
                if (action.operation === 'init') {
                    return {
                        ...stateWithRepositoryResult,
                        page: { route: 'environment', status: 'loading' },
                        postInitOnboarding: true,
                    };
                }
                if (action.operation === 'bind'
                    && state.page.route === 'repository'
                    && state.page.status === 'ready') {
                    return {
                        ...stateWithRepositoryResult,
                        page: {
                            route: state.page.workflow.resumeRoute,
                            status: 'loading',
                        },
                    };
                }
                return {
                    ...stateWithRepositoryResult,
                    page: { route: 'repository', status: 'loading' },
                };
            }
            return updateRepositoryWorkflow(stateWithRepositoryResult, (workflow) => ({
                status: 'result',
                step: action,
                report: workflow.report,
                currentDirectory: workflow.currentDirectory,
                resumeRoute: workflow.resumeRoute,
            }));
        }
        case 'repository.back':
            return updateRepositoryWorkflow(state, (workflow) => ({
                status: 'menu',
                report: workflow.report,
                currentDirectory: workflow.currentDirectory,
                cursor: 0,
                actions: repositoryMenuActions(workflow.report, workflow.currentDirectory),
                resumeRoute: workflow.resumeRoute,
            }));
        case 'onboarding.continue':
            if (!state.postInitOnboarding
                || state.page.route !== 'environment'
                || state.page.status !== 'ready')
                return state;
            return {
                ...state,
                scrollOffset: 0,
                page: { route: 'capture', status: 'loading' },
                postInitOnboarding: false,
            };
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
        case 'overview.move':
            if (state.page.route !== 'overview')
                return state;
            return {
                ...state,
                overviewFocusId: PRIMARY_DESTINATION_IDS[wrapIndex(PRIMARY_DESTINATION_IDS.indexOf(state.overviewFocusId) + action.delta, PRIMARY_DESTINATION_IDS.length)] ?? 'overview',
            };
        case 'overview.open':
            if (state.page.route !== 'overview')
                return state;
            return {
                ...state,
                scrollOffset: 0,
                ...(state.overviewFocusId === 'repository'
                    ? { repositoryResumeRoute: 'overview' }
                    : {}),
                page: state.overviewFocusId === 'help'
                    ? { route: 'help', status: 'ready' }
                    : { route: state.overviewFocusId, status: 'loading' },
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
                scrollOffset: 0,
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
                scrollOffset: 0,
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
        case 'deploy.loaded':
            if (state.page.route !== 'deploy')
                return state;
            if (action.plan.status === 'failed') {
                return {
                    ...state,
                    page: {
                        route: 'deploy',
                        status: 'failure',
                        message: action.plan.error.message,
                    },
                };
            }
            return {
                ...state,
                scrollOffset: 0,
                page: {
                    route: 'deploy',
                    status: 'ready',
                    workflow: {
                        status: 'selection',
                        plan: action.plan,
                        cursor: 0,
                        selectedIds: initialDeploySelection(action.plan, action.lastSelection),
                        expandedNodeIds: [],
                    },
                },
            };
        case 'deploy.move':
            return updateDeployWorkflow(state, (workflow) => moveDeployCursor(workflow, action.delta));
        case 'deploy.focus':
            return updateDeployWorkflow(state, (workflow) => focusDeployCursor(workflow, action.position));
        case 'deploy.expand':
            return updateDeployWorkflow(state, expandDeployNode);
        case 'deploy.collapse':
            return updateDeployWorkflow(state, collapseDeployNode);
        case 'deploy.toggleSelection':
            return updateDeployWorkflow(state, toggleDeploySelection);
        case 'deploy.toggleAdvanced':
            return updateDeployWorkflow(state, toggleDeployAdvanced);
        case 'deploy.openDiff':
            return updateDeployWorkflow(state, openDeployDiff);
        case 'deploy.closeDiff':
            return updateDeployWorkflow(state, closeDeployDiff);
        case 'deploy.toggleWarning':
            return updateDeployWorkflow(state, toggleDeployWarning);
        case 'deploy.continue':
            return updateDeployWorkflow(state, continueDeployWorkflow);
        case 'deploy.back':
            return updateDeployWorkflow(state, backDeployWorkflow);
        case 'deploy.apply':
            return updateDeployWorkflow(state, beginDeployApply);
        case 'deploy.applied':
            if (state.page.route !== 'deploy'
                || state.page.status !== 'ready'
                || state.page.workflow.status !== 'applying')
                return state;
            if (action.result.status === 'failed'
                && action.result.error.code === 'operation.stalePlan') {
                return {
                    ...state,
                    page: {
                        route: 'deploy',
                        status: 'ready',
                        workflow: { status: 'regenerating' },
                    },
                };
            }
            return {
                ...state,
                scrollOffset: 0,
                deployResult: action.result,
                page: {
                    route: 'deploy',
                    status: 'ready',
                    workflow: {
                        status: 'result',
                        result: action.result,
                    },
                },
            };
        case 'restore.loaded':
            if (state.page.route !== 'restore')
                return state;
            return {
                ...state,
                scrollOffset: 0,
                page: {
                    route: 'restore',
                    status: 'ready',
                    workflow: {
                        status: 'review',
                        plan: action.plan,
                        cursor: 0,
                    },
                },
            };
        case 'restore.move':
            return updateRestoreWorkflow(state, (workflow) => {
                if (workflow.status !== 'review' || workflow.detailChangeId) {
                    return workflow;
                }
                return {
                    ...workflow,
                    cursor: wrapIndex(workflow.cursor + action.delta, workflow.plan.changes.length),
                };
            });
        case 'restore.openDetail':
            return updateRestoreWorkflow(state, (workflow) => {
                if (workflow.status !== 'review' || workflow.detailChangeId) {
                    return workflow;
                }
                const change = workflow.plan.changes[workflow.cursor];
                return change
                    ? { ...workflow, detailChangeId: change.id }
                    : workflow;
            });
        case 'restore.back':
            if (state.page.route !== 'restore'
                || state.page.status !== 'ready'
                || state.page.workflow.status !== 'review')
                return state;
            if (state.page.workflow.detailChangeId) {
                return {
                    ...state,
                    page: {
                        ...state.page,
                        workflow: {
                            ...state.page.workflow,
                            detailChangeId: undefined,
                        },
                    },
                };
            }
            return {
                ...state,
                scrollOffset: 0,
                page: { route: 'overview', status: 'loading' },
            };
        case 'restore.apply':
            return updateRestoreWorkflow(state, (workflow) => workflow.status === 'review'
                && workflow.plan.status === 'planned'
                && workflow.plan.readyToApply
                && !workflow.plan.issues.some((issue) => issue.severity === 'error')
                ? { status: 'applying', plan: workflow.plan }
                : workflow);
        case 'restore.applied':
            if (state.page.route !== 'restore'
                || state.page.status !== 'ready'
                || state.page.workflow.status !== 'applying')
                return state;
            if (action.result.status === 'failed'
                && action.result.error.code === 'operation.stalePlan') {
                return {
                    ...state,
                    page: {
                        route: 'restore',
                        status: 'ready',
                        workflow: { status: 'regenerating' },
                    },
                };
            }
            return {
                ...state,
                scrollOffset: 0,
                restoreResult: action.result,
                page: {
                    route: 'restore',
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
        case 'page.scroll':
            return {
                ...state,
                scrollOffset: Math.min(Math.max(0, action.maximum), Math.max(0, state.scrollOffset + action.delta)),
            };
        case 'navigate':
            return {
                ...state,
                scrollOffset: 0,
                ...(action.route === 'repository' && state.page.route !== 'repository'
                    ? { repositoryResumeRoute: state.page.route }
                    : {}),
                page: action.route === 'help'
                    ? { route: 'help', status: 'ready' }
                    : { route: action.route, status: 'loading' },
            };
        case 'exit':
            return { ...state, exitReason: 'completed' };
        case 'cancel':
            if (state.page.status === 'ready'
                && (state.page.route === 'capture'
                    || state.page.route === 'deploy'
                    || state.page.route === 'restore')
                && state.page.workflow.status === 'applying')
                return state;
            return { ...state, exitReason: 'interrupted' };
    }
}
function isTransactionApplying(state) {
    return state.page.status === 'ready'
        && (state.page.route === 'capture'
            || state.page.route === 'deploy'
            || state.page.route === 'restore'
            || state.page.route === 'repository')
        && state.page.workflow.status === 'applying';
}
function isTransactionCompletion(action) {
    return action.type === 'capture.applied'
        || action.type === 'deploy.applied'
        || action.type === 'restore.applied'
        || action.type === 'repository.applied';
}
function updateRepositoryWorkflow(state, update) {
    if (state.page.route !== 'repository' || state.page.status !== 'ready') {
        return state;
    }
    return {
        ...state,
        page: {
            ...state.page,
            workflow: update(state.page.workflow),
        },
    };
}
function repositoryMenuActions(report, currentDirectory) {
    if (report.valid)
        return ['continue', 'rebind', 'unbind'];
    if (report.issues.some((issue) => issue.code === 'repository.migrationRequired')) {
        return ['migrate', 'rebind', 'unbind'];
    }
    if (report.issues.some((issue) => issue.code === 'repository.idMismatch'
        || issue.code === 'repository.invalidManifest')
        && report.repositoryPath) {
        return ['rebind', 'unbind'];
    }
    if (currentDirectory.valid) {
        return ['bind-current', 'enter-path'];
    }
    if (currentDirectory.issues.some((issue) => issue.code === 'repository.migrationRequired')) {
        return ['migrate', 'enter-path'];
    }
    return ['init-here', 'enter-path'];
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
function updateDeployWorkflow(state, update) {
    if (state.page.route !== 'deploy' || state.page.status !== 'ready')
        return state;
    return {
        ...state,
        page: {
            ...state.page,
            workflow: update(state.page.workflow),
        },
    };
}
function updateRestoreWorkflow(state, update) {
    if (state.page.route !== 'restore' || state.page.status !== 'ready') {
        return state;
    }
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
function initialDeploySelection(plan, lastSelection) {
    return plan.changes
        .filter((change) => {
        if (change.group === 'advanced' || change.change === 'delete')
            return false;
        if (!lastSelection)
            return change.defaultSelected;
        return lastSelection[change.ide]?.includes(change.capability) === true;
    })
        .map((change) => change.id);
}
export function deployVisibleNodes(workflow) {
    return flattenDeploySelectionTree(buildDeploySelectionTree(workflow.plan), workflow.expandedNodeIds);
}
export function deployWarnings(plan) {
    return plan.issues.filter((issue) => issue.severity === 'warning');
}
function moveDeployCursor(workflow, delta) {
    if (workflow.status === 'selection') {
        const visible = deployVisibleNodes(workflow);
        return {
            ...workflow,
            cursor: clampIndex(workflow.cursor + delta, visible.length),
        };
    }
    if (workflow.status === 'confirmation') {
        return {
            ...workflow,
            warningCursor: wrapIndex(workflow.warningCursor + delta, deployWarnings(workflow.plan).length),
        };
    }
    return workflow;
}
function focusDeployCursor(workflow, position) {
    if (workflow.status !== 'selection')
        return workflow;
    return {
        ...workflow,
        cursor: position === 'first'
            ? 0
            : Math.max(0, deployVisibleNodes(workflow).length - 1),
    };
}
function toggleDeploySelection(workflow) {
    if (workflow.status !== 'selection')
        return workflow;
    const node = deployVisibleNodes(workflow)[workflow.cursor]?.node;
    if (!node)
        return workflow;
    const selected = new Set(workflow.selectedIds);
    const allSelected = node.changeIds.every((id) => selected.has(id));
    for (const id of node.changeIds) {
        if (allSelected)
            selected.delete(id);
        else
            selected.add(id);
    }
    return {
        ...workflow,
        selectedIds: [...selected],
    };
}
function expandDeployNode(workflow) {
    if (workflow.status !== 'selection')
        return workflow;
    const node = deployVisibleNodes(workflow)[workflow.cursor]?.node;
    if (!node || node.children.length === 0)
        return workflow;
    if (workflow.expandedNodeIds.includes(node.id)) {
        return {
            ...workflow,
            cursor: clampIndex(workflow.cursor + 1, deployVisibleNodes(workflow).length),
        };
    }
    return {
        ...workflow,
        expandedNodeIds: [...workflow.expandedNodeIds, node.id],
    };
}
function collapseDeployNode(workflow) {
    if (workflow.status !== 'selection')
        return workflow;
    const visible = deployVisibleNodes(workflow);
    const focused = visible[workflow.cursor];
    if (!focused)
        return workflow;
    if (workflow.expandedNodeIds.includes(focused.node.id)) {
        return {
            ...workflow,
            expandedNodeIds: workflow.expandedNodeIds.filter((id) => id !== focused.node.id),
        };
    }
    if (!focused.parentId)
        return workflow;
    const parentIndex = visible.findIndex(({ node }) => node.id === focused.parentId);
    return parentIndex < 0 ? workflow : { ...workflow, cursor: parentIndex };
}
function toggleDeployAdvanced(workflow) {
    if (workflow.status !== 'selection')
        return workflow;
    const visible = deployVisibleNodes(workflow);
    const advancedIndex = visible.findIndex(({ node }) => node.id === 'advanced');
    const expanded = workflow.expandedNodeIds.includes('advanced');
    return {
        ...workflow,
        cursor: advancedIndex < 0 ? workflow.cursor : advancedIndex,
        expandedNodeIds: expanded
            ? workflow.expandedNodeIds.filter((id) => id !== 'advanced')
            : [...workflow.expandedNodeIds, 'advanced'],
    };
}
function openDeployDiff(workflow) {
    if (workflow.status !== 'selection')
        return workflow;
    const node = deployVisibleNodes(workflow)[workflow.cursor]?.node;
    const change = node?.change;
    if (!change)
        return workflow;
    return {
        status: 'diff',
        plan: workflow.plan,
        cursor: workflow.cursor,
        selectedIds: workflow.selectedIds,
        expandedNodeIds: workflow.expandedNodeIds,
        changeId: change.id,
    };
}
function closeDeployDiff(workflow) {
    if (workflow.status !== 'diff')
        return workflow;
    return {
        status: 'selection',
        plan: workflow.plan,
        cursor: workflow.cursor,
        selectedIds: workflow.selectedIds,
        expandedNodeIds: workflow.expandedNodeIds,
    };
}
function toggleDeployWarning(workflow) {
    if (workflow.status !== 'confirmation')
        return workflow;
    const warning = deployWarnings(workflow.plan)[workflow.warningCursor];
    if (!warning)
        return workflow;
    return {
        ...workflow,
        confirmedIssueCodes: toggleId(workflow.confirmedIssueCodes, warning.code),
    };
}
function continueDeployWorkflow(workflow) {
    if (workflow.status !== 'selection')
        return workflow;
    if (workflow.plan.issues.some((issue) => issue.severity === 'decisionRequired' || issue.severity === 'error')) {
        return workflow;
    }
    return {
        status: 'confirmation',
        plan: workflow.plan,
        selectedIds: workflow.selectedIds,
        confirmedIssueCodes: [],
        warningCursor: 0,
        expandedNodeIds: workflow.expandedNodeIds,
    };
}
function backDeployWorkflow(workflow) {
    if (workflow.status === 'diff')
        return closeDeployDiff(workflow);
    if (workflow.status !== 'confirmation')
        return workflow;
    return {
        status: 'selection',
        plan: workflow.plan,
        cursor: 0,
        selectedIds: workflow.selectedIds,
        expandedNodeIds: workflow.expandedNodeIds,
    };
}
function beginDeployApply(workflow) {
    if (workflow.status !== 'confirmation')
        return workflow;
    if (workflow.plan.issues.some((issue) => issue.severity === 'decisionRequired' || issue.severity === 'error')) {
        return workflow;
    }
    if (!deployWarnings(workflow.plan).every((warning) => workflow.confirmedIssueCodes.includes(warning.code))) {
        return workflow;
    }
    return {
        status: 'applying',
        plan: workflow.plan,
        selectedIds: workflow.selectedIds,
        confirmedIssueCodes: workflow.confirmedIssueCodes,
    };
}
function clampIndex(index, length) {
    if (length === 0)
        return 0;
    return Math.min(Math.max(index, 0), length - 1);
}
