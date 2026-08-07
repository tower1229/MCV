import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import type { DeviceContext } from '../adapters/types.js';
import { getStateFilePath, mapManagedInventoryToGlobalScope, readState } from './state.js';

describe('device state compatibility', () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
  });

  it('normalizes legacy Gemini Surface IDs stored in the ide field', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mcv-state-'));
    roots.push(root);
    const context: DeviceContext = {
      homeDir: path.join(root, 'home'),
      platform: 'win32',
      env: { APPDATA: path.join(root, 'state') },
    };
    const statePath = getStateFilePath(context);
    const projectionPath = path.join(context.homeDir, '.gemini', 'skills', 'review');
    const antigravityPath = path.join(context.homeDir, '.gemini', 'config', 'skills', 'review');
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    fs.writeFileSync(statePath, JSON.stringify({
      schemaVersion: 2,
      managedSkillLayout: {
        packages: {},
        projections: {
          [projectionPath]: {
            packageName: 'review',
            projectionPath,
            ide: 'gemini-cli',
            surface: 'gemini-cli',
            expectedLinkTarget: path.join(context.homeDir, '.agents', 'skills', 'review'),
            topologyHash: 'hash',
            source: 'repository',
          },
          [antigravityPath]: {
            packageName: 'review',
            projectionPath: antigravityPath,
            ide: 'antigravity',
            surface: 'antigravity',
            expectedLinkTarget: path.join(context.homeDir, '.agents', 'skills', 'review'),
            topologyHash: 'hash',
            source: 'repository',
          },
        },
      },
    }));

    expect(readState(context).managedSkillLayout?.projections[projectionPath]).toMatchObject({
      ide: 'gemini',
      surface: 'gemini-cli',
    });
    expect(readState(context).managedSkillLayout?.projections[antigravityPath]).toMatchObject({
      ide: 'gemini',
      surface: 'antigravity',
    });
  });

  it('maps schema 2 managed inventory entries to global-scope history', () => {
    expect(mapManagedInventoryToGlobalScope({
      '/tmp/config.toml': { source: '/repo', hash: 'abc' },
    })).toEqual({
      '/tmp/config.toml': { source: '/repo', hash: 'abc', scope: 'global' },
    });
  });
});
