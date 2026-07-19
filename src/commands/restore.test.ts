import * as fs from 'fs';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProgram } from '../index';

describe('mcv restore', () => {
  const originalCwd = process.cwd();
  const originalEnv = { ...process.env };
  let testRoot: string;
  let stateRoot: string;

  beforeEach(() => {
    testRoot = fs.mkdtempSync(path.join(originalCwd, '.mcv-restore-test-'));
    stateRoot = path.join(testRoot, 'device');
    process.env.APPDATA = stateRoot;
    process.env.HOME = stateRoot;
    process.env.USERPROFILE = stateRoot;
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
    fs.rmSync(testRoot, { recursive: true, force: true });
  });

  it('restores every file from the most recent deployment backup', async () => {
    const targetPath = path.join(testRoot, 'home', '.claude', 'settings.json');
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.writeFileSync(targetPath, 'deployed');

    const backupRoot = path.join(stateRoot, 'mcv', 'backups');
    createBackup('older', '2026-07-18T00:00:00.000Z', 'older content');
    createBackup('latest', '2026-07-19T00:00:00.000Z', 'restored content');

    await createProgram().parseAsync(['node', 'mcv', 'restore']);

    expect(fs.readFileSync(targetPath, 'utf8')).toBe('restored content');
    expect(vi.mocked(console.log)).toHaveBeenCalledWith(`[restored] ${targetPath}`);
    expect(vi.mocked(console.log)).toHaveBeenCalledWith('Restored 1 file(s) from the latest backup.');

    function createBackup(name: string, createdAt: string, content: string): void {
      const directory = path.join(backupRoot, name);
      fs.mkdirSync(path.join(directory, 'files'), { recursive: true });
      fs.writeFileSync(path.join(directory, 'files', '0-settings.json'), content);
      fs.writeFileSync(
        path.join(directory, 'manifest.json'),
        JSON.stringify({
          createdAt,
          files: [{
            originalPath: targetPath,
            backupPath: path.join('files', '0-settings.json'),
          }],
        }),
      );
    }
  });
});
