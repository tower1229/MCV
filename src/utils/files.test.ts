import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { hashDirectoryTree } from './files.js';

describe('hashDirectoryTree', () => {
  let testRoot: string;
  let first: string;
  let second: string;

  beforeEach(() => {
    testRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mcv-directory-hash-')));
    first = path.join(testRoot, 'first');
    second = path.join(testRoot, 'second');
    for (const root of [first, second]) {
      fs.mkdirSync(path.join(root, 'nested', 'empty'), { recursive: true });
      fs.writeFileSync(path.join(root, 'root.txt'), 'root\n');
      fs.writeFileSync(path.join(root, 'nested', 'child.txt'), 'child\n');
    }
  });

  afterEach(() => {
    fs.rmSync(testRoot, { recursive: true, force: true });
  });

  it('is stable across equivalent nested trees and detects file or directory changes', () => {
    expect(hashDirectoryTree(first)).toBe(hashDirectoryTree(second));

    fs.writeFileSync(path.join(second, 'nested', 'child.txt'), 'changed\n');
    expect(hashDirectoryTree(first)).not.toBe(hashDirectoryTree(second));

    fs.writeFileSync(path.join(second, 'nested', 'child.txt'), 'child\n');
    fs.mkdirSync(path.join(second, 'added-directory'));
    expect(hashDirectoryTree(first)).not.toBe(hashDirectoryTree(second));
  });

  it('hashes symbolic-link text instead of the linked content', () => {
    const externalFirst = path.join(testRoot, 'external-first');
    const externalSecond = path.join(testRoot, 'external-second');
    fs.mkdirSync(externalFirst);
    fs.mkdirSync(externalSecond);
    fs.writeFileSync(path.join(externalFirst, 'same.txt'), 'same\n');
    fs.writeFileSync(path.join(externalSecond, 'same.txt'), 'same\n');
    fs.symlinkSync(externalFirst, path.join(first, 'alias'), 'junction');
    fs.symlinkSync(externalFirst, path.join(second, 'alias'), 'junction');
    expect(hashDirectoryTree(first)).toBe(hashDirectoryTree(second));

    fs.rmSync(path.join(second, 'alias'));
    fs.symlinkSync(externalSecond, path.join(second, 'alias'), 'junction');
    expect(hashDirectoryTree(first)).not.toBe(hashDirectoryTree(second));
  });
});
