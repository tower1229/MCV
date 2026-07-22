import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProgram } from '../index';
import { writeState } from '../utils/state';

describe('mcv restore', () => {
  const originalCwd = process.cwd();
  let testRoot: string;
  let stateRoot: string;

  beforeEach(() => {
    testRoot = fs.mkdtempSync(path.join(originalCwd, '.mcv-restore-test-'));
    stateRoot = path.join(testRoot, 'device');
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
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

    await createProgram({ homeDir: stateRoot, platform: 'win32', env: { APPDATA: stateRoot } })
      .parseAsync(['node', 'mcv', 'restore']);

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
          status: 'complete',
          files: [{
            action: 'modify',
            originalPath: targetPath,
            backupPath: path.join('files', '0-settings.json'),
            beforeHash: digest(content),
            afterHash: digest('deployed'),
          }],
        }),
      );
    }
  });

  it('restores the reviewed backup while ignoring newer failed or damaged backups', async () => {
    const targetPath = path.join(testRoot, 'home', 'settings.json');
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.writeFileSync(targetPath, 'deployed');
    const backupRoot = path.join(stateRoot, 'mcv', 'backups');
    for (const [name, createdAt, status, content] of [
      ['complete', '2026-07-19T00:00:00.000Z', 'complete', 'safe backup'],
      ['failed', '2026-07-20T00:00:00.000Z', 'failed', 'partial backup'],
      ['damaged', '2026-07-21T00:00:00.000Z', 'complete', 'damaged backup'],
    ] as const) {
      const directory = path.join(backupRoot, name, 'files');
      fs.mkdirSync(directory, { recursive: true });
      fs.writeFileSync(path.join(directory, 'settings.json'), content);
      fs.writeFileSync(path.join(backupRoot, name, 'manifest.json'), JSON.stringify({
        createdAt,
        status,
        files: [{
          action: 'modify',
          originalPath: targetPath,
          backupPath: 'files/settings.json',
          beforeHash: name === 'damaged' ? digest('different content') : digest(content),
          afterHash: digest('deployed'),
        }],
      }));
    }
    await createProgram({ homeDir: stateRoot, platform: 'win32', env: { APPDATA: stateRoot } })
      .parseAsync(['node', 'mcv', 'restore']);
    expect(fs.readFileSync(targetPath, 'utf8')).toBe('safe backup');
  });

  it('blocks Restore while the bound Repository still uses an old schema', async () => {
    const repositoryPath = path.join(testRoot, 'old-repository');
    fs.mkdirSync(repositoryPath);
    fs.writeFileSync(path.join(repositoryPath, 'mcv.yaml'), 'schemaVersion: 1\nrepositoryId: old-repository-id\n');
    const context = { homeDir: stateRoot, platform: 'win32' as const, env: { APPDATA: stateRoot } };
    writeState(context, {
      schemaVersion: 2,
      repositoryPath,
      defaultRepositoryId: 'old-repository-id',
    });

    await expect(createProgram(context).parseAsync(['node', 'mcv', 'restore']))
      .rejects.toThrow('Repository schema 1 requires migration');
  });

  it('prints an English Restore Plan without changing target files', async () => {
    const targetPath = path.join(testRoot, 'home', 'settings.json');
    createCompleteBackup(targetPath, 'deployed content', 'original content');

    await createProgram({ homeDir: stateRoot, platform: 'win32', env: { APPDATA: stateRoot } })
      .parseAsync(['node', 'mcv', 'restore', '--dry-run']);

    expect(vi.mocked(console.log).mock.calls.map(([line]) => line)).toEqual(expect.arrayContaining([
      'Backup time: 2026-07-19T00:00:00.000Z',
      `  [restore] ${targetPath}`,
      'Summary: 1 file(s) to restore, 0 file(s) to delete.',
      expect.stringContaining('Next:'),
    ]));
    expect(fs.readFileSync(targetPath, 'utf8')).toBe('deployed content');
    expect(fs.existsSync(path.join(stateRoot, 'mcv', 'restore-backups'))).toBe(false);
  });

  it('prints one Restore Plan JSON document', async () => {
    const targetPath = path.join(testRoot, 'home', 'settings.json');
    createCompleteBackup(targetPath, 'deployed content', 'original content');

    await createProgram({ homeDir: stateRoot, platform: 'win32', env: { APPDATA: stateRoot } })
      .parseAsync(['node', 'mcv', 'restore', '--dry-run', '--json']);

    expect(console.log).toHaveBeenCalledOnce();
    expect(JSON.parse(String(vi.mocked(console.log).mock.calls[0]?.[0]))).toMatchObject({
      schemaVersion: 1,
      operation: 'restore',
      status: 'planned',
      readyToApply: true,
      backup: { createdAt: '2026-07-19T00:00:00.000Z' },
      changes: [{ action: 'restore', targetPath }],
    });
    expect(fs.readFileSync(targetPath, 'utf8')).toBe('deployed content');
  });

  function createCompleteBackup(
    targetPath: string,
    deployedContent: string,
    originalContent: string,
  ): void {
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.writeFileSync(targetPath, deployedContent);
    const directory = path.join(stateRoot, 'mcv', 'backups', 'complete');
    const backupPath = path.join('files', 'settings.json');
    fs.mkdirSync(path.join(directory, 'files'), { recursive: true });
    fs.writeFileSync(path.join(directory, backupPath), originalContent);
    fs.writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify({
      createdAt: '2026-07-19T00:00:00.000Z',
      status: 'complete',
      files: [{
        action: 'modify',
        originalPath: targetPath,
        backupPath,
        beforeHash: digest(originalContent),
        afterHash: digest(deployedContent),
      }],
    }));
  }

  function digest(content: string): string {
    return crypto.createHash('sha256').update(content).digest('hex');
  }
});
