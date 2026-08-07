import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as yaml from 'yaml';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProgram } from '../index.js';
import {
  emptyProfilesDocument,
  writeProfilesDocument,
} from '../profiles/store.js';

describe('mcv profile', () => {
  let testRoot: string;
  let repositoryPath: string;
  let stateRoot: string;

  beforeEach(() => {
    testRoot = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'mcv-profile-cli-'));
    repositoryPath = path.join(testRoot, 'repository');
    stateRoot = path.join(testRoot, 'device');
    fs.mkdirSync(repositoryPath);
    fs.mkdirSync(path.join(repositoryPath, 'common', 'skills', 'a'), { recursive: true });
    fs.mkdirSync(path.join(repositoryPath, 'common', 'skills', 'b'), { recursive: true });
    fs.writeFileSync(path.join(repositoryPath, 'mcv.yaml'), [
      'schemaVersion: 4',
      'repositoryId: repository-id',
      'initializedAt: 2026-07-19T00:00:00.000Z',
      'targets:',
      '  codex:',
      '    enabled: false',
      '  claudeCode:',
      '    enabled: false',
      '  gemini:',
      '    enabled: false',
      '    surfaces:',
      '      geminiCli: auto',
      '      antigravity: auto',
      'variables: {}',
      'capture:',
      '  preserveUnknownNativeFields: true',
      'deploy:',
      '  backupBeforeWrite: true',
      '  useSymlinks: false',
      '',
    ].join('\n'));
    fs.writeFileSync(path.join(repositoryPath, 'common', 'AGENTS.md'), '# rules\n');
    fs.writeFileSync(
      path.join(repositoryPath, 'common', 'skills', 'a', 'SKILL.md'),
      '---\nname: a\n---\n',
    );
    fs.writeFileSync(
      path.join(repositoryPath, 'common', 'skills', 'b', 'SKILL.md'),
      '---\nname: b\n---\n',
    );
    fs.writeFileSync(
      path.join(repositoryPath, 'common', 'mcp.yaml'),
      yaml.stringify({ servers: { context7: { command: 'npx', transport: 'stdio' } } }),
    );
    writeProfilesDocument(repositoryPath, {
      ...emptyProfilesDocument(),
      profiles: {
        global: { title: 'Global', assets: ['rule:canonical'] },
      },
    });
    writeDeviceState();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    process.exitCode = undefined;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = undefined;
    fs.rmSync(testRoot, { recursive: true, force: true });
  });

  it('lists Profiles with asset counts and Unassigned via one JSON document', async () => {
    await program().parseAsync(['node', 'mcv', 'profile', 'list', '--json']);

    expect(console.log).toHaveBeenCalledOnce();
    const report = JSON.parse(String(vi.mocked(console.log).mock.calls[0]?.[0]));
    expect(report).toMatchObject({
      schemaVersion: 2,
      operation: 'profile',
      command: 'list',
      status: 'reported',
      repositoryPath,
      profiles: [
        { id: 'global', title: 'Global', assetCount: 1 },
      ],
      unassignedCount: 3,
      unassignedAssetIds: expect.arrayContaining(['skill:a', 'skill:b', 'mcp:context7']),
    });
    expect(report.profilesRevision).toMatch(/^[a-f0-9]{64}$/);
    expect(report.catalogRevision).toMatch(/^[a-f0-9]{64}$/);
    expect(String(vi.mocked(console.log).mock.calls[0]?.[0])).not.toMatch(/\u001b\[/);
  });

  it('renders list and show in plain text with Unassigned counts', async () => {
    await program().parseAsync(['node', 'mcv', 'profile', 'list']);
    expect(vi.mocked(console.log).mock.calls.map(([line]) => line)).toEqual(expect.arrayContaining([
      `Repository: ${repositoryPath}`,
      'Profiles: 1',
      '  global · Global · 1 assets',
      'Unassigned: 3 assets',
    ]));

    vi.mocked(console.log).mockClear();
    await program().parseAsync(['node', 'mcv', 'profile', 'show', 'global']);
    expect(vi.mocked(console.log).mock.calls.map(([line]) => line)).toEqual(expect.arrayContaining([
      'Profile: global',
      'Title: Global',
      'Assets: 1',
      '  rule:canonical',
      'Unassigned: 3 assets',
    ]));
  });

  it('creates and inspects a dev Profile through CLI JSON alone', async () => {
    await program().parseAsync([
      'node', 'mcv', 'profile', 'create', 'dev',
      '--title', 'Development',
      '--add', 'skill:a', 'skill:b',
      '--json',
    ]);

    expect(console.log).toHaveBeenCalledOnce();
    const created = JSON.parse(String(vi.mocked(console.log).mock.calls[0]?.[0]));
    expect(created).toMatchObject({
      operation: 'profile',
      command: 'create',
      status: 'succeeded',
      data: {
        created: ['dev'],
        profile: { id: 'dev', title: 'Development', assetCount: 2 },
      },
    });
    expect(process.exitCode).toBeUndefined();

    vi.mocked(console.log).mockClear();
    await program().parseAsync(['node', 'mcv', 'profile', 'show', 'dev', '--json']);
    expect(console.log).toHaveBeenCalledOnce();
    const shown = JSON.parse(String(vi.mocked(console.log).mock.calls[0]?.[0]));
    expect(shown).toMatchObject({
      command: 'show',
      status: 'reported',
      profile: {
        id: 'dev',
        title: 'Development',
        assets: ['skill:a', 'skill:b'],
        assetCount: 2,
      },
      unassignedCount: 1,
    });
  });

  it('classifies many Assets in one edit and rejects stale --expected-revision', async () => {
    const inventory = JSON.parse(await captureJson(['profile', 'list', '--json']));
    await program().parseAsync([
      'node', 'mcv', 'profile', 'create', 'dev',
      '--expected-revision', inventory.profilesRevision,
      '--json',
    ]);
    const afterCreate = JSON.parse(String(vi.mocked(console.log).mock.calls.at(-1)?.[0]));
    vi.mocked(console.log).mockClear();

    const manyAssets = Array.from({ length: 30 }, (_, index) => {
      const name = `bulk-${String(index).padStart(2, '0')}`;
      fs.mkdirSync(path.join(repositoryPath, 'common', 'skills', name), { recursive: true });
      fs.writeFileSync(
        path.join(repositoryPath, 'common', 'skills', name, 'SKILL.md'),
        `---\nname: ${name}\n---\n`,
      );
      return `skill:${name}`;
    });

    await program().parseAsync([
      'node', 'mcv', 'profile', 'edit', 'dev',
      '--add', ...manyAssets,
      '--expected-revision', afterCreate.profilesRevision,
      '--json',
    ]);
    const edited = JSON.parse(String(vi.mocked(console.log).mock.calls.at(-1)?.[0]));
    expect(edited).toMatchObject({
      status: 'succeeded',
      data: { updated: ['dev'], profile: { id: 'dev', assetCount: 30 } },
    });

    vi.mocked(console.log).mockClear();
    process.exitCode = undefined;
    await program().parseAsync([
      'node', 'mcv', 'profile', 'edit', 'dev',
      '--title', 'Stale',
      '--expected-revision', afterCreate.profilesRevision,
      '--json',
    ]);
    const conflict = JSON.parse(String(vi.mocked(console.log).mock.calls.at(-1)?.[0]));
    expect(conflict).toMatchObject({
      status: 'failed',
      error: { code: 'profile.revisionConflict' },
    });
    expect(process.exitCode).toBe(1);
  });

  it('returns stable execution errors for unknown IDs, invalid IDs, and deleting global', async () => {
    await program().parseAsync(['node', 'mcv', 'profile', 'show', 'missing', '--json']);
    expect(JSON.parse(String(vi.mocked(console.log).mock.calls.at(-1)?.[0]))).toMatchObject({
      status: 'failed',
      error: { code: 'profile.notFound' },
    });
    expect(process.exitCode).toBe(1);

    process.exitCode = undefined;
    vi.mocked(console.log).mockClear();
    await program().parseAsync(['node', 'mcv', 'profile', 'create', 'Bad_ID', '--json']);
    expect(JSON.parse(String(vi.mocked(console.log).mock.calls.at(-1)?.[0]))).toMatchObject({
      status: 'failed',
      error: { code: 'profile.invalidId' },
    });
    expect(process.exitCode).toBe(1);

    process.exitCode = undefined;
    vi.mocked(console.log).mockClear();
    await program().parseAsync([
      'node', 'mcv', 'profile', 'create', 'dev',
      '--add', 'skill:missing',
      '--json',
    ]);
    expect(JSON.parse(String(vi.mocked(console.log).mock.calls.at(-1)?.[0]))).toMatchObject({
      status: 'failed',
      error: { code: 'profile.unknownAsset' },
    });
    expect(process.exitCode).toBe(1);

    process.exitCode = undefined;
    vi.mocked(console.log).mockClear();
    await program().parseAsync(['node', 'mcv', 'profile', 'delete', 'global', '--json']);
    expect(JSON.parse(String(vi.mocked(console.log).mock.calls.at(-1)?.[0]))).toMatchObject({
      status: 'failed',
      error: { code: 'profile.globalRequired' },
    });
    expect(process.exitCode).toBe(1);
  });

  it('deletes ordinary Profiles and supports --remove with description edits', async () => {
    await program().parseAsync([
      'node', 'mcv', 'profile', 'create', 'dev',
      '--add', 'skill:a', 'skill:b',
      '--json',
    ]);
    vi.mocked(console.log).mockClear();

    await program().parseAsync([
      'node', 'mcv', 'profile', 'edit', 'dev',
      '--description', 'General development assets',
      '--remove', 'skill:b',
      '--json',
    ]);
    expect(JSON.parse(String(vi.mocked(console.log).mock.calls.at(-1)?.[0]))).toMatchObject({
      status: 'succeeded',
      data: {
        updated: ['dev'],
        profile: {
          id: 'dev',
          description: 'General development assets',
          assets: ['skill:a'],
          assetCount: 1,
        },
      },
    });

    vi.mocked(console.log).mockClear();
    await program().parseAsync(['node', 'mcv', 'profile', 'delete', 'dev', '--json']);
    expect(JSON.parse(String(vi.mocked(console.log).mock.calls.at(-1)?.[0]))).toMatchObject({
      status: 'succeeded',
      data: { deleted: ['dev'] },
    });
    expect(fs.existsSync(path.join(repositoryPath, 'common', 'skills', 'a', 'SKILL.md'))).toBe(true);
  });

  it('rejects empty edit options as usage errors and has no rename command', async () => {
    const cli = program();
    const edit = cli.commands
      .find((command) => command.name() === 'profile')
      ?.commands.find((command) => command.name() === 'edit');
    edit?.configureOutput({ writeErr: () => {} }).exitOverride();

    await expect(
      cli.parseAsync(['node', 'mcv', 'profile', 'edit', 'global']),
    ).rejects.toMatchObject({ exitCode: 2, code: 'mcv.missingProfileEdit' });

    const profile = cli.commands.find((command) => command.name() === 'profile');
    expect(profile?.commands.map((command) => command.name())).toEqual([
      'list',
      'show',
      'create',
      'edit',
      'delete',
    ]);
  });

  async function captureJson(argv: string[]): Promise<string> {
    vi.mocked(console.log).mockClear();
    await program().parseAsync(['node', 'mcv', ...argv]);
    return String(vi.mocked(console.log).mock.calls.at(-1)?.[0]);
  }

  function program() {
    return createProgram({
      homeDir: stateRoot,
      platform: 'win32',
      env: { APPDATA: stateRoot },
      pathEnv: '',
    });
  }

  function writeDeviceState(): void {
    fs.mkdirSync(path.join(stateRoot, 'mcv'), { recursive: true });
    fs.writeFileSync(path.join(stateRoot, 'mcv', 'config.json'), JSON.stringify({
      schemaVersion: 2,
      defaultRepositoryId: 'repository-id',
      repositoryPath,
    }));
  }
});
