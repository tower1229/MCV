import {
  Box,
  Text,
  render,
  useApp,
  useInput,
  useWindowSize,
  type Instance,
} from 'ink';
import { useEffect, useRef, useState } from 'react';
import type { DeviceContext } from '../../adapters/types.js';
import { inkEmphasisProps, inkRoleProps } from '../../presentation/ink-theme.js';
import { preserveTerminalInputMode } from '../terminal-input-mode.js';
import { truncateDisplay } from '../profile/display-width.js';
import {
  createMenuState,
  menuReducer,
  type MenuAction,
  type MenuState,
} from './model.js';
import { createMenuSnapshot } from './snapshot.js';

export type MainMenuOutcome =
  | { status: 'selected'; action: MenuAction }
  | { status: 'failed'; error: Error };

export interface MainMenuDependencies {
  createSnapshot?: typeof createMenuSnapshot;
}

export interface MainMenuRuntime {
  render?: typeof render;
  restoreAfterRenderFailure?: (wasRaw: boolean) => void;
  preserveTerminalInputMode?: (platform: NodeJS.Platform) => () => void;
}

export async function runMainMenu(
  context: DeviceContext,
  projectRoot: string,
  dependencies: MainMenuDependencies = {},
  runtime: MainMenuRuntime = {},
): Promise<MainMenuOutcome> {
  let instance: Instance | undefined;
  const wasRaw = Boolean(process.stdin.isRaw);
  const restoreInputMode = (
    runtime.preserveTerminalInputMode ?? preserveTerminalInputMode
  )(context.platform);
  try {
    instance = (runtime.render ?? render)(
      <MainMenuApp context={context} projectRoot={projectRoot} dependencies={dependencies} />,
      {
        alternateScreen: true,
        interactive: true,
        exitOnCtrlC: false,
        patchConsole: false,
      },
    );
    return await instance.waitUntilExit() as MainMenuOutcome;
  } catch (error) {
    if (!instance) (runtime.restoreAfterRenderFailure ?? restoreAfterRenderFailure)(wasRaw);
    throw error;
  } finally {
    try {
      instance?.unmount();
    } finally {
      restoreInputMode();
    }
  }
}

