import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { hashDeviceTopologyNode } from './canonical-skill-device-layout.js';
import { collectSkills } from './skills.js';

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

  it('rejects mismatched names and package-internal symlinks while preserving plaintext files', () => {
    const root = fs.mkdtempSync(path.join(process.cwd(), '.mcv-skills-')); roots.push(root);
    const mismatch = path.join(root, 'mismatch'); fs.mkdirSync(mismatch);
    fs.writeFileSync(path.join(mismatch, 'SKILL.md'), '---\nname: other\n---\n');
    const unsafe = path.join(root, 'unsafe'); fs.mkdirSync(unsafe);
    fs.writeFileSync(path.join(unsafe, 'SKILL.md'), '---\nname: unsafe\n---\n');
    fs.writeFileSync(path.join(unsafe, 'secret.txt'), 'token: ghp_abcdefghijklmnopqrstuvwxyz123456');
    fs.writeFileSync(path.join(unsafe, '.env'), 'API_TOKEN=plain-token\n');
    fs.writeFileSync(path.join(unsafe, 'credentials.json'), '{"apiKey":"plain-key"}\n');
    fs.writeFileSync(path.join(unsafe, 'private.pem'), '-----BEGIN PRIVATE KEY-----\nplain-key\n');
    const linked = path.join(root, 'linked'); fs.mkdirSync(linked);
    fs.writeFileSync(path.join(linked, 'SKILL.md'), '---\nname: linked\n---\n');
    if (process.platform !== 'win32') {
      fs.symlinkSync(path.join(linked, 'SKILL.md'), path.join(linked, 'alias.md'));
    }
    const result = collectSkills([{ ide: 'test', surface: 'test', root }]);
    expect(result.packages.has('mismatch')).toBe(false);
    expect(result.packages.has('unsafe')).toBe(true);
    expect(result.packages.get('unsafe')?.[0].files).toEqual(expect.arrayContaining([
      expect.objectContaining({ relativePath: 'secret.txt' }),
      expect.objectContaining({ relativePath: '.env' }),
      expect.objectContaining({ relativePath: 'credentials.json' }),
      expect.objectContaining({ relativePath: 'private.pem' }),
    ]));
    expect(result.warnings.join('\n')).toContain('does not match directory name');
    expect(result.warnings.join('\n')).not.toContain('Blocked Skill file');
    if (process.platform !== 'win32') {
      expect(result.packages.has('linked')).toBe(false);
      expect(result.warnings.join('\n')).toContain('portable Skill package');
    }
  });

  it('groups managed projection aliases that resolve to one physical package', () => {
    if (process.platform === 'win32') return;
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mcv-skills-link-')); roots.push(root);
    const storeRoot = path.join(root, 'agents', 'skills');
    const claudeRoot = path.join(root, 'claude', 'skills');
    const geminiRoot = path.join(root, 'gemini', 'skills');
    const physical = path.join(storeRoot, 'demo');
    fs.mkdirSync(path.join(physical, 'assets'), { recursive: true });
    fs.mkdirSync(claudeRoot, { recursive: true });
    fs.mkdirSync(geminiRoot, { recursive: true });
    fs.writeFileSync(path.join(physical, 'SKILL.md'), '---\nname: demo\n---\n# Demo\n');
    fs.writeFileSync(path.join(physical, 'assets', 'icon.bin'), Buffer.from([0, 1, 2, 255]));
    fs.symlinkSync(physical, path.join(claudeRoot, 'demo'), 'dir');
    fs.symlinkSync(physical, path.join(geminiRoot, 'demo'), 'dir');

    const result = collectSkills([
      { ide: 'codex', surface: 'codex', root: storeRoot },
      { ide: 'claude-code', surface: 'claude-code', root: claudeRoot },
      { ide: 'gemini', surface: 'gemini-cli', root: geminiRoot },
    ], { managedProjections: {
      [path.join(claudeRoot, 'demo')]: {
        packageName: 'demo',
        projectionPath: path.join(claudeRoot, 'demo'),
        ide: 'claude-code',
        surface: 'claude-code',
        expectedLinkTarget: physical,
        topologyHash: hashDeviceTopologyNode(path.join(claudeRoot, 'demo')),
        source: root,
      },
      [path.join(geminiRoot, 'demo')]: {
        packageName: 'demo',
        projectionPath: path.join(geminiRoot, 'demo'),
        ide: 'gemini',
        surface: 'gemini-cli',
        expectedLinkTarget: physical,
        topologyHash: hashDeviceTopologyNode(path.join(geminiRoot, 'demo')),
        source: root,
      },
    } });

    const copies = result.packages.get('demo');
    expect(copies).toHaveLength(1);
    expect(copies![0].directory).toBe(fs.realpathSync(physical));
    expect(new Set(copies![0].files.map((file) => file.relativePath))).toEqual(new Set([
      path.join('assets', 'icon.bin'),
      'SKILL.md',
    ]));
    expect(copies![0].projections).toEqual([
      expect.objectContaining({
        ide: 'codex',
        surface: 'codex',
        projectionPath: physical,
        ownership: 'physical',
      }),
      expect.objectContaining({
        ide: 'claude-code',
        surface: 'claude-code',
        projectionPath: path.join(claudeRoot, 'demo'),
        ownership: 'managed',
      }),
      expect.objectContaining({
        ide: 'gemini',
        surface: 'gemini-cli',
        projectionPath: path.join(geminiRoot, 'demo'),
        ownership: 'managed',
      }),
    ]);
  });

  it('does not grant managed ownership to external aliases', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mcv-skills-external-')); roots.push(root);
    const storeRoot = path.join(root, 'agents', 'skills');
    const claudeRoot = path.join(root, 'claude', 'skills');
    const externalPackage = path.join(root, 'elsewhere', 'demo');
    fs.mkdirSync(storeRoot, { recursive: true });
    fs.mkdirSync(claudeRoot, { recursive: true });
    fs.mkdirSync(externalPackage, { recursive: true });
    fs.writeFileSync(path.join(externalPackage, 'SKILL.md'), '---\nname: demo\n---\n# External\n');
    fs.symlinkSync(
      externalPackage,
      path.join(claudeRoot, 'demo'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );

    const result = collectSkills([
      { ide: 'codex', surface: 'codex', root: storeRoot },
      { ide: 'claude-code', surface: 'claude-code', root: claudeRoot },
    ]);

    const copies = result.packages.get('demo');
    expect(copies).toHaveLength(1);
    expect(copies![0].projections).toEqual([
      expect.objectContaining({
        surface: 'claude-code',
        projectionPath: path.join(claudeRoot, 'demo'),
        ownership: 'external',
      }),
    ]);
  });

  it('does not trust a stale managed projection record after the link is retargeted', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mcv-skills-stale-record-')); roots.push(root);
    const storePackage = path.join(root, 'agents', 'skills', 'demo');
    const externalPackage = path.join(root, 'external', 'demo');
    const claudeRoot = path.join(root, 'claude', 'skills');
    const projectionPath = path.join(claudeRoot, 'demo');
    fs.mkdirSync(storePackage, { recursive: true });
    fs.mkdirSync(externalPackage, { recursive: true });
    fs.mkdirSync(claudeRoot, { recursive: true });
    fs.writeFileSync(path.join(storePackage, 'SKILL.md'), '---\nname: demo\n---\n# Store\n');
    fs.writeFileSync(path.join(externalPackage, 'SKILL.md'), '---\nname: demo\n---\n# External\n');
    fs.symlinkSync(
      externalPackage,
      projectionPath,
      process.platform === 'win32' ? 'junction' : 'dir',
    );

    const result = collectSkills([
      { ide: 'claude-code', surface: 'claude-code', root: claudeRoot },
    ], { managedProjections: {
      [projectionPath]: {
        packageName: 'demo',
        projectionPath,
        ide: 'claude-code',
        surface: 'claude-code',
        expectedLinkTarget: storePackage,
        topologyHash: hashDeviceTopologyNode(projectionPath),
        source: root,
      },
    } });

    expect(result.packages.get('demo')?.[0].projections).toEqual([
      expect.objectContaining({ ownership: 'external' }),
    ]);
  });
});
