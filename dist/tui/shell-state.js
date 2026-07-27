export function createInitialShellState(route) {
    return {
        page: { route, status: 'loading' },
        reports: {},
        postInitOnboarding: false,
        repositoryResumeRoute: route === 'repository' ? 'overview' : route,
        exitReason: null,
    };
}
export function shellReducer(state, action) {
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
        case 'repository.applied':
            if (action.result.status === 'succeeded') {
                if (action.operation === 'init') {
                    return {
                        ...state,
                        page: { route: 'environment', status: 'loading' },
                        postInitOnboarding: true,
                    };
                }
                if (action.operation === 'bind'
                    && state.page.route === 'repository'
                    && state.page.status === 'ready') {
                    return {
                        ...state,
                        page: {
                            route: state.page.workflow.resumeRoute,
                            status: 'loading',
                        },
                    };
                }
                return {
                    ...state,
                    page: { route: 'repository', status: 'loading' },
                };
            }
            return updateRepositoryWorkflow(state, (workflow) => ({
                status: 'result',
                step: action,
                report: workflow.report,
                currentDirectory: workflow.currentDirectory,
                resumeRoute: workflow.resumeRoute,
            }));
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
                page: {
                    route: 'deploy',
                    status: 'ready',
                    workflow: {
                        status: 'selection',
                        plan: action.plan,
                        cursor: 0,
                        selectedIds: initialDeploySelection(action.plan, action.lastSelection),
                        advancedExpanded: false,
                    },
                },
            };
        case 'deploy.move':
            return updateDeployWorkflow(state, (workflow) => moveDeployCursor(workflow, action.delta));
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
                page: {
                    route: 'restore',
                    status: 'ready',
                    workflow: {
                        status: 'review',
                        plan: action.plan,
                    },
                },
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
        case 'navigate':
            return {
                ...state,
                ...(action.route === 'repository' && state.page.route !== 'repository'
                    ? { repositoryResumeRoute: state.page.route }
                    : {}),
                page: {
                    route: action.route,
                    status: 'loading',
                },
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
export function deployVisibleChanges(workflow) {
    return workflow.plan.changes.filter((change) => change.group === 'standard' || workflow.advancedExpanded);
}
export function deployWarnings(plan) {
    return plan.issues.filter((issue) => issue.severity === 'warning');
}
function moveDeployCursor(workflow, delta) {
    if (workflow.status === 'selection') {
        return {
            ...workflow,
            cursor: wrapIndex(workflow.cursor + delta, deployVisibleChanges(workflow).length),
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
function toggleDeploySelection(workflow) {
    if (workflow.status !== 'selection')
        return workflow;
    const change = deployVisibleChanges(workflow)[workflow.cursor];
    if (!change)
        return workflow;
    return {
        ...workflow,
        selectedIds: toggleId(workflow.selectedIds, change.id),
    };
}
function toggleDeployAdvanced(workflow) {
    if (workflow.status !== 'selection')
        return workflow;
    return {
        ...workflow,
        cursor: 0,
        advancedExpanded: !workflow.advancedExpanded,
    };
}
function openDeployDiff(workflow) {
    if (workflow.status !== 'selection')
        return workflow;
    const change = deployVisibleChanges(workflow)[workflow.cursor];
    if (!change)
        return workflow;
    return {
        status: 'diff',
        plan: workflow.plan,
        cursor: workflow.cursor,
        selectedIds: workflow.selectedIds,
        advancedExpanded: workflow.advancedExpanded,
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
        advancedExpanded: workflow.advancedExpanded,
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
        advancedExpanded: workflow.advancedExpanded,
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
        advancedExpanded: workflow.advancedExpanded,
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
