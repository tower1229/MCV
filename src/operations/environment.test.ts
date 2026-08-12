import * as fs from 'fs';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { inspectEnvironment } from './environment.js';

describe('inspectEnvironment', () => {
  let homeDir: string;
  let repositoryPath: string;

  beforeEach(() => {
    homeDir = fs.mkdtempSync(path.join(process.cwd(), '.mcv-environment-test-'));
    repositoryPath = path.join(homeDir, 'repository');
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
      schemaVersion: 4,
      operation: 'discover',
      status: 'reported',
      ready: true,
      repositoryPath: null,
      changes: [],
      environments: [
        expect.objectContaining({ id: 'codex', name: 'Codex', detected: false }),
        expect.objectContaining({ id: 'claude-code', name: 'Claude Code', detected: true }),
        expect.objectContaining({ id: 'gemini', name: 'Gemini', detected: false }),
      ],
      missingVariables: [],
      issues: [],
      nextActions: [],
    });
    expect(log).not.toHaveBeenCalled();
  });

  it('reports configuration variables without treating Skill documentation as device setup', async () => {
    fs.mkdirSync(path.join(repositoryPath, 'common', 'skills', 'example', 'references'), { recursive: true });
    fs.mkdirSync(path.join(repositoryPath, 'common', 'rules'), { recursive: true });
    fs.mkdirSync(path.join(repositoryPath, 'ide', 'claude-code', 'native'), { recursive: true });
    fs.writeFileSync(path.join(repositoryPath, 'mcv.yaml'), [
      'schemaVersion: 5',
      'repositoryId: repository-id',
      'initializedAt: 2026-08-03T00:00:00.000Z',
      'targets:',
      '  codex: { enabled: false }',
      '  claudeCode: { enabled: true }',
      '  gemini:',
      '    enabled: false',
      '    surfaces: { geminiCli: auto, antigravity: auto }',
      'variables: {}',
      'capture: { preserveUnknownNativeFields: true }',
      'deploy: { backupBeforeWrite: true, useSymlinks: false }',
      '',
    ].join('\n'));
    fs.writeFileSync(
      path.join(repositoryPath, 'ide', 'claude-code', 'native', 'settings.json'),
      '{"env":{"AUTH_TOKEN":"${env:AUTH_TOKEN}"}}\n',
    );
    fs.writeFileSync(
      path.join(repositoryPath, 'common', 'skills', 'example', 'references', 'setup.md'),
      'Example only: `${env:DOCUMENTATION_TOKEN}`\n',
    );
    fs.writeFileSync(
      path.join(repositoryPath, 'common', 'rules', 'example.json'),
      '{"example":"${env:RULE_TOKEN}"}\n',
    );
    fs.writeFileSync(
      path.join(repositoryPath, 'ide', 'claude-code', 'native', 'unmanaged.json'),
      '{"example":"${env:UNKNOWN_NATIVE_TOKEN}"}\n',
    );

    const report = await inspectEnvironment({
      homeDir,
      platform: 'darwin',
      env: {},
      pathEnv: '',
    }, repositoryPath);

    expect(report.missingVariables).toEqual(['AUTH_TOKEN']);
  });
});
