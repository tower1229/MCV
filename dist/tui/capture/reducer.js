import { buildCaptureReviewModel, captureReviewComplete, createCaptureReviewDraft, setCaptureDecision, setCaptureWarningConfirmed, summarizeCaptureReview, toggleCaptureChange, } from '../../review/capture.js';
export function createCaptureTuiState(plan, notice) {
    const model = buildCaptureReviewModel(plan);
    return {
        status: 'changes',
        model,
        draft: createCaptureReviewDraft(model),
        changeCursor: 0,
        decisionGroupIndex: 0,
        decisionCursor: 0,
        warningCursor: 0,
        notice,
    };
}
export function captureTuiReducer(state, action) {
    if (state.status === 'applying' || state.status === 'regenerating') {
        if (action.type === 'applied')
            return { ...state, status: 'result', result: action.result };
        if (action.type === 'regenerating')
            return { ...state, status: 'regenerating' };
        if (action.type === 'regenerated') {
            return createCaptureTuiState(action.plan, 'The previous Plan became stale; review the regenerated Plan.');
        }
        return state;
    }
    if (action.type === 'regenerated')
        return createCaptureTuiState(action.plan);
    if (action.type === 'regenerating')
        return { ...state, status: 'regenerating' };
    if (action.type === 'applied')
        return { ...state, status: 'result', result: action.result };
    if (state.status === 'result')
        return state;
    switch (action.type) {
        case 'move':
            return move(state, action.delta);
        case 'toggle':
            return toggle(state);
        case 'openDiff':
            return openDiff(state);
        case 'closeDiff':
            return state.status === 'diff' && state.returnStatus
                ? { ...state, status: state.returnStatus, detailChangeId: undefined, returnStatus: undefined }
                : state;
        case 'continue':
            return continueReview(state);
        case 'back':
            return back(state);
        case 'apply':
            return state.status === 'final' && captureReviewComplete(state.model, state.draft)
                ? { ...state, status: 'applying' }
                : state;
        default:
            return state;
    }
}
export function visibleCaptureChanges(state) {
    return state.model.plan.changes.filter((change) => !change.decisionGroupId);
}
export function currentCaptureDecisionChoices(state) {
    return state.model.decisionGroups[state.decisionGroupIndex]?.choices ?? [];
}
export function captureTuiCanApply(state) {
    return state.status === 'final' && captureReviewComplete(state.model, state.draft);
}
export function captureTuiSummary(state) {
    return summarizeCaptureReview(state.model, state.draft);
}
function move(state, delta) {
    if (state.status === 'changes') {
        return {
            ...state,
            changeCursor: clamp(state.changeCursor + delta, visibleCaptureChanges(state).length),
        };
    }
    if (state.status === 'decisions') {
        return {
            ...state,
            decisionCursor: clamp(state.decisionCursor + delta, currentCaptureDecisionChoices(state).length),
        };
    }
    if (state.status === 'warnings') {
        return { ...state, warningCursor: clamp(state.warningCursor + delta, state.model.warnings.length) };
    }
    return state;
}
function toggle(state) {
    if (state.status === 'changes') {
        const change = visibleCaptureChanges(state)[state.changeCursor];
        return change
            ? { ...state, draft: toggleCaptureChange(state.model, state.draft, change.id) }
            : state;
    }
    if (state.status === 'decisions') {
        const group = state.model.decisionGroups[state.decisionGroupIndex];
        const choice = group?.choices[state.decisionCursor];
        return group && choice
            ? { ...state, draft: setCaptureDecision(state.model, state.draft, group.id, choice.id) }
            : state;
    }
    if (state.status === 'warnings') {
        const warning = state.model.warnings[state.warningCursor];
        if (!warning)
            return state;
        const confirmed = !state.draft.confirmedIssueIds.includes(warning.confirmationId);
        return {
            ...state,
            draft: setCaptureWarningConfirmed(state.model, state.draft, warning.confirmationId, confirmed),
        };
    }
    return state;
}
function openDiff(state) {
    const returnStatus = state.status === 'changes' || state.status === 'decisions'
        ? state.status
        : undefined;
    const change = focusedCaptureChange(state);
    return change && returnStatus && change.previews.length > 0
        ? {
            ...state,
            status: 'diff',
            detailChangeId: change.id,
            returnStatus,
        }
        : state;
}
function focusedCaptureChange(state) {
    if (state.status === 'changes')
        return visibleCaptureChanges(state)[state.changeCursor];
    if (state.status === 'decisions') {
        return currentCaptureDecisionChoices(state)[state.decisionCursor];
    }
    return undefined;
}
function continueReview(state) {
    if (state.status === 'changes') {
        if (state.model.decisionGroups.length > 0)
            return { ...state, status: 'decisions' };
        if (state.model.warnings.length > 0)
            return { ...state, status: 'warnings' };
        return { ...state, status: 'final' };
    }
    if (state.status === 'decisions') {
        const group = state.model.decisionGroups[state.decisionGroupIndex];
        if (!group?.choices.some((choice) => state.draft.selectedChangeIds.includes(choice.id))) {
            return state;
        }
        if (state.decisionGroupIndex + 1 < state.model.decisionGroups.length) {
            return { ...state, decisionGroupIndex: state.decisionGroupIndex + 1, decisionCursor: 0 };
        }
        return state.model.warnings.length > 0
            ? { ...state, status: 'warnings' }
            : { ...state, status: 'final' };
    }
    if (state.status === 'warnings') {
        return state.model.warnings.every((warning) => state.draft.confirmedIssueIds.includes(warning.confirmationId))
            ? { ...state, status: 'final' }
            : state;
    }
    return state;
}
function back(state) {
    if (state.status === 'diff')
        return captureTuiReducer(state, { type: 'closeDiff' });
    if (state.status === 'decisions') {
        if (state.decisionGroupIndex > 0) {
            return { ...state, decisionGroupIndex: state.decisionGroupIndex - 1, decisionCursor: 0 };
        }
        return { ...state, status: 'changes' };
    }
    if (state.status === 'warnings') {
        return state.model.decisionGroups.length > 0
            ? { ...state, status: 'decisions', decisionGroupIndex: state.model.decisionGroups.length - 1 }
            : { ...state, status: 'changes' };
    }
    if (state.status === 'final') {
        if (state.model.warnings.length > 0)
            return { ...state, status: 'warnings' };
        if (state.model.decisionGroups.length > 0) {
            return { ...state, status: 'decisions', decisionGroupIndex: state.model.decisionGroups.length - 1 };
        }
        return { ...state, status: 'changes' };
    }
    return state;
}
function clamp(value, length) {
    if (length <= 0)
        return 0;
    return Math.max(0, Math.min(value, length - 1));
}
