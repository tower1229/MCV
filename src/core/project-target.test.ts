import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DeviceContext } from '../adapters/types.js';
import {
  assertPathContainedInProjectRoot,
  validateProjectTargetRoot,
} from './project-target.js';

describe('project targetRoot validation', () => {
  let testRoot: string;
  let homeDir: string;
  let context: DeviceContext;
  let projectRoot: string;

  beforeEach(() => {
    testRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mcv-project-target-')));
    homeDir = path.join(testRoot, 'home');
    projectRoot = path.join(testRoot, 'project');
    fs.mkdirSync(homeDir, { recursive: true });
    fs.mkdirSync(projectRoot, { recursive: true });
    context = {
      homeDir,
      platform: process.platform,
      env: { HOME: homeDir, USERPROFILE: homeDir },
    };
  });

  afterEach(() => {
    fs.rmSync(testRoot, { recursive: true, force: true });
  });

  it('accepts an existing directory and returns its realpath', () => {
    const result = validateProjectTargetRoot(projectRoot, context, {
      boundRepositoryPath: path.join(testRoot, 'repository'),
    });
    expect(result).toEqual({ ok: true, targetRoot: fs.realpathSync(projectRoot) });
  });

  it('rejects an empty or whitespace path without resolving broad directories', () => {
    for (const raw of ['', '   ', undefined]) {
      const result = validateProjectTargetRoot(raw as string, context, {
        boundRepositoryPath: path.join(testRoot, 'repository'),
      });
      expect(result).toMatchObject({
        ok: false,
        error: { code: 'deploy.invalidTargetRoot' },
      });
    }
  });

  it('rejects missing paths and non-directories', () => {
    const missing = validateProjectTargetRoot(path.join(testRoot, 'missing'), context, {
      boundRepositoryPath: path.join(testRoot, 'repository'),
    });
    expect(missing).toMatchObject({ ok: false, error: { code: 'deploy.invalidTargetRoot' } });

    const filePath = path.join(testRoot, 'file.txt');
    fs.writeFileSync(filePath, 'x');
    const asFile = validateProjectTargetRoot(filePath, context, {
      boundRepositoryPath: path.join(testRoot, 'repository'),
    });
    expect(asFile).toMatchObject({ ok: false, error: { code: 'deploy.invalidTargetRoot' } });
  });

  it('rejects HOME and filesystem roots', () => {
    const asHome = validateProjectTargetRoot(homeDir, context, {
      boundRepositoryPath: path.join(testRoot, 'repository'),
    });
    expect(asHome).toMatchObject({ ok: false, error: { code: 'deploy.invalidTargetRoot' } });

    const root = path.parse(testRoot).root;
    const asRoot = validateProjectTargetRoot(root, context, {
      boundRepositoryPath: path.join(testRoot, 'repository'),
    });
    expect(asRoot).toMatchObject({ ok: false, error: { code: 'deploy.invalidTargetRoot' } });
  });

  it('rejects a bound MCV Repository path', () => {
    const repositoryPath = path.join(testRoot, 'repository');
    fs.mkdirSync(repositoryPath, { recursive: true });
    fs.writeFileSync(path.join(repositoryPath, 'mcv.yaml'), 'schemaVersion: 4\n');
    const result = validateProjectTargetRoot(repositoryPath, context, {
      boundRepositoryPath: repositoryPath,
    });
    expect(result).toMatchObject({ ok: false, error: { code: 'deploy.invalidTargetRoot' } });
  });

  it('rejects output paths outside targetRoot or under symlink ancestors', () => {
    const targetRoot = fs.realpathSync(projectRoot);
    const inside = path.join(targetRoot, 'AGENTS.md');
    expect(() => assertPathContainedInProjectRoot(targetRoot, inside)).not.toThrow();

    expect(() => assertPathContainedInProjectRoot(
      targetRoot,
      path.join(testRoot, 'outside', 'AGENTS.md'),
    )).toThrow(/containment/i);

    const linked = path.join(testRoot, 'linked-child');
    fs.mkdirSync(linked);
    const alias = path.join(projectRoot, 'via-link');
    fs.symlinkSync(linked, alias, process.platform === 'win32' ? 'junction' : 'dir');
    expect(() => assertPathContainedInProjectRoot(
      targetRoot,
      path.join(alias, 'AGENTS.md'),
    )).toThrow(/symlink|junction|reparse/i);
  });

  it.runIf(process.platform === 'win32')(
    'Windows containment rejects junction ancestors under targetRoot',
    () => {
      const targetRoot = fs.realpathSync(projectRoot);
      const external = path.join(testRoot, 'junction-target');
      fs.mkdirSync(external);
      const junction = path.join(projectRoot, 'via-junction');
      fs.symlinkSync(external, junction, 'junction');
      expect(() => assertPathContainedInProjectRoot(
        targetRoot,
        path.join(junction, 'AGENTS.md'),
      )).toThrow(/junction|symlink|reparse/i);
    },
  );

  it.runIf(process.platform !== 'win32')(
    'POSIX containment rejects directory-symlink ancestors under targetRoot',
    () => {
      const targetRoot = fs.realpathSync(projectRoot);
      const external = path.join(testRoot, 'symlink-target');
      fs.mkdirSync(external);
      const alias = path.join(projectRoot, 'via-symlink');
      fs.symlinkSync(external, alias, 'dir');
      expect(() => assertPathContainedInProjectRoot(
        targetRoot,
        path.join(alias, 'AGENTS.md'),
      )).toThrow(/symlink|junction|reparse/i);
    },
  );
});
