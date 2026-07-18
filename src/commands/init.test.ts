import * as fs from 'fs';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { createProgram } from '../index';

describe('mcv init', () => {
  const originalCwd = process.cwd();
  const originalEnv = { ...process.env };
  let testRoot: string;
  let repositoryPath: string;
  let stateRoot: string;

  beforeEach(() => {
    testRoot = fs.mkdtempSync(path.join(originalCwd, '.mcv-init-test-'));
    repositoryPath = path.join(testRoot, 'repository');
    stateRoot = path.join(testRoot, 'device');
    fs.mkdirSync(repositoryPath);

    process.chdir(repositoryPath);
    process.env.APPDATA = stateRoot;
    process.env.HOME = stateRoot;
    process.env.USERPROFILE = stateRoot;
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    process.chdir(originalCwd);
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
    fs.rmSync(testRoot, { recursive: true, force: true });
  });

  it('marks the current directory as an MCV repository and binds this device', async () => {
    await createProgram().parseAsync(['node', 'mcv', 'init']);

    const manifest = parseYaml(
      fs.readFileSync(path.join(repositoryPath, 'mcv.yaml'), 'utf8'),
    );
    expect(manifest).toMatchObject({
      schemaVersion: 1,
      repositoryId: expect.any(String),
      initializedAt: expect.any(String),
      targets: {
        codex: { enabled: true },
        claudeCode: { enabled: true },
        gemini: { enabled: true },
      },
      variables: {},
      security: {
        scanSecrets: true,
        allowPlaintextSecrets: false,
      },
      capture: {
        preserveUnknownNativeFields: true,
        includeRuntimeState: false,
      },
      deploy: {
        backupBeforeWrite: true,
        useSymlinks: false,
      },
    });

    const state = JSON.parse(
      fs.readFileSync(path.join(stateRoot, 'mcv', 'config.json'), 'utf8'),
    );
    expect(state).toMatchObject({
      deviceId: expect.any(String),
      defaultRepositoryId: manifest.repositoryId,
      repositoryPath,
      baselineSnapshot: {
        recordedAt: expect.any(String),
        files: {},
      },
    });
  });

  it('is exposed as the mcv executable in the npm package', () => {
    const packageJson = JSON.parse(
      fs.readFileSync(path.join(originalCwd, 'package.json'), 'utf8'),
    );

    expect(packageJson.bin).toEqual({ mcv: 'dist/index.js' });
  });
});
