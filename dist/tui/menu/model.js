export function createMenuState(snapshot, projectRoot) {
    const situation = deriveMenuSituation(snapshot);
    return {
        situation,
        screen: 'home',
        snapshot,
        projectRoot,
        items: homeItems(situation),
        cursor: 0,
        selectedProfileIds: [],
        bindPath: '',
    };
}
export function shouldOpenMainMenu(terminal) {
    if (!terminal.stdinIsTTY || !terminal.stdoutIsTTY)
        return false;
    if (terminal.term?.toLowerCase() === 'dumb')
        return false;
    if ((terminal.columns ?? 0) < 60 || (terminal.rows ?? 0) < 18)
        return false;
    const locale = terminal.locale?.trim().toUpperCase();
    if (locale === 'C' || locale === 'POSIX' || locale?.endsWith('.US-ASCII'))
        return false;
    return true;
}
export function menuReducer(state, event) {
    if (state.outcome)
        return state;
    if (event.type === 'quit')
        return { ...state, outcome: { type: 'quit', reason: 'cancelled' } };
    if (event.type === 'interrupt')
        return { ...state, outcome: { type: 'quit', reason: 'interrupted' } };
    if (event.type === 'path.changed') {
        return state.screen === 'bind-path' ? { ...state, bindPath: event.value, notice: undefined } : state;
    }
    if (event.type === 'back')
        return back(state);
    if (event.type === 'move') {
        return { ...state, cursor: clamp(state.cursor + event.delta, state.items.length), notice: undefined };
    }
    if (event.type === 'toggle')
        return toggle(state);
    const selected = state.items[state.cursor];
    if (!selected)
        return state;
    if (state.screen === 'home')
        return selectHomeItem(state, selected.id);
    if (state.screen === 'deploy-scope') {
        const scope = selected.id === 'global-scope' ? 'global' : 'project';
        return {
            ...state,
            screen: 'deploy-profiles',
            items: deployProfileItems(state.snapshot.profiles),
            cursor: 0,
            deployScope: scope,
            selectedProfileIds: scope === 'global'
                && state.snapshot.profiles.some((profile) => profile.id === 'global')
                ? ['global']
                : [],
        };
    }
    if (state.screen === 'deploy-profiles' && selected.id === 'continue-deploy') {
        if (state.selectedProfileIds.length === 0) {
            return { ...state, notice: 'Select at least one Profile before continuing.' };
        }
        const scope = state.deployScope ?? 'project';
        return {
            ...state,
            outcome: {
                type: 'deploy',
                scope,
                profileIds: state.selectedProfileIds,
                ...(scope === 'project' ? { targetRoot: state.projectRoot } : {}),
            },
        };
    }
    if (state.screen === 'inspect') {
        const reports = {
            'inspect-overview': 'overview',
            'inspect-environment': 'environment',
            'inspect-repository': 'repository',
        };
        const report = reports[selected.id];
        return report ? { ...state, outcome: { type: 'inspect', report } } : state;
    }
    if (state.screen === 'more')
        return selectMoreItem(state, selected.id);
    if (state.screen === 'restore-scope') {
        const scope = selected.id === 'global-restore' ? 'global' : 'project';
        return {
            ...state,
            outcome: {
                type: 'restore',
                scope,
                ...(scope === 'project' ? { targetRoot: state.projectRoot } : {}),
            },
        };
    }
    if (state.screen === 'bind-path' && selected.id === 'submit-bind') {
        const repositoryPath = state.bindPath.trim();
        return repositoryPath
            ? { ...state, outcome: { type: 'bind', repositoryPath } }
            : { ...state, notice: 'Enter an existing Repository path.' };
    }
    return state;
}
export function deriveMenuSituation(snapshot) {
    if (snapshot.repository.status === 'unbound')
        return 'unbound';
    if (snapshot.repository.status === 'blocked')
        return 'blocked';
    return 'bound';
}
function homeItems(situation) {
    if (situation === 'unbound') {
        return [
            item('create-repository', 'Create Repository', 'Initialize MCV in the current directory'),
            item('bind-repository', 'Bind Existing Repository', 'Use an existing MCV Repository on this device'),
            item('inspect-environment', 'Inspect Detected IDEs', 'See supported IDEs and configuration paths'),
            item('help', 'Help', 'Show every command and option'),
            item('quit', 'Quit', 'Leave MCV without changes'),
        ];
    }
    if (situation === 'blocked') {
        return [
            item('inspect', 'Inspect System', 'Review the Repository and blocking state'),
            item('more', 'More', 'Repository recovery and maintenance commands'),
            item('quit', 'Quit', 'Leave MCV without changes'),
        ];
    }
    return [
        item('capture', 'Capture Local Configuration', 'Review local changes before adding them to the Repository'),
        item('deploy', 'Deploy Environment', 'Apply selected Profiles to a project or this device'),
        item('profiles', 'Manage Profiles', 'Choose which Assets travel together'),
        item('inspect', 'Inspect System', 'Review deployment, environment, and Repository status'),
        item('more', 'More', 'Restore and Repository maintenance commands'),
        item('quit', 'Quit', 'Leave MCV without changes'),
    ];
}
function deployScopeItems() {
    return [
        item('project-scope', 'Project', 'Deploy into the current project directory'),
        item('global-scope', 'Global', 'Deploy to device-global IDE locations'),
    ];
}
function deployProfileItems(profiles) {
    return [
        ...profiles.map((profile) => item(`profile:${profile.id}`, profile.title ? `${profile.title} (${profile.id})` : profile.id, `${profile.assetCount} Asset${profile.assetCount === 1 ? '' : 's'}`)),
        item('continue-deploy', 'Continue', 'Review the Deploy Plan in the command workflow'),
    ];
}
function selectHomeItem(state, selected) {
    switch (selected) {
        case 'create-repository':
            return { ...state, outcome: { type: 'init', repositoryPath: state.projectRoot } };
        case 'bind-repository':
            return openScreen(state, 'bind-path', [item('submit-bind', 'Continue', 'Review the Bind Plan')]);
        case 'deploy':
            return {
                ...openScreen(state, 'deploy-scope', deployScopeItems()),
                deployScope: 'project',
                selectedProfileIds: [],
            };
        case 'capture': return { ...state, outcome: { type: 'capture' } };
        case 'profiles': return { ...state, outcome: { type: 'profiles' } };
        case 'inspect': return openScreen(state, 'inspect', inspectItems());
        case 'inspect-environment': return { ...state, outcome: { type: 'inspect', report: 'environment' } };
        case 'more': return openScreen(state, 'more', moreItems(state));
        case 'help': return { ...state, outcome: { type: 'help' } };
        case 'quit': return { ...state, outcome: { type: 'quit', reason: 'cancelled' } };
        default: return state;
    }
}
function selectMoreItem(state, selected) {
    const repositoryPath = state.snapshot.repository.status === 'valid'
        ? state.snapshot.repository.path
        : state.snapshot.repository.status === 'blocked'
            ? state.snapshot.repository.path
            : undefined;
    switch (selected) {
        case 'restore': return openScreen(state, 'restore-scope', restoreScopeItems());
        case 'migrate': return repositoryPath
            ? { ...state, outcome: { type: 'migrate', repositoryPath } }
            : { ...state, notice: 'No Repository path is available for migration.' };
        case 'unbind': return { ...state, outcome: { type: 'unbind' } };
        case 'discover': return { ...state, outcome: { type: 'inspect', report: 'environment' } };
        case 'help': return { ...state, outcome: { type: 'help' } };
        default: return state;
    }
}
function toggle(state) {
    if (state.screen !== 'deploy-profiles')
        return state;
    const selected = state.items[state.cursor];
    if (!selected?.id.startsWith('profile:'))
        return state;
    const profileId = selected.id.slice('profile:'.length);
    return {
        ...state,
        selectedProfileIds: state.selectedProfileIds.includes(profileId)
            ? state.selectedProfileIds.filter((id) => id !== profileId)
            : [...state.selectedProfileIds, profileId],
        notice: undefined,
    };
}
function back(state) {
    if (state.screen === 'home')
        return { ...state, outcome: { type: 'quit', reason: 'cancelled' } };
    if (state.screen === 'deploy-profiles') {
        return {
            ...state,
            screen: 'deploy-scope',
            items: deployScopeItems(),
            cursor: state.deployScope === 'global' ? 1 : 0,
            notice: undefined,
        };
    }
    return {
        ...state,
        screen: 'home',
        items: homeItems(state.situation),
        cursor: 0,
        notice: undefined,
    };
}
function openScreen(state, screen, items) {
    return { ...state, screen, items, cursor: 0, notice: undefined };
}
function inspectItems() {
    return [
        item('inspect-overview', 'Overview', 'Pending Deployment Change and Drift'),
        item('inspect-environment', 'Environment', 'Detected IDEs and configuration paths'),
        item('inspect-repository', 'Repository', 'Binding, identity, schema, and Git status'),
    ];
}
function moreItems(state) {
    const items = [
        item('restore', 'Restore', 'Restore the latest verified Deploy backup'),
        item('migrate', 'Migrate Repository', 'Review a required schema migration'),
        item('unbind', 'Unbind Repository', 'Remove this device binding'),
        item('discover', 'Discover IDEs', 'Inspect supported IDE configuration paths'),
        item('help', 'Help', 'Show every command and option'),
    ];
    return state.snapshot.repository.status === 'unbound'
        ? items.filter((candidate) => candidate.id === 'discover' || candidate.id === 'help')
        : items;
}
function restoreScopeItems() {
    return [
        item('project-restore', 'Project', 'Use the current project Deploy backup'),
        item('global-restore', 'Global', 'Use the latest device-global Deploy backup'),
    ];
}
function item(id, label, description) {
    return { id, label, description };
}
function clamp(value, length) {
    if (length <= 0)
        return 0;
    return Math.max(0, Math.min(value, length - 1));
}
