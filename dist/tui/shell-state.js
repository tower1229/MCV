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
