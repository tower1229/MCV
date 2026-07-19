import * as fs from 'fs';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProgram } from '../index';

describe('mcv discover', () => {
  let homeDir: string;

  beforeEach(() => {
    homeDir = fs.mkdtempSync(path.join(process.cwd(), '.mcv-discover-test-'));
    fs.mkdirSync(path.join(homeDir, '.claude'));
    fs.writeFileSync(path.join(homeDir, '.claude', 'settings.json'), '{}');
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(homeDir, { recursive: true, force: true });
  });

  it('reports detection and known config paths for every supported IDE', async () => {
    await createProgram({ homeDir, pathEnv: '' }).parseAsync(['node', 'mcv', 'discover']);

    expect(vi.mocked(console.log).mock.calls.map(([line]) => line)).toEqual([
      'Codex: not detected',
      `[missing] ${path.join(homeDir, '.codex')}`,
      `[missing] ${path.join(homeDir, '.codex', 'config.toml')}`,
      `[missing] ${path.join(homeDir, '.codex', 'AGENTS.md')}`,
      'Claude Code: detected',
      `[found] ${path.join(homeDir, '.claude')}`,
      `[found] ${path.join(homeDir, '.claude', 'settings.json')}`,
      `[missing] ${path.join(homeDir, '.claude', 'CLAUDE.md')}`,
      `[missing] ${path.join(homeDir, '.claude.json')}`,
      'Gemini: not detected',
      `[missing] ${path.join(homeDir, '.gemini')}`,
      `[missing] ${path.join(homeDir, '.gemini', 'config')}`,
      `[missing] ${path.join(homeDir, '.gemini', 'settings.json')}`,
      `[missing] ${path.join(homeDir, '.gemini', 'GEMINI.md')}`,
      `[missing] ${path.join(homeDir, '.gemini', 'config', 'config.json')}`,
      `[missing] ${path.join(homeDir, '.gemini', 'config', 'mcp_config.json')}`,
      `[missing] ${path.join(homeDir, '.gemini', 'antigravity-cli', 'settings.json')}`,
      `[missing] ${path.join(homeDir, 'AppData', 'Roaming', 'Antigravity', 'User', 'settings.json')}`,
      `[missing] ${path.join(homeDir, 'AppData', 'Roaming', 'Antigravity', 'User', 'keybindings.json')}`,
    ]);
  });
});
