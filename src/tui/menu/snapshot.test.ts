import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DeviceContext } from '../../adapters/types.js';
import { writeProfilesDocument } from '../../profiles/store.js';
import { writeState } from '../../utils/state.js';

vi.mock('../../operations/deploy.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../operations/deploy.js')>();
  return {
    ...actual,
    createDeployPlan: vi.fn(async () => {
      throw new Error('menu snapshot must not build a Deploy Plan');
    }),
  };
});

import { createMenuSnapshot } from './snapshot.js';

describe('MCV main menu snapshot', () => {
  let testRoot: string;
  let homeDir: string;
  let repositoryPath: string;
  let context: DeviceContext;

  beforeEach(() => {
    testRoot = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'mcv-menu-snapshot-'));
    homeDir = path.join(testRoot, 'home');
    repositoryPath = path.join(testRoot, 'repository');
    fs.mkdirSync(homeDir);
    fs.mkdirSync(repositoryPath);
    context = { homeDir, platform: 'darwin', env: {}, pathEnv: '' };
  });

  afterEach(() => {
    fs.rmSync(testRoot, { recursive: true, force: true });
  });

  it('treats a device without a binding as unbound without scanning device configuration', () => {
    writeState(context, { schemaVersion: 3 });

    expect(createMenuSnapshot(context)).toEqual({
      repository: { status: 'unbound' },
      profiles: [],
    });
  });

  it('loads binding and Profiles without building a Deploy Plan', () => {
    fs.writeFileSync(path.join(repositoryPath, 'mcv.yaml'), [
      'schemaVersion: 5',
      'repositoryId: menu-snapshot-id',
      'initializedAt: 2026-08-14T00:00:00.000Z',
      'targets:',
      '  claudeCode:',
      '    enabled: true',
      '  codex:',
      '    enabled: false',
      '  gemini:',
      '    enabled: false',
      'variables: {}',
      'capture:',
      '  preserveUnknownNativeFields: true',
      'deploy:',
      '  backupBeforeWrite: true',
      '  useSymlinks: false',
      '',
    ].join('\n'));
    writeProfilesDocument(repositoryPath, {
      schemaVersion: 1,
      profiles: {
        global: { title: 'Global', assets: ['skill:review'] },
        dev: { title: 'Development', assets: [] },
      },
    });
    writeState(context, {
      schemaVersion: 3,
      defaultRepositoryId: 'menu-snapshot-id',
      repositoryPath,
    });

    expect(createMenuSnapshot(context)).toEqual({
      repository: {
        status: 'valid',
        path: repositoryPath,
        id: 'menu-snapshot-id',
        schemaVersion: 5,
      },
      profiles: [
        { id: 'global', title: 'Global', assetCount: 1 },
        { id: 'dev', title: 'Development', assetCount: 0 },
      ],
    });
  });
});
