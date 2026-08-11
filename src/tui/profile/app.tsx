import {
  render,
  useApp,
  useInput,
  useWindowSize,
  type Instance,
  type Key,
} from 'ink';
import { useEffect, useReducer, useRef } from 'react';
import type { DeviceContext } from '../../adapters/types.js';
import { deriveAssetCatalog } from '../../assets/catalog.js';
import {
  createProfileService,
  type ProfileService,
} from '../../profiles/service.js';
import { resolveBoundRepository } from '../../utils/repository.js';
import { preserveTerminalInputMode } from '../terminal-input-mode.js';
import {
  createInitialProfileEditorState,
  FILTER_OPTIONS,
  filteredCatalogAssets,
  profileEditorReducer,
  selectedAssetIds,
  type ProfileEditorAction,
  type ProfileEditorExitReason,
  type ProfileEditorFocus,
  type ProfileEditorState,
} from './reducer.js';
import { ProfileEditorView } from './view.js';
import type { PresentationRole } from '../../presentation/contracts.js';

export interface ProfileEditorOutcome {
  reason: ProfileEditorExitReason;
  profilesRevision?: string;
  catalogRevision?: string;
  presentation?: { role: PresentationRole; text: string };
}

export interface ProfileEditorDependencies {
  resolveRepositoryPath?: (context: DeviceContext) => string;
  createService?: (repositoryPath: string) => ProfileService;
  loadCatalog?: typeof deriveAssetCatalog;
}

export interface ProfileEditorRuntime {
  render?: typeof render;
  restoreAfterRenderFailure?: (wasRaw: boolean) => void;
  preserveTerminalInputMode?: (platform: NodeJS.Platform) => () => void;
}

export interface RunProfileEditorOptions {
  initialProfileId?: string;
}

export async function runProfileEditor(
  context: DeviceContext,
  options: RunProfileEditorOptions = {},
  dependencies: ProfileEditorDependencies = {},
  runtime: ProfileEditorRuntime = {},
): Promise<ProfileEditorOutcome> {
  let instance: Instance | undefined;
  const wasRaw = Boolean(process.stdin.isRaw);
  const restoreInputMode = (
    runtime.preserveTerminalInputMode ?? preserveTerminalInputMode
  )(context.platform);

  try {
    instance = (runtime.render ?? render)(
      <ProfileEditorApp
        context={context}
        initialProfileId={options.initialProfileId}
        dependencies={dependencies}
      />,
      {
        alternateScreen: true,
        interactive: true,
        exitOnCtrlC: false,
        patchConsole: false,
      },
    );
    return await instance.waitUntilExit() as ProfileEditorOutcome;
  } catch (error) {
    if (!instance) {
      (runtime.restoreAfterRenderFailure ?? restoreAfterRenderFailure)(wasRaw);
    }
    throw error;
  } finally {
    try {
      instance?.unmount();
    } finally {
      restoreInputMode();
    }
  }
}

interface ProfileEditorAppProps {
  context: DeviceContext;
  initialProfileId?: string;
  dependencies: ProfileEditorDependencies;
}

