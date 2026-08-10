import { jsx as _jsx } from "react/jsx-runtime";
import { render, useApp, useInput, useWindowSize, } from 'ink';
import { useEffect, useReducer, useRef } from 'react';
import { deriveAssetCatalog } from '../../assets/catalog.js';
import { createProfileService, } from '../../profiles/service.js';
import { resolveBoundRepository } from '../../utils/repository.js';
import { preserveTerminalInputMode } from '../terminal-input-mode.js';
import { createInitialProfileEditorState, FILTER_OPTIONS, filteredCatalogAssets, profileEditorReducer, selectedAssetIds, } from './reducer.js';
import { ProfileEditorView } from './view.js';
export async function runProfileEditor(context, options = {}, dependencies = {}, runtime = {}) {
    let instance;
    const wasRaw = Boolean(process.stdin.isRaw);
    const restoreInputMode = (runtime.preserveTerminalInputMode ?? preserveTerminalInputMode)(context.platform);
    try {
        instance = (runtime.render ?? render)(_jsx(ProfileEditorApp, { context: context, initialProfileId: options.initialProfileId, dependencies: dependencies }), {
            alternateScreen: true,
            interactive: true,
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
        try {
            instance?.unmount();
        }
        finally {
            restoreInputMode();
        }
    }
}
function ProfileEditorApp({ context, initialProfileId, dependencies, }) {
    const [state, dispatch] = useReducer(profileEditorReducer, { initialProfileId }, createInitialProfileEditorState);
    const { exit } = useApp();
    const windowSize = useWindowSize();
    const serviceRef = useRef(undefined);
    const stateRef = useRef(state);
    const exitingRef = useRef(false);
    const saveInFlightRef = useRef(false);
    stateRef.current = state;
    useEffect(() => {
        if (state.status !== 'loading')
            return;
        try {
            const resolvePath = dependencies.resolveRepositoryPath ?? resolveBoundRepository;
            const repositoryPath = resolvePath(context);
            const createService = dependencies.createService ?? createProfileService;
            const service = createService(repositoryPath);
            serviceRef.current = service;
            const inventory = service.inspect();
            const loadCatalog = dependencies.loadCatalog ?? deriveAssetCatalog;
            const catalog = loadCatalog(repositoryPath);
            dispatch({
                type: 'inventory.loaded',
                profilesRevision: inventory.profilesRevision,
                catalogRevision: inventory.catalogRevision,
                profiles: inventory.profiles,
                catalog: catalog.assets,
            });
        }
        catch (error) {
            exit({
                reason: 'interrupted',
                summary: error instanceof Error ? error.message : String(error),
            });
        }
    }, [context, dependencies, exit, state.status]);
    useEffect(() => {
        if (state.status !== 'saving' || saveInFlightRef.current)
            return;
        saveInFlightRef.current = true;
        const service = serviceRef.current;
        if (!service) {
            saveInFlightRef.current = false;
            dispatch({ type: 'save.failed', message: 'ProfileService is unavailable.' });
            return;
        }
        const result = service.replaceAll({
            expectedProfilesRevision: state.profilesRevision,
            expectedCatalogRevision: state.catalogRevision,
            profiles: state.draftProfiles,
        });
        if (result.status === 'updated') {
            dispatch({
                type: 'save.succeeded',
                profilesRevision: result.profilesRevision,
                catalogRevision: result.catalogRevision,
                profiles: cloneProfiles(state.draftProfiles),
            });
        }
        else if (result.status === 'conflict') {
            dispatch({
                type: 'save.conflicted',
                profilesRevision: result.profilesRevision,
                catalogRevision: result.catalogRevision,
                message: result.error?.message
                    ?? 'expected Profiles or Catalog Revision does not match the Repository.',
            });
        }
        else {
            dispatch({
                type: 'save.failed',
                message: result.error?.message ?? 'Profile save was rejected.',
            });
        }
        saveInFlightRef.current = false;
    }, [state.status, state.profilesRevision, state.catalogRevision, state.draftProfiles]);
    useEffect(() => {
        if (!state.exitReason || exitingRef.current)
            return;
        exitingRef.current = true;
        exit({
            reason: state.exitReason,
            profilesRevision: state.profilesRevision,
            catalogRevision: state.catalogRevision,
            summary: state.exitSummary
                ?? (state.exitReason === 'cancelled'
                    ? 'Profile editor closed.'
                    : 'Profile editor interrupted.'),
        });
    }, [exit, state]);
    useInput((input, key) => {
        const current = stateRef.current;
        if (key.ctrl && input === 'c') {
            finishInterrupted(current, exit, exitingRef);
            return;
        }
        if (current.status === 'loading' || current.status === 'saving')
            return;
        if (current.focus === 'search') {
            handleSearchInput(current.searchQuery, input, key, dispatch);
            return;
        }
        if (key.escape) {
            if (current.status === 'conflict') {
                dispatch({ type: 'conflict.dismissed' });
                return;
            }
            dispatch({ type: 'cancel.requested' });
            return;
        }
        if (key.return) {
            if (current.status === 'dirty' || current.status === 'conflict') {
                dispatch({ type: 'save.requested' });
            }
            return;
        }
        if (key.tab) {
            dispatch({ type: 'focus.changed', focus: nextFocus(current.focus, Boolean(key.shift)) });
            return;
        }
        if (input === '/') {
            dispatch({ type: 'focus.changed', focus: 'search' });
            return;
        }
        if (key.leftArrow) {
            dispatch({ type: 'focus.changed', focus: previousPane(current.focus) });
            return;
        }
        if (key.rightArrow) {
            dispatch({ type: 'focus.changed', focus: nextPane(current.focus) });
            return;
        }
        if (key.upArrow || key.downArrow) {
            const delta = key.upArrow ? -1 : 1;
            if (current.focus === 'profiles') {
                dispatch({ type: 'cursor.moved', pane: 'profiles', delta });
            }
            else if (current.focus === 'assets') {
                dispatch({ type: 'cursor.moved', pane: 'assets', delta });
            }
            else if (current.focus === 'selected') {
                dispatch({ type: 'cursor.moved', pane: 'selected', delta });
            }
            else if (current.focus === 'filters') {
                dispatch({ type: 'cursor.moved', pane: 'filters', delta });
            }
            return;
        }
        if (input === ' ') {
            if (current.focus === 'assets') {
                const asset = filteredCatalogAssets(current)[current.assetCursor];
                if (asset)
                    dispatch({ type: 'asset.toggled', assetId: asset.id });
            }
            else if (current.focus === 'selected') {
                const assetId = selectedAssetIds(current)[current.selectedCursor];
                if (assetId)
                    dispatch({ type: 'asset.toggled', assetId });
            }
            else if (current.focus === 'filters') {
                applyFilterSelection(current, dispatch);
            }
        }
    });
    return (_jsx(ProfileEditorView, { state: state, columns: Math.max(60, windowSize.columns), rows: Math.max(16, windowSize.rows) }));
}
function handleSearchInput(query, input, key, dispatch) {
    if (key.escape || key.return) {
        dispatch({ type: 'focus.changed', focus: 'assets' });
        return;
    }
    if (key.backspace || key.delete) {
        dispatch({ type: 'search.changed', query: query.slice(0, -1) });
        return;
    }
    if (key.ctrl || key.meta || key.tab || key.upArrow || key.downArrow || key.leftArrow || key.rightArrow) {
        return;
    }
    if (!input)
        return;
    dispatch({ type: 'search.changed', query: `${query}${input}` });
}
function applyFilterSelection(state, dispatch) {
    const option = FILTER_OPTIONS[state.filterCursor];
    if (!option)
        return;
    if (option.kind === 'type') {
        dispatch({
            type: 'typeFilter.changed',
            filter: option.value,
        });
        return;
    }
    dispatch({
        type: 'compatibilityFilter.changed',
        filter: option.value,
    });
}
function nextFocus(focus, reverse = false) {
    const order = ['profiles', 'assets', 'selected', 'search', 'filters'];
    const index = order.indexOf(focus);
    const next = reverse
        ? (index - 1 + order.length) % order.length
        : (index + 1) % order.length;
    return order[next] ?? 'profiles';
}
function nextPane(focus) {
    if (focus === 'profiles')
        return 'assets';
    if (focus === 'assets')
        return 'selected';
    if (focus === 'selected')
        return 'profiles';
    return 'assets';
}
function previousPane(focus) {
    if (focus === 'selected')
        return 'assets';
    if (focus === 'assets')
        return 'profiles';
    if (focus === 'profiles')
        return 'selected';
    return 'profiles';
}
function finishInterrupted(state, exit, exitingRef) {
    if (exitingRef.current)
        return;
    exitingRef.current = true;
    exit({
        reason: 'interrupted',
        profilesRevision: state.profilesRevision,
        catalogRevision: state.catalogRevision,
        summary: 'Profile editor interrupted.',
    });
}
function cloneProfiles(profiles) {
    return structuredClone(profiles);
}
function restoreAfterRenderFailure(wasRaw) {
    if (typeof process.stdin.setRawMode === 'function'
        && Boolean(process.stdin.isRaw) !== wasRaw) {
        process.stdin.setRawMode(wasRaw);
    }
    process.stdout.write('\u001b[?25h\u001b[?1049l');
}
