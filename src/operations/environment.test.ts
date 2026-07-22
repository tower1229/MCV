import * as fs from 'fs';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { inspectEnvironment } from './environment';

describe('inspectEnvironment', () => {
  let homeDir: string;

  beforeEach(() => {
    homeDir = fs.mkdtempSync(path.join(process.cwd(), '.mcv-environment-test-'));
    fs.mkdirSync(path.join(homeDir, '.claude'));
    fs.writeFileSync(path.join(homeDir, '.claude', 'settings.json'), '{}');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(homeDir, { recursive: true, force: true });
  });

  it('returns the supported IDE discovery as a structured report without terminal output', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    const report = await inspectEnvironment({
      homeDir,
      platform: 'win32',
      env: {},
      pathEnv: '',
    });

    expect(report).toEqual({
      schemaVersion: 1,
      operation: 'discover',
      status: 'reported',
      ready: true,
      environments: [
        expect.objectContaining({ id: 'codex', name: 'Codex', detected: false }),
        expect.objectContaining({ id: 'claude-code', name: 'Claude Code', detected: true }),
        expect.objectContaining({ id: 'gemini', name: 'Gemini', detected: false }),
      ],
      issues: [],
      nextActions: [],
    });
    expect(log).not.toHaveBeenCalled();
  });
});
