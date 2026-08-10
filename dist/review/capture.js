export function buildCaptureReviewModel(plan) {
    const groups = new Map();
    for (const change of plan.changes) {
        if (!change.decisionGroupId)
            continue;
        groups.set(change.decisionGroupId, [
            ...(groups.get(change.decisionGroupId) ?? []),
            change,
        ]);
    }
    const decisionGroups = [...groups].map(([id, choices]) => ({
        id,
        issue: plan.issues.find((issue) => issue.decisionId === id),
        choices,
    }));
    const warnings = plan.issues.filter((issue) => issue.severity === 'warning');
    const deletions = plan.changes.filter((change) => change.change === 'delete' && !change.decisionGroupId);
    const resolvableDecisionIds = new Set(decisionGroups.map((group) => group.id));
    const blockingIssues = plan.issues.filter((issue) => issue.severity === 'error'
        || (issue.severity === 'decisionRequired'
            && (!issue.decisionId || !resolvableDecisionIds.has(issue.decisionId))));
    return {
        plan,
        decisionGroups,
        warnings,
        deletions,
        blockingIssues,
        interactionCount: decisionGroups.length + warnings.length + deletions.length,
    };
}
export function createCaptureReviewDraft(model) {
    return {
        selectedChangeIds: model.plan.changes
            .filter((change) => change.defaultSelected && !change.decisionGroupId)
            .map((change) => change.id),
        confirmedIssueIds: [],
    };
}
export function setCaptureDecision(model, draft, groupId, changeId) {
    const group = model.decisionGroups.find((candidate) => candidate.id === groupId);
    if (!group?.choices.some((choice) => choice.id === changeId))
        return draft;
    const groupIds = new Set(group.choices.map((choice) => choice.id));
    return {
        ...draft,
        selectedChangeIds: [
            ...draft.selectedChangeIds.filter((id) => !groupIds.has(id)),
            changeId,
        ],
    };
}
export function toggleCaptureChange(model, draft, changeId) {
    const change = model.plan.changes.find((candidate) => candidate.id === changeId);
    if (!change || change.decisionGroupId)
        return draft;
    const selected = draft.selectedChangeIds.includes(changeId);
    return {
        ...draft,
        selectedChangeIds: selected
            ? draft.selectedChangeIds.filter((id) => id !== changeId)
            : [...draft.selectedChangeIds, changeId],
    };
}
export function setCaptureWarningConfirmed(model, draft, confirmationId, confirmed) {
    if (!model.warnings.some((warning) => warning.confirmationId === confirmationId))
        return draft;
    return {
        ...draft,
        confirmedIssueIds: confirmed
            ? [...new Set([...draft.confirmedIssueIds, confirmationId])]
            : draft.confirmedIssueIds.filter((id) => id !== confirmationId),
    };
}
export function captureReviewComplete(model, draft) {
    if (model.blockingIssues.length > 0)
        return false;
    const selected = new Set(draft.selectedChangeIds);
    return model.decisionGroups.every((group) => group.choices.filter((choice) => selected.has(choice.id)).length === 1)
        && model.warnings.every((warning) => draft.confirmedIssueIds.includes(warning.confirmationId));
}
export function captureReviewSelection(draft) {
    return {
        changeIds: [...new Set(draft.selectedChangeIds)],
        confirmedIssueIds: [...new Set(draft.confirmedIssueIds)],
    };
}
export function summarizeCaptureReview(model, draft) {
    const selected = new Set(draft.selectedChangeIds);
    const selectedChoices = model.decisionGroups
        .flatMap((group) => group.choices)
        .filter((choice) => selected.has(choice.id));
    const repositoryChanges = model.plan.changes.filter((change) => !change.decisionGroupId || change.decision !== 'skip');
    return {
        selectedRepositoryChanges: repositoryChanges.filter((change) => selected.has(change.id)).length,
        unselectedRepositoryChanges: repositoryChanges.filter((change) => !selected.has(change.id)).length,
        resolvedDecisions: selectedChoices.length,
        skippedDecisions: selectedChoices.filter((choice) => choice.decision === 'skip').length,
        confirmedWarnings: model.warnings.filter((warning) => draft.confirmedIssueIds.includes(warning.confirmationId)).length,
    };
}
