import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ManagedReceipt } from './managed-receipt.js';
import {
  hashProjectSkillPackageFiles,
  projectSkillDestinationRoots,
  projectSkillPackage,
} from './project-skills.js';

describe('project Skill package projection', () => {
  let testRoot: string;
  let targetRoot: string;

  beforeEach(() => {
    testRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mcv-project-skills-')));
    targetRoot = path.join(testRoot, 'project');
    fs.mkdirSync(targetRoot, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(testRoot, { recursive: true, force: true });
  });

  it('plans a whole-package copy when the destination package is absent', () => {
    const files = [
      { relativePath: 'SKILL.md', content: Buffer.from('# Review\n') },
      { relativePath: 'scripts/run.sh', content: Buffer.from('#!/bin/sh\n') },
    ];
    const projection = projectSkillPackage(
      targetRoot,
      '.claude/skills',
      { id: 'skill:review', name: 'review', files },
      undefined,
    );

    expect(projection.status).toBe('absent');
    expect(projection.targetPath).toBe(path.join(targetRoot, '.claude', 'skills', 'review'));
    expect(projection.receiptKey).toBe('.claude/skills/review');
    expect(projection.packageHash).toBe(hashProjectSkillPackageFiles(files));
    expect(projection.files).toEqual(files);
  });

  it('marks identical destination content as satisfied without rewrite', () => {
    const files = [
      { relativePath: 'SKILL.md', content: Buffer.from('# Review\n') },
      { relativePath: 'assets/icon.png', content: Buffer.from([1, 2, 3]) },
    ];
    const packageRoot = path.join(targetRoot, '.agents', 'skills', 'review');
    fs.mkdirSync(path.join(packageRoot, 'assets'), { recursive: true });
    fs.writeFileSync(path.join(packageRoot, 'SKILL.md'), files[0].content);
    fs.writeFileSync(path.join(packageRoot, 'assets', 'icon.png'), files[1].content);

    const projection = projectSkillPackage(
      targetRoot,
      '.agents/skills',
      { id: 'skill:review', name: 'review', files },
      undefined,
    );

    expect(projection.status).toBe('identical');
    expect(projection.receiptKey).toBe('.agents/skills/review');
  });

  it('flags an unknown divergent package as a conflict', () => {
    const packageRoot = path.join(targetRoot, '.claude', 'skills', 'review');
    fs.mkdirSync(packageRoot, { recursive: true });
    fs.writeFileSync(path.join(packageRoot, 'SKILL.md'), '# Local\n');

    const projection = projectSkillPackage(
      targetRoot,
      '.claude/skills',
      {
        id: 'skill:review',
        name: 'review',
        files: [{ relativePath: 'SKILL.md', content: Buffer.from('# Review\n') }],
      },
      undefined,
    );

    expect(projection.status).toBe('conflict');
  });

  it('allows a normal update when Receipt ownership still matches the local package', () => {
    const deployed = [{ relativePath: 'SKILL.md', content: Buffer.from('# Deployed\n') }];
    const packageRoot = path.join(targetRoot, '.agents', 'skills', 'review');
    fs.mkdirSync(packageRoot, { recursive: true });
    fs.writeFileSync(path.join(packageRoot, 'SKILL.md'), deployed[0].content);
    const receipt: ManagedReceipt = {
      schemaVersion: 1,
      repositoryId: 'repo',
      managed: {
        '.agents/skills/review': {
          assetId: 'skill:review',
          hash: hashProjectSkillPackageFiles(deployed),
        },
      },
    };

    const projection = projectSkillPackage(
      targetRoot,
      '.agents/skills',
      {
        id: 'skill:review',
        name: 'review',
        files: [{ relativePath: 'SKILL.md', content: Buffer.from('# Newer\n') }],
      },
      receipt,
    );

    expect(projection.status).toBe('update');
  });

  it('flags Receipt drift as a conflict even when Canonical changed', () => {
    const deployed = [{ relativePath: 'SKILL.md', content: Buffer.from('# Deployed\n') }];
    const packageRoot = path.join(targetRoot, '.claude', 'skills', 'review');
    fs.mkdirSync(packageRoot, { recursive: true });
    fs.writeFileSync(path.join(packageRoot, 'SKILL.md'), '# Local edit\n');
    const receipt: ManagedReceipt = {
      schemaVersion: 1,
      repositoryId: 'repo',
      managed: {
        '.claude/skills/review': {
          assetId: 'skill:review',
          hash: hashProjectSkillPackageFiles(deployed),
        },
      },
    };

    const projection = projectSkillPackage(
      targetRoot,
      '.claude/skills',
      {
        id: 'skill:review',
        name: 'review',
        files: [{ relativePath: 'SKILL.md', content: Buffer.from('# Newer\n') }],
      },
      receipt,
    );

    expect(projection.status).toBe('conflict');
  });

  it('dedupes Codex and Gemini onto .agents/skills and keeps Claude on .claude/skills', () => {
    expect(projectSkillDestinationRoots({
      codex: true,
      claudeCode: true,
      geminiCli: true,
    })).toEqual(['.agents/skills', '.claude/skills']);

    expect(projectSkillDestinationRoots({
      codex: false,
      claudeCode: false,
      geminiCli: true,
    })).toEqual(['.agents/skills']);

    expect(projectSkillDestinationRoots({
      codex: true,
      claudeCode: false,
      geminiCli: false,
    })).toEqual(['.agents/skills']);
  });

  it('hashes packages independently of path separators', () => {
    const withBackslashes = hashProjectSkillPackageFiles([
      { relativePath: 'scripts\\run.sh', content: Buffer.from('x') },
      { relativePath: 'refs\\note.md', content: Buffer.from('y') },
    ]);
    const withForwardSlashes = hashProjectSkillPackageFiles([
      { relativePath: 'refs/note.md', content: Buffer.from('y') },
      { relativePath: 'scripts/run.sh', content: Buffer.from('x') },
    ]);
    expect(withBackslashes).toBe(withForwardSlashes);
  });
});
