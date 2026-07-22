import * as fs from 'fs';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProgram } from '../index';

describe('mcv status', () => {
  const originalCwd = process.cwd();
  let testRoot: string;
  let stateRoot: string;

  beforeEach(() => {
    testRoot = fs.mkdtempSync(path.join(originalCwd, '.mcv-status-test-'));
    stateRoot = path.join(testRoot, 'device');
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(testRoot, { recursive: true, force: true });
  });

  it('reports matching, missing, and drifted files from the deployment baseline', async () => {
    const matchingPath = path.join(testRoot, 'matching.txt');
    const missingPath = path.join(testRoot, 'missing.txt');
    const driftedPath = path.join(testRoot, 'drifted.txt');
    fs.writeFileSync(matchingPath, 'abc');
    fs.writeFileSync(driftedPath, 'changed');
    fs.mkdirSync(path.join(stateRoot, 'mcv'), { recursive: true });
    fs.writeFileSync(
      path.join(stateRoot, 'mcv', 'config.json'),
      JSON.stringify({
        baselineSnapshot: {
          recordedAt: '2026-07-19T00:00:00.000Z',
          files: {
            [matchingPath]: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
            [missingPath]: 'expected-hash',
            [driftedPath]: 'expected-hash',
          },
        },
      }),
    );

    await createProgram({
      homeDir: stateRoot,
      platform: 'win32',
      env: { APPDATA: stateRoot },
    }).parseAsync(['node', 'mcv', 'status']);

    expect(vi.mocked(console.log).mock.calls.map(([line]) => line)).toEqual([
      `[matching] ${matchingPath}`,
      `[missing] ${missingPath}`,
      `[drifted] ${driftedPath}`,
    ]);
  });
});
