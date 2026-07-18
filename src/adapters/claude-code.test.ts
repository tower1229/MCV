import * as fs from 'fs';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ClaudeCodeAdapter } from './claude-code';

describe('ClaudeCodeAdapter', () => {
  let homeDir: string;

  beforeEach(() => {
    homeDir = fs.mkdtempSync(path.join(process.cwd(), '.mcv-claude-adapter-test-'));
  });

  afterEach(() => {
    fs.rmSync(homeDir, { recursive: true, force: true });
  });

  it('detects Claude Code from user configuration and reports known config paths', async () => {
    const claudeDir = path.join(homeDir, '.claude');
    fs.mkdirSync(claudeDir);
    fs.writeFileSync(path.join(claudeDir, 'settings.json'), '{}');

    const adapter = new ClaudeCodeAdapter();
    const context = { homeDir };

    await expect(adapter.detect(context)).resolves.toEqual({
      id: 'claude-code',
      name: 'Claude Code',
      detected: true,
      configDirectories: [
        {
          id: 'config-root',
          path: path.join(homeDir, '.claude'),
          exists: true,
        },
      ],
    });
    await expect(adapter.discoverFiles(context)).resolves.toEqual([
      {
        id: 'user-settings',
        path: path.join(homeDir, '.claude', 'settings.json'),
        exists: true,
      },
      {
        id: 'user-instructions',
        path: path.join(homeDir, '.claude', 'CLAUDE.md'),
        exists: false,
      },
      {
        id: 'user-state',
        path: path.join(homeDir, '.claude.json'),
        exists: false,
      },
    ]);
  });

  it('detects a Claude Code executable before any config file exists', async () => {
    const binDir = path.join(homeDir, 'bin');
    fs.mkdirSync(binDir);
    fs.writeFileSync(path.join(binDir, 'claude.cmd'), '');

    const adapter = new ClaudeCodeAdapter();

    await expect(
      adapter.detect({
        homeDir,
        platform: 'win32',
        pathEnv: binDir,
        pathExt: '.CMD',
      }),
    ).resolves.toMatchObject({ detected: true });
  });

  it('detects Claude Code from its configuration directory alone', async () => {
    fs.mkdirSync(path.join(homeDir, '.claude'));

    const adapter = new ClaudeCodeAdapter();

    await expect(
      adapter.detect({ homeDir, pathEnv: '' }),
    ).resolves.toMatchObject({ detected: true });
    await expect(adapter.detect({ homeDir, pathEnv: '' })).resolves.toMatchObject({
      configDirectories: [
        {
          id: 'config-root',
          path: path.join(homeDir, '.claude'),
          exists: true,
        },
      ],
    });
  });

  it('does not treat a directory on PATH as the Claude Code executable', async () => {
    const binDir = path.join(homeDir, 'bin');
    fs.mkdirSync(path.join(binDir, 'claude.cmd'), { recursive: true });

    const adapter = new ClaudeCodeAdapter();

    await expect(
      adapter.detect({
        homeDir,
        platform: 'win32',
        pathEnv: binDir,
        pathExt: '.CMD',
      }),
    ).resolves.toMatchObject({ detected: false });
  });
});
