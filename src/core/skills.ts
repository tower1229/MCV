import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import type { CaptureFile, DeviceContext } from '../adapters/types';
import { isSensitiveFile, scanTextForSecrets } from '../utils/sanitize';

export interface SkillSource {
  ide: string;
  surface: string;
  root: string;
  legacy?: boolean;
}

export interface SkillPackage {
  name: string;
  source: SkillSource;
  directory: string;
  hash: string;
  files: Array<{ relativePath: string; content: Buffer }>;
  warnings: string[];
}

export interface SkillCollection {
  packages: Map<string, SkillPackage[]>;
  warnings: string[];
  excludedFileCount: number;
}

export function getSkillSources(
  context: DeviceContext,
  enabled: { codex: boolean; claudeCode: boolean; gemini: boolean },
): SkillSource[] {
  const env = context.env;
  const codexHome = env.CODEX_HOME || path.join(context.homeDir, '.codex');
  const claudeHome = env.CLAUDE_CONFIG_DIR || path.join(context.homeDir, '.claude');
  const geminiHome = path.join(context.homeDir, '.gemini');
  return [
    ...(enabled.codex ? [
      { ide: 'codex', surface: 'codex', root: path.join(context.homeDir, '.agents', 'skills') },
      { ide: 'codex', surface: 'codex-legacy', root: path.join(codexHome, 'skills'), legacy: true },
    ] : []),
    ...(enabled.claudeCode ? [
      { ide: 'claude-code', surface: 'claude-code', root: path.join(claudeHome, 'skills') },
    ] : []),
    ...(enabled.gemini ? [
      { ide: 'gemini', surface: 'gemini-cli', root: path.join(geminiHome, 'skills') },
      { ide: 'gemini', surface: 'antigravity', root: path.join(geminiHome, 'config', 'skills') },
    ] : []),
  ];
}

export function collectSkills(sources: SkillSource[]): SkillCollection {
  const packages = new Map<string, SkillPackage[]>();
  const warnings: string[] = [];
  let excludedFileCount = 0;
  for (const source of sources) {
    if (!fs.existsSync(source.root)) continue;
    for (const entry of fs.readdirSync(source.root, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name === '.system') continue;
      const directory = path.join(source.root, entry.name);
      if (!fs.existsSync(path.join(directory, 'SKILL.md'))) continue;
      const files: SkillPackage['files'] = [];
      const packageWarnings: string[] = [];
      walkSkill(directory, directory, files, packageWarnings, () => { excludedFileCount += 1; });
      if (packageWarnings.some((warning) => warning.startsWith('Blocked Skill'))) {
        warnings.push(...packageWarnings);
        continue;
      }
      if (!files.some((file) => file.relativePath === 'SKILL.md')) continue;
      const skillText = files.find((file) => file.relativePath === 'SKILL.md')!.content.toString('utf8');
      const declaredName = skillText.match(/^---\s*[\r\n]+[\s\S]*?^name:\s*["']?([^"'\r\n]+)["']?\s*$[\s\S]*?^---\s*$/m)?.[1]?.trim();
      if (declaredName && declaredName !== entry.name) {
        warnings.push(`Skipped Skill ${directory}: frontmatter name "${declaredName}" does not match directory name "${entry.name}".`);
        excludedFileCount += files.length;
        continue;
      }
      const hash = crypto.createHash('sha256');
      for (const file of files.sort((a, b) => a.relativePath.localeCompare(b.relativePath))) {
        hash.update(file.relativePath.replace(/\\/g, '/'));
        hash.update(file.content);
      }
      const skill: SkillPackage = {
        name: entry.name,
        source,
        directory,
        hash: hash.digest('hex'),
        files,
        warnings: packageWarnings,
      };
      packages.set(entry.name, [...(packages.get(entry.name) ?? []), skill]);
      warnings.push(...packageWarnings);
    }
  }
  return { packages, warnings, excludedFileCount };
}

export function skillPackageToCaptureFiles(skill: SkillPackage): CaptureFile[] {
  return skill.files.map((file) => ({
    sourcePath: path.join(skill.directory, file.relativePath),
    repositoryPath: path.posix.join('common', 'skills', skill.name, file.relativePath.replace(/\\/g, '/')),
    content: file.content,
    ownership: 'managed',
  }));
}

function walkSkill(
  root: string,
  directory: string,
  files: SkillPackage['files'],
  warnings: string[],
  excluded: () => void,
): void {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const current = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      warnings.push(`Skipped symlink outside portable Skill package: ${current}`);
      excluded();
      continue;
    }
    if (entry.isDirectory()) {
      if (/^(node_modules|\.git|cache|logs?|sessions?|disabled-plugins)$/i.test(entry.name)) {
        excluded();
        continue;
      }
      walkSkill(root, current, files, warnings, excluded);
      continue;
    }
    if (!entry.isFile()) continue;
    if (isSensitiveFile(current)) {
      warnings.push(`Excluded sensitive Skill file: ${current}`);
      excluded();
      continue;
    }
    const content = fs.readFileSync(current);
    if (isText(content)) {
      const findings = scanTextForSecrets(content.toString('utf8'));
      if (findings.length > 0) {
        warnings.push(`Blocked Skill file with suspected plaintext secret: ${current} (${findings.join(', ')})`);
        excluded();
        continue;
      }
    }
    files.push({ relativePath: path.relative(root, current), content });
  }
}

function isText(content: Buffer): boolean {
  return !content.subarray(0, Math.min(content.length, 8_192)).includes(0);
}
