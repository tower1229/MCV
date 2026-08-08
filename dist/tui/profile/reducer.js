import { GLOBAL_PROFILE_ID } from '../../profiles/contracts.js';
export function createInitialProfileEditorState(options = {}) {
    return {
        status: 'loading',
        initialProfileId: options.initialProfileId,
        selectedProfileId: options.initialProfileId ?? GLOBAL_PROFILE_ID,
        profileIds: [],
        profilesRevision: '',
        catalogRevision: '',
        baselineProfiles: {},
        draftProfiles: {},
        catalog: [],
        focus: 'profiles',
        searchQuery: '',
        typeFilter: 'all',
        compatibilityFilter: 'all',
        profileCursor: 0,
        assetCursor: 0,
        selectedCursor: 0,
        filterCursor: 0,
        changeSummary: { added: 0, removed: 0 },
    };
}
export function profileEditorReducer(state, action) {
    switch (action.type) {
        case 'inventory.loaded': {
            const profileIds = sortedProfileIds(action.profiles);
            const selectedProfileId = resolveSelectedProfileId(state.initialProfileId ?? state.selectedProfileId, profileIds);
            return withDerivedStatus({
                ...state,
                status: 'ready',
                profilesRevision: action.profilesRevision,
                catalogRevision: action.catalogRevision,
                baselineProfiles: cloneProfiles(action.profiles),
                draftProfiles: cloneProfiles(action.profiles),
                catalog: [...action.catalog],
                profileIds,
                selectedProfileId,
                profileCursor: Math.max(0, profileIds.indexOf(selectedProfileId)),
                assetCursor: 0,
                selectedCursor: 0,
                conflictMessage: undefined,
                errorMessage: undefined,
                exitReason: undefined,
            });
        }
        case 'profile.selected': {
            if (!(action.profileId in state.draftProfiles))
                return state;
            const profileCursor = Math.max(0, state.profileIds.indexOf(action.profileId));
            return {
                ...state,
                selectedProfileId: action.profileId,
                profileCursor,
                assetCursor: 0,
                selectedCursor: 0,
            };
        }
        case 'asset.toggled': {
            if (state.status === 'loading' || state.status === 'saving')
                return state;
            const profile = state.draftProfiles[state.selectedProfileId];
            if (!profile)
                return state;
            const selected = new Set(profile.assets);
            if (selected.has(action.assetId))
                selected.delete(action.assetId);
            else
                selected.add(action.assetId);
            const nextAssets = [...selected].sort((left, right) => left.localeCompare(right));
            const draftProfiles = {
                ...state.draftProfiles,
                [state.selectedProfileId]: {
                    ...profile,
                    assets: nextAssets,
                },
            };
            return withDerivedStatus({
                ...state,
                draftProfiles,
                conflictMessage: undefined,
                errorMessage: undefined,
            });
        }
        case 'search.changed':
            return {
                ...state,
                searchQuery: action.query,
                assetCursor: 0,
            };
        case 'typeFilter.changed':
            return {
                ...state,
                typeFilter: action.filter,
                assetCursor: 0,
            };
        case 'compatibilityFilter.changed':
            return {
                ...state,
                compatibilityFilter: action.filter,
                assetCursor: 0,
            };
        case 'focus.changed':
            return { ...state, focus: action.focus };
        case 'cursor.moved': {
            if (action.pane === 'profiles') {
                const next = clampIndex(state.profileCursor + action.delta, state.profileIds.length);
                const profileId = state.profileIds[next];
                if (!profileId)
                    return state;
                return {
                    ...state,
                    profileCursor: next,
                    selectedProfileId: profileId,
                    assetCursor: 0,
                    selectedCursor: 0,
                };
            }
            if (action.pane === 'assets') {
                const length = filteredCatalogAssets(state).length;
                return {
                    ...state,
                    assetCursor: clampIndex(state.assetCursor + action.delta, length),
                };
            }
            if (action.pane === 'selected') {
                const length = selectedAssetIds(state).length;
                return {
                    ...state,
                    selectedCursor: clampIndex(state.selectedCursor + action.delta, length),
                };
            }
            return {
                ...state,
                filterCursor: clampIndex(state.filterCursor + action.delta, FILTER_OPTIONS.length),
            };
        }
        case 'save.requested':
            if (state.status !== 'dirty' && state.status !== 'conflict')
                return state;
            return {
                ...state,
                status: 'saving',
                conflictMessage: undefined,
                errorMessage: undefined,
            };
        case 'save.succeeded': {
            const profileIds = sortedProfileIds(action.profiles);
            const selectedProfileId = resolveSelectedProfileId(state.selectedProfileId, profileIds);
            return withDerivedStatus({
                ...state,
                status: 'ready',
                profilesRevision: action.profilesRevision,
                catalogRevision: action.catalogRevision,
                baselineProfiles: cloneProfiles(action.profiles),
                draftProfiles: cloneProfiles(action.profiles),
                profileIds,
                selectedProfileId,
                profileCursor: Math.max(0, profileIds.indexOf(selectedProfileId)),
                conflictMessage: undefined,
                errorMessage: undefined,
                exitReason: undefined,
            });
        }
        case 'save.conflicted':
            return {
                ...state,
                status: 'conflict',
                profilesRevision: action.profilesRevision,
                catalogRevision: action.catalogRevision,
                conflictMessage: action.message,
                errorMessage: undefined,
            };
        case 'save.failed':
            return {
                ...state,
                status: state.changeSummary.added + state.changeSummary.removed > 0 ? 'dirty' : 'ready',
                errorMessage: action.message,
            };
        case 'conflict.dismissed':
            if (state.status !== 'conflict')
                return state;
            return withDerivedStatus({
                ...state,
                conflictMessage: undefined,
            });
        case 'cancel.requested': {
            const discarded = state.changeSummary.added + state.changeSummary.removed > 0;
            return withDerivedStatus({
                ...state,
                draftProfiles: cloneProfiles(state.baselineProfiles),
                conflictMessage: undefined,
                errorMessage: undefined,
                exitReason: 'cancelled',
                exitSummary: discarded ? 'Profile edits discarded.' : 'Profile editor closed.',
            });
        }
        default:
            return state;
    }
}
export function selectedAssetIds(state) {
    return [...(state.draftProfiles[state.selectedProfileId]?.assets ?? [])];
}
export function filteredCatalogAssets(state) {
    const query = state.searchQuery.trim().toLowerCase();
    return state.catalog.filter((asset) => {
        if (state.typeFilter !== 'all' && asset.type !== state.typeFilter)
            return false;
        if (state.compatibilityFilter !== 'all'
            && !asset.supportedTargets.includes(state.compatibilityFilter)) {
            return false;
        }
        if (!query)
            return true;
        const haystack = [
            asset.id,
            asset.displayName,
            asset.description ?? '',
            asset.type,
        ].join(' ').toLowerCase();
        return haystack.includes(query);
    });
}
export const FILTER_OPTIONS = [
    { id: 'type:all', label: 'Type: all', kind: 'type', value: 'all' },
    { id: 'type:rule', label: 'Type: rule', kind: 'type', value: 'rule' },
    { id: 'type:skill', label: 'Type: skill', kind: 'type', value: 'skill' },
    { id: 'type:mcp', label: 'Type: mcp', kind: 'type', value: 'mcp' },
    { id: 'type:native', label: 'Type: native', kind: 'type', value: 'native' },
    { id: 'compat:all', label: 'Compat: all', kind: 'compatibility', value: 'all' },
    { id: 'compat:codex', label: 'Compat: codex', kind: 'compatibility', value: 'codex' },
    {
        id: 'compat:claude-code',
        label: 'Compat: claude-code',
        kind: 'compatibility',
        value: 'claude-code',
    },
    { id: 'compat:gemini', label: 'Compat: gemini', kind: 'compatibility', value: 'gemini' },
];
function withDerivedStatus(state) {
    const changeSummary = summarizeChanges(state.baselineProfiles, state.draftProfiles);
    const dirty = changeSummary.added + changeSummary.removed > 0;
    let status = state.status;
    if (status === 'saving' || status === 'loading') {
        // preserve in-flight load/save
    }
    else if (status === 'conflict' && dirty) {
        status = 'conflict';
    }
    else {
        status = dirty ? 'dirty' : 'ready';
    }
    return {
        ...state,
        status,
        changeSummary,
    };
}
function summarizeChanges(baseline, draft) {
    let added = 0;
    let removed = 0;
    const ids = new Set([...Object.keys(baseline), ...Object.keys(draft)]);
    for (const id of ids) {
        const before = new Set(baseline[id]?.assets ?? []);
        const after = new Set(draft[id]?.assets ?? []);
        for (const assetId of after)
            if (!before.has(assetId))
                added += 1;
        for (const assetId of before)
            if (!after.has(assetId))
                removed += 1;
    }
    return { added, removed };
}
function sortedProfileIds(profiles) {
    return Object.keys(profiles).sort((left, right) => {
        if (left === GLOBAL_PROFILE_ID)
            return -1;
        if (right === GLOBAL_PROFILE_ID)
            return 1;
        return left.localeCompare(right);
    });
}
function resolveSelectedProfileId(preferred, profileIds) {
    if (preferred && profileIds.includes(preferred))
        return preferred;
    return profileIds[0] ?? GLOBAL_PROFILE_ID;
}
function cloneProfiles(profiles) {
    return structuredClone(profiles);
}
function clampIndex(index, length) {
    if (length <= 0)
        return 0;
    return Math.max(0, Math.min(length - 1, index));
}
