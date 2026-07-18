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

  it('reports Claude Code detection and the presence of each known config path', async () => {
    await createProgram({ homeDir }).parseAsync(['node', 'mcv', 'discover']);

    expect(vi.mocked(console.log).mock.calls.map(([line]) => line)).toEqual([
      'Claude Code: detected',
      `[found] ${path.join(homeDir, '.claude')}`,
      `[found] ${path.join(homeDir, '.claude', 'settings.json')}`,
      `[missing] ${path.join(homeDir, '.claude', 'CLAUDE.md')}`,
      `[missing] ${path.join(homeDir, '.claude.json')}`,
    ]);
  });
});
