import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Box, Text, render, useApp, useInput, useWindowSize, } from 'ink';
import { useEffect, useRef, useState } from 'react';
import { inkEmphasisProps, inkRoleProps } from '../../presentation/ink-theme.js';
import { preserveTerminalInputMode } from '../terminal-input-mode.js';
import { truncateDisplay } from '../profile/display-width.js';
import { createMenuState, menuReducer, } from './model.js';
import { createMenuSnapshot } from './snapshot.js';
export async function runMainMenu(context, projectRoot, dependencies = {}, runtime = {}) {
    let instance;
    const wasRaw = Boolean(process.stdin.isRaw);
    const restoreInputMode = (runtime.preserveTerminalInputMode ?? preserveTerminalInputMode)(context.platform);
    try {
        instance = (runtime.render ?? render)(_jsx(MainMenuApp, { context: context, projectRoot: projectRoot, dependencies: dependencies }), {
            alternateScreen: true,
            interactive: true,
            exitOnCtrlC: false,
            patchConsole: false,
        });
        return await instance.waitUntilExit();
    }
    catch (error) {
        if (!instance)
            (runtime.restoreAfterRenderFailure ?? restoreAfterRenderFailure)(wasRaw);
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
function MainMenuApp({ context, projectRoot, dependencies, }) {
    const [state, setState] = useState();
    const stateRef = useRef(state);
    stateRef.current = state;
    const { exit } = useApp();
    const windowSize = useWindowSize();
    useEffect(() => {
        let active = true;
        void (dependencies.createSnapshot ?? createMenuSnapshot)(context).then((snapshot) => {
            if (active)
                setState(createMenuState(snapshot, projectRoot));
        }, (error) => {
            if (!active)
                return;
            exit({
                status: 'failed',
                error: error instanceof Error ? error : new Error(String(error)),
            });
        });
        return () => { active = false; };
    }, [context, dependencies, exit, projectRoot]);
    useEffect(() => {
        if (state?.outcome)
            exit({ status: 'selected', action: state.outcome });
    }, [exit, state?.outcome]);
    useInput((input, key) => {
        const current = stateRef.current;
        if (!current) {
            if (key.ctrl && input === 'c') {
                exit({ status: 'selected', action: { type: 'quit', reason: 'interrupted' } });
            }
            return;
        }
        if (key.ctrl && input === 'c')
            return setState(menuReducer(current, { type: 'interrupt' }));
        if (key.escape)
            return setState(menuReducer(current, { type: 'back' }));
        if (current.screen === 'bind-path') {
            if (key.return)
                return setState(menuReducer(current, { type: 'select' }));
            if (key.backspace || key.delete) {
                return setState(menuReducer(current, {
                    type: 'path.changed',
                    value: current.bindPath.slice(0, -1),
                }));
            }
            if (input && !key.ctrl && !key.meta) {
                return setState(menuReducer(current, {
                    type: 'path.changed',
                    value: `${current.bindPath}${input}`,
                }));
            }
            return;
        }
        if (input === 'q' && current.screen === 'home')
            return setState(menuReducer(current, { type: 'quit' }));
        if (key.upArrow)
            return setState(menuReducer(current, { type: 'move', delta: -1 }));
        if (key.downArrow)
            return setState(menuReducer(current, { type: 'move', delta: 1 }));
        if (input === ' ')
            return setState(menuReducer(current, { type: 'toggle' }));
        if (key.return)
            setState(menuReducer(current, { type: 'select' }));
    });
    return state
        ? _jsx(MainMenuView, { state: state, columns: windowSize.columns, rows: windowSize.rows })
        : _jsx(LoadingView, { columns: windowSize.columns, rows: windowSize.rows });
}
function LoadingView({ columns, rows }) {
    return (_jsxs(Box, { flexDirection: "column", width: columns, height: rows, children: [_jsx(Text, { ...inkEmphasisProps(), children: truncateDisplay('MCV · Mobile Configuration Vehicle', columns) }), _jsx(Text, { children: "Inspecting Repository and device state\u2026" }), _jsx(Box, { flexGrow: 1 }), _jsx(Text, { ...inkRoleProps('muted'), children: "Ctrl+C Interrupt" })] }));
}
function MainMenuView({ state, columns, rows }) {
    return (_jsxs(Box, { flexDirection: "column", width: columns, height: rows, children: [_jsx(Text, { ...inkEmphasisProps(), children: truncateDisplay('MCV · Mobile Configuration Vehicle', columns) }), _jsx(Text, { ...inkRoleProps('muted'), children: truncateDisplay(screenSubtitle(state), columns) }), state.screen === 'home' ? _jsx(HomeSummary, { state: state, columns: columns }) : null, state.screen === 'bind-path' ? (_jsxs(Box, { flexDirection: "column", marginTop: 1, children: [_jsx(Text, { ...inkEmphasisProps(), children: "Repository path" }), _jsx(Text, { children: truncateDisplay(`${state.bindPath}█`, columns) })] })) : null, _jsx(Box, { flexDirection: "column", marginTop: 1, flexGrow: 1, children: state.items.map((item, index) => {
                    const focused = index === state.cursor;
                    const profileId = item.id.startsWith('profile:') ? item.id.slice('profile:'.length) : undefined;
                    const selection = profileId
                        ? `[${state.selectedProfileIds.includes(profileId) ? 'x' : ' '}] `
                        : '';
                    return (_jsxs(Box, { flexDirection: "column", children: [_jsx(Text, { ...inkRoleProps(focused ? 'information' : 'muted', { emphasis: focused }), children: truncateDisplay(`${focused ? '›' : ' '} ${selection}${item.label}`, columns) }), focused ? (_jsx(Text, { ...inkRoleProps('muted'), children: truncateDisplay(`  ${item.description}`, columns) })) : null] }, item.id));
                }) }), state.notice ? _jsxs(Text, { ...inkRoleProps('attention'), children: ["! ", truncateDisplay(state.notice, columns - 2)] }) : null, _jsx(Text, { children: truncateDisplay(helpLine(state), columns) })] }));
}
function HomeSummary({ state, columns }) {
    const snapshot = state.snapshot;
    const repository = snapshot.repository.status === 'valid'
        ? `${snapshot.repository.path} · schema ${snapshot.repository.schemaVersion}`
        : snapshot.repository.status === 'blocked'
            ? snapshot.repository.message
            : 'Not bound';
    const pending = snapshot.pendingDeployment.total === 0
        ? 'None'
        : `${snapshot.pendingDeployment.total} · ${snapshot.pendingDeployment.add} add · ${snapshot.pendingDeployment.modify} modify · ${snapshot.pendingDeployment.delete} delete`;
    const last = snapshot.lastOperation
        ? `${snapshot.lastOperation.kind} ${snapshot.lastOperation.success ? 'succeeded' : 'failed'} · ${snapshot.lastOperation.time}`
        : 'No operation recorded';
    if (state.situation === 'unbound') {
        return (_jsxs(Box, { flexDirection: "column", marginTop: 1, children: [_jsx(Text, { children: truncateDisplay('Repository  Not bound', columns) }), _jsx(Text, { children: truncateDisplay(`IDEs        ${snapshot.ides.detected} detected`, columns) })] }));
    }
    return (_jsxs(Box, { flexDirection: "column", marginTop: 1, children: [_jsx(Text, { children: truncateDisplay(`Repository  ${repository}`, columns) }), _jsx(Text, { children: truncateDisplay(`Pending     ${pending}`, columns) }), _jsx(Text, { children: truncateDisplay(`IDEs        ${snapshot.ides.enabled} enabled · ${snapshot.ides.detected} detected`, columns) }), _jsx(Text, { children: truncateDisplay(`Last        ${last}`, columns) })] }));
}
function screenSubtitle(state) {
    switch (state.screen) {
        case 'loading': return 'Loading';
        case 'home': return `Task launcher · ${state.situation}`;
        case 'inspect': return 'Inspect system';
        case 'more': return 'More tools';
        case 'deploy-scope': return 'Deploy · choose Scope';
        case 'deploy-profiles': return `Deploy · ${state.deployScope ?? 'project'} · choose Profiles`;
        case 'restore-scope': return 'Restore · choose Scope';
        case 'bind-path': return 'Bind existing Repository';
    }
}
function helpLine(state) {
    if (state.screen === 'loading')
        return 'Ctrl+C Interrupt';
    if (state.screen === 'bind-path')
        return 'Type path · Enter Continue · Esc Back · Ctrl+C Interrupt';
    if (state.screen === 'deploy-profiles')
        return '↑↓ Move · Space Select · Enter Continue · Esc Back · Ctrl+C Interrupt';
    if (state.screen === 'home')
        return '↑↓ Navigate · Enter Select · Esc/q Quit · Ctrl+C Interrupt';
    return '↑↓ Navigate · Enter Select · Esc Back · Ctrl+C Interrupt';
}
function restoreAfterRenderFailure(wasRaw) {
    if (process.stdin.isTTY && typeof process.stdin.setRawMode === 'function') {
        process.stdin.setRawMode(wasRaw);
    }
    process.stdout.write('\u001b[?25h\u001b[?1049l');
}
