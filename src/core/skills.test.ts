import * as fs from 'fs';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { collectSkills } from './skills';

describe('Skill package collection', () => {
  const roots: string[] = [];
  afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

  it('hashes and preserves complete packages including binary assets', () => {
    const root = fs.mkdtempSync(path.join(process.cwd(), '.mcv-skills-')); roots.push(root);
    const skill = path.join(root, 'demo');
    fs.mkdirSync(path.join(skill, 'scripts'), { recursive: true });
    fs.mkdirSync(path.join(skill, 'assets'), { recursive: true });
    fs.writeFileSync(path.join(skill, 'SKILL.md'), '---\nname: demo\n---\n# Demo\n');
    fs.writeFileSync(path.join(skill, 'scripts', 'run.js'), 'console.log("ok")\n');
    fs.writeFileSync(path.join(skill, 'assets', 'icon.bin'), Buffer.from([0, 1, 2, 255]));
    const result = collectSkills([{ ide: 'test', surface: 'test', root }]);
    expect(new Set(result.packages.get('demo')?.[0].files.map((file) => file.relativePath))).toEqual(new Set([
      path.join('assets', 'icon.bin'), 'SKILL.md', path.join('scripts', 'run.js'),
    ]));
  });

  it('rejects mismatched names, plaintext secrets, and symlinks', () => {
    const root = fs.mkdtempSync(path.join(process.cwd(), '.mcv-skills-')); roots.push(root);
    const mismatch = path.join(root, 'mismatch'); fs.mkdirSync(mismatch);
    fs.writeFileSync(path.join(mismatch, 'SKILL.md'), '---\nname: other\n---\n');
    const unsafe = path.join(root, 'unsafe'); fs.mkdirSync(unsafe);
    fs.writeFileSync(path.join(unsafe, 'SKILL.md'), '---\nname: unsafe\n---\n');
    fs.writeFileSync(path.join(unsafe, 'secret.txt'), 'token: ghp_abcdefghijklmnopqrstuvwxyz123456');
    const result = collectSkills([{ ide: 'test', surface: 'test', root }]);
    expect(result.packages.size).toBe(0);
    expect(result.warnings.join('\n')).toContain('does not match directory name');
    expect(result.warnings.join('\n')).toContain('Blocked Skill file');
  });
});