function MainMenuApp({
  context,
  projectRoot,
  dependencies,
}: {
  context: DeviceContext;
  projectRoot: string;
  dependencies: MainMenuDependencies;
}) {
  const [state, setState] = useState<MenuState>();
  const stateRef = useRef(state);
  stateRef.current = state;
  const { exit } = useApp();
  const windowSize = useWindowSize();

  useEffect(() => {
    let active = true;
    void (dependencies.createSnapshot ?? createMenuSnapshot)(context).then(
      (snapshot) => {
        if (active) setState(createMenuState(snapshot, projectRoot));
      },
      (error: unknown) => {
        if (!active) return;
        exit({
          status: 'failed',
          error: error instanceof Error ? error : new Error(String(error)),
        } satisfies MainMenuOutcome);
      },
    );
    return () => { active = false; };
  }, [context, dependencies, exit, projectRoot]);

  useEffect(() => {
    if (state?.outcome) exit({ status: 'selected', action: state.outcome } satisfies MainMenuOutcome);
  }, [exit, state?.outcome]);

  useInput((input, key) => {
    const current = stateRef.current;
    if (!current) {
      if (key.ctrl && input === 'c') {
        exit({ status: 'selected', action: { type: 'quit', reason: 'interrupted' } } satisfies MainMenuOutcome);
      }
      return;
    }
    if (key.ctrl && input === 'c') return setState(menuReducer(current, { type: 'interrupt' }));
    if (key.escape) return setState(menuReducer(current, { type: 'back' }));
    if (current.screen === 'bind-path') {
      if (key.return) return setState(menuReducer(current, { type: 'select' }));
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
    if (input === 'q' && current.screen === 'home') return setState(menuReducer(current, { type: 'quit' }));
    if (key.upArrow) return setState(menuReducer(current, { type: 'move', delta: -1 }));
    if (key.downArrow) return setState(menuReducer(current, { type: 'move', delta: 1 }));
    if (input === ' ') return setState(menuReducer(current, { type: 'toggle' }));
    if (key.return) setState(menuReducer(current, { type: 'select' }));
  });

  return state
    ? <MainMenuView state={state} columns={windowSize.columns} rows={windowSize.rows} />
    : <LoadingView columns={windowSize.columns} rows={windowSize.rows} />;
}

function LoadingView({ columns, rows }: { columns: number; rows: number }) {
  return (
    <Box flexDirection="column" width={columns} height={rows}>
      <Text {...inkEmphasisProps()}>{truncateDisplay('MCV · Mobile Configuration Vehicle', columns)}</Text>
      <Text>Inspecting Repository and device state…</Text>
      <Box flexGrow={1} />
      <Text {...inkRoleProps('muted')}>Ctrl+C Interrupt</Text>
    </Box>
  );
}

function MainMenuView({ state, columns, rows }: { state: MenuState; columns: number; rows: number }) {
  return (
    <Box flexDirection="column" width={columns} height={rows}>
      <Text {...inkEmphasisProps()}>{truncateDisplay('MCV · Mobile Configuration Vehicle', columns)}</Text>
      <Text {...inkRoleProps('muted')}>{truncateDisplay(screenSubtitle(state), columns)}</Text>
      {state.screen === 'home' ? <HomeSummary state={state} columns={columns} /> : null}
      {state.screen === 'bind-path' ? (
        <Box flexDirection="column" marginTop={1}>
          <Text {...inkEmphasisProps()}>Repository path</Text>
          <Text>{truncateDisplay(`${state.bindPath}█`, columns)}</Text>
        </Box>
      ) : null}
      <Box flexDirection="column" marginTop={1} flexGrow={1}>
        {state.items.map((item, index) => {
          const focused = index === state.cursor;
          const profileId = item.id.startsWith('profile:') ? item.id.slice('profile:'.length) : undefined;
          const selection = profileId
            ? `[${state.selectedProfileIds.includes(profileId) ? 'x' : ' '}] `
            : '';
          return (
            <Box key={item.id} flexDirection="column">
              <Text {...inkRoleProps(focused ? 'information' : 'muted', { emphasis: focused })}>
                {truncateDisplay(`${focused ? '›' : ' '} ${selection}${item.label}`, columns)}
              </Text>
              {focused ? (
                <Text {...inkRoleProps('muted')}>
                  {truncateDisplay(`  ${item.description}`, columns)}
                </Text>
              ) : null}
            </Box>
          );
        })}
      </Box>
      {state.notice ? <Text {...inkRoleProps('attention')}>! {truncateDisplay(state.notice, columns - 2)}</Text> : null}
      <Text>{truncateDisplay(helpLine(state), columns)}</Text>
    </Box>
  );
}

function HomeSummary({ state, columns }: { state: MenuState; columns: number }) {
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
    return (
      <Box flexDirection="column" marginTop={1}>
        <Text>{truncateDisplay('Repository  Not bound', columns)}</Text>
        <Text>{truncateDisplay(`IDEs        ${snapshot.ides.detected} detected`, columns)}</Text>
      </Box>
    );
  }
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text>{truncateDisplay(`Repository  ${repository}`, columns)}</Text>
      <Text>{truncateDisplay(`Pending     ${pending}`, columns)}</Text>
      <Text>{truncateDisplay(`IDEs        ${snapshot.ides.enabled} enabled · ${snapshot.ides.detected} detected`, columns)}</Text>
      <Text>{truncateDisplay(`Last        ${last}`, columns)}</Text>
    </Box>
  );
}

function screenSubtitle(state: MenuState): string {
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

function helpLine(state: MenuState): string {
  if (state.screen === 'loading') return 'Ctrl+C Interrupt';
  if (state.screen === 'bind-path') return 'Type path · Enter Continue · Esc Back · Ctrl+C Interrupt';
  if (state.screen === 'deploy-profiles') return '↑↓ Move · Space Select · Enter Continue · Esc Back · Ctrl+C Interrupt';
  if (state.screen === 'home') return '↑↓ Navigate · Enter Select · Esc/q Quit · Ctrl+C Interrupt';
  return '↑↓ Navigate · Enter Select · Esc Back · Ctrl+C Interrupt';
}

function restoreAfterRenderFailure(wasRaw: boolean): void {
  if (process.stdin.isTTY && typeof process.stdin.setRawMode === 'function') {
    process.stdin.setRawMode(wasRaw);
  }
  process.stdout.write('\u001b[?25h\u001b[?1049l');
}
