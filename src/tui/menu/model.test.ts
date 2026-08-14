import { describe, expect, it } from 'vitest';
import {
  createMenuState,
  menuReducer,
  shouldOpenMainMenu,
  type MenuSnapshot,
} from './model.js';

describe('MCV main menu model', () => {
  it.each([
    ['unbound', snapshot({ repository: { status: 'unbound' } }), 'create-repository'],
    ['blocked', snapshot({ repository: { status: 'blocked', message: 'Migration required.' } }), 'inspect'],
    ['bound', snapshot(), 'capture'],
  ] as const)('derives the %s situation and its primary task', (situation, input, primaryTask) => {
    const state = createMenuState(input, '/project');

    expect(state.situation).toBe(situation);
    expect(state.screen).toBe('home');
    expect(state.items[state.cursor]?.id).toBe(primaryTask);
  });

  it('navigates into Deploy intent without creating a business Plan', () => {
    let state = createMenuState(snapshot(), '/project');

    state = menuReducer(state, { type: 'move', delta: 1 });
    state = menuReducer(state, { type: 'select' });
    expect(state.screen).toBe('deploy-scope');
    expect(state.deployScope).toBe('project');
    expect(state.selectedProfileIds).toEqual([]);

    state = menuReducer(state, { type: 'move', delta: 1 });
    state = menuReducer(state, { type: 'select' });
    expect(state.screen).toBe('deploy-profiles');
    expect(state.deployScope).toBe('global');
    expect(state.selectedProfileIds).toEqual(['global']);
    expect(state).not.toHaveProperty('plan');
    expect(state).not.toHaveProperty('issues');
  });

  it('emits only a reviewed Project Deploy intent after an explicit Profile selection', () => {
    let state = createMenuState(snapshot(), '/project');
    state = menuReducer(state, { type: 'move', delta: 1 });
    state = menuReducer(state, { type: 'select' });
    state = menuReducer(state, { type: 'select' });
    state = menuReducer(state, { type: 'move', delta: 1 });
    state = menuReducer(state, { type: 'select' });
    expect(state.outcome).toBeUndefined();
    state = menuReducer(state, { type: 'toggle' });
    state = menuReducer(state, { type: 'move', delta: 1 });
    state = menuReducer(state, { type: 'select' });

    expect(state.outcome).toEqual({
      type: 'deploy',
      scope: 'project',
      profileIds: ['dev'],
      targetRoot: '/project',
    });
  });

  it('collects a Bind path and preserves cancellation and interruption semantics', () => {
    let state = createMenuState(snapshot({ repository: { status: 'unbound' } }), '/project');
    state = menuReducer(state, { type: 'move', delta: 1 });
    state = menuReducer(state, { type: 'select' });
    expect(state.screen).toBe('bind-path');
    state = menuReducer(state, { type: 'path.changed', value: '/existing/repository' });
    state = menuReducer(state, { type: 'select' });
    expect(state.outcome).toEqual({ type: 'bind', repositoryPath: '/existing/repository' });

    const cancelled = menuReducer(createMenuState(snapshot(), '/project'), { type: 'quit' });
    expect(cancelled.outcome).toEqual({ type: 'quit', reason: 'cancelled' });
    const interrupted = menuReducer(createMenuState(snapshot(), '/project'), { type: 'interrupt' });
    expect(interrupted.outcome).toEqual({ type: 'quit', reason: 'interrupted' });
  });

  it('opens only in a capable interactive terminal', () => {
    const capable = {
      stdinIsTTY: true,
      stdoutIsTTY: true,
      term: 'xterm-256color',
      columns: 60,
      rows: 18,
      locale: 'en_US.UTF-8',
    };
    expect(shouldOpenMainMenu(capable)).toBe(true);
    expect(shouldOpenMainMenu({ ...capable, stdinIsTTY: false })).toBe(false);
    expect(shouldOpenMainMenu({ ...capable, stdoutIsTTY: false })).toBe(false);
    expect(shouldOpenMainMenu({ ...capable, term: 'dumb' })).toBe(false);
    expect(shouldOpenMainMenu({ ...capable, columns: 59 })).toBe(false);
    expect(shouldOpenMainMenu({ ...capable, rows: 17 })).toBe(false);
    expect(shouldOpenMainMenu({ ...capable, locale: 'C' })).toBe(false);
    expect(shouldOpenMainMenu({ ...capable, locale: 'POSIX' })).toBe(false);
  });
});

function snapshot(overrides: Partial<MenuSnapshot> = {}): MenuSnapshot {
  return {
    repository: {
      status: 'valid',
      path: '/repository',
      id: 'repository-id',
      schemaVersion: 5,
    },
    profiles: [
      { id: 'global', title: 'Global', assetCount: 4 },
      { id: 'dev', title: 'Development', assetCount: 2 },
    ],
    ...overrides,
  };
}