function ProfileEditorApp({
  context,
  initialProfileId,
  dependencies,
}: ProfileEditorAppProps) {
  const [state, dispatch] = useReducer(
    profileEditorReducer,
    { initialProfileId },
    createInitialProfileEditorState,
  );
  const { exit } = useApp();
  const windowSize = useWindowSize();
  const serviceRef = useRef<ProfileService | undefined>(undefined);
  const stateRef = useRef(state);
  const exitingRef = useRef(false);
  const saveInFlightRef = useRef(false);
  stateRef.current = state;

  useEffect(() => {
    if (state.status !== 'loading') return;
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
    } catch (error) {
      exit({
        reason: 'interrupted',
        presentation: { role: 'danger', text: error instanceof Error ? error.message : String(error) },
      } satisfies ProfileEditorOutcome);
    }
  }, [context, dependencies, exit, state.status]);

  useEffect(() => {
    if (state.status !== 'saving' || saveInFlightRef.current) return;
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
    } else if (result.status === 'conflict') {
      dispatch({
        type: 'save.conflicted',
        profilesRevision: result.profilesRevision,
        catalogRevision: result.catalogRevision,
        message: result.error?.message
          ?? 'expected Profiles or Catalog Revision does not match the Repository.',
      });
    } else {
      dispatch({
        type: 'save.failed',
        message: result.error?.message ?? 'Profile save was rejected.',
      });
    }
    saveInFlightRef.current = false;
  }, [state.status, state.profilesRevision, state.catalogRevision, state.draftProfiles]);

  useEffect(() => {
    if (!state.exitReason || exitingRef.current) return;
    exitingRef.current = true;
    exit({
      reason: state.exitReason,
      profilesRevision: state.profilesRevision,
      catalogRevision: state.catalogRevision,
      presentation: {
        role: state.exitReason === 'cancelled' ? 'attention' : 'danger',
        text: state.exitSummary
          ?? (state.exitReason === 'cancelled'
            ? 'Profile editor closed.'
            : 'Profile editor interrupted.'),
      },
    } satisfies ProfileEditorOutcome);
  }, [exit, state]);

  useInput((input, key) => {
    const current = stateRef.current;
    if (key.ctrl && input === 'c') {
      finishInterrupted(current, exit, exitingRef);
      return;
    }

    if (current.status === 'loading' || current.status === 'saving') return;

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
      } else if (current.focus === 'assets') {
        dispatch({ type: 'cursor.moved', pane: 'assets', delta });
      } else if (current.focus === 'selected') {
        dispatch({ type: 'cursor.moved', pane: 'selected', delta });
      } else if (current.focus === 'filters') {
        dispatch({ type: 'cursor.moved', pane: 'filters', delta });
      }
      return;
    }

    if (input === ' ') {
      if (current.focus === 'assets') {
        const asset = filteredCatalogAssets(current)[current.assetCursor];
        if (asset) dispatch({ type: 'asset.toggled', assetId: asset.id });
      } else if (current.focus === 'selected') {
        const assetId = selectedAssetIds(current)[current.selectedCursor];
        if (assetId) dispatch({ type: 'asset.toggled', assetId });
      } else if (current.focus === 'filters') {
        applyFilterSelection(current, dispatch);
      }
    }
  });

  return (
    <ProfileEditorView
      state={state}
      columns={Math.max(60, windowSize.columns)}
      rows={Math.max(16, windowSize.rows)}
    />
  );
}

function handleSearchInput(
  query: string,
  input: string,
  key: Key,
  dispatch: (action: ProfileEditorAction) => void,
): void {
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
  if (!input) return;
  dispatch({ type: 'search.changed', query: `${query}${input}` });
}

function applyFilterSelection(
  state: ProfileEditorState,
  dispatch: (action: ProfileEditorAction) => void,
): void {
  const option = FILTER_OPTIONS[state.filterCursor];
  if (!option) return;
  if (option.kind === 'type') {
    dispatch({
      type: 'typeFilter.changed',
      filter: option.value as ProfileEditorState['typeFilter'],
    });
    return;
  }
  dispatch({
    type: 'compatibilityFilter.changed',
    filter: option.value as ProfileEditorState['compatibilityFilter'],
  });
}

function nextFocus(focus: ProfileEditorFocus, reverse = false): ProfileEditorFocus {
  const order: ProfileEditorFocus[] = ['profiles', 'assets', 'selected', 'search', 'filters'];
  const index = order.indexOf(focus);
  const next = reverse
    ? (index - 1 + order.length) % order.length
    : (index + 1) % order.length;
  return order[next] ?? 'profiles';
}

function nextPane(focus: ProfileEditorFocus): ProfileEditorFocus {
  if (focus === 'profiles') return 'assets';
  if (focus === 'assets') return 'selected';
  if (focus === 'selected') return 'profiles';
  return 'assets';
}

function previousPane(focus: ProfileEditorFocus): ProfileEditorFocus {
  if (focus === 'selected') return 'assets';
  if (focus === 'assets') return 'profiles';
  if (focus === 'profiles') return 'selected';
  return 'profiles';
}

function finishInterrupted(
  state: ProfileEditorState,
  exit: (outcome: ProfileEditorOutcome) => void,
  exitingRef: { current: boolean },
): void {
  if (exitingRef.current) return;
  exitingRef.current = true;
  exit({
    reason: 'interrupted',
    profilesRevision: state.profilesRevision,
    catalogRevision: state.catalogRevision,
    presentation: { role: 'danger', text: 'Profile editor interrupted.' },
  });
}

function cloneProfiles(profiles: ProfileEditorState['draftProfiles']): ProfileEditorState['draftProfiles'] {
  return structuredClone(profiles);
}

function restoreAfterRenderFailure(wasRaw: boolean): void {
  if (
    typeof process.stdin.setRawMode === 'function'
    && Boolean(process.stdin.isRaw) !== wasRaw
  ) {
    process.stdin.setRawMode(wasRaw);
  }
  process.stdout.write('\u001b[?25h\u001b[?1049l');
}
