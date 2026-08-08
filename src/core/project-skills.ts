import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { hashSkillPackageContent } from './managed-skill-layout.js';
import type { ManagedReceipt } from './managed-receipt.js';
import { assertPathContainedInProjectRoot } from './project-target.js';

export type ProjectSkillRelativeRoot = '.agents/skills' | '.claude/skills';

export type ProjectSkillPackageStatus =
  | 'absent'
  | 'identical'
  | 'update'
  | 'conflict';

export interface ProjectSkillPackageInput {
  id: string;
  name: string;
  files: Array<{ relativePath: string; content: Buffer }>;
}

export interface ProjectSkillPackageProjection {
  targetPath: string;
  relativePackagePath: string;
  receiptKey: string;
  assetId: string;
  packageHash: string;
  status: ProjectSkillPackageStatus;
  files: Array<{ relativePath: string; content: Buffer }>;
}

export interface ProjectSkillDestinationTargets {
  codex: boolean;
  claudeCode: boolean;
  geminiCli: boolean;
}

export function projectSkillDestinationRoots(
  targets: ProjectSkillDestinationTargets,
): ProjectSkillRelativeRoot[] {
  const roots: ProjectSkillRelativeRoot[] = [];
  if (targets.codex || targets.geminiCli) roots.push('.agents/skills');
  if (targets.claudeCode) roots.push('.claude/skills');
  return roots;
}

export function hashProjectSkillPackageFiles(
  files: Array<{ relativePath: string; content: Buffer }>,
): string {
  const hash = crypto.createHash('sha256');
  for (const file of [...files].sort((left, right) =>
    normalizeSkillRelativePath(left.relativePath)
      .localeCompare(normalizeSkillRelativePath(right.relativePath)))) {
    hash.update(normalizeSkillRelativePath(file.relativePath));
    hash.update(file.content);
  }
  return hash.digest('hex');
}

export function projectSkillPackage(
  targetRoot: string,
  relativeRoot: ProjectSkillRelativeRoot,
  skill: ProjectSkillPackageInput,
  receipt: ManagedReceipt | undefined,
): ProjectSkillPackageProjection {
  const relativePackagePath = `${relativeRoot}/${skill.name}`;
  const targetPath = path.join(targetRoot, ...relativePackagePath.split('/'));
  assertPathContainedInProjectRoot(targetRoot, targetPath);

  const normalizedFiles = skill.files.map((file) => ({
    relativePath: normalizeSkillRelativePath(file.relativePath),
    content: file.content,
  }));
  const packageHash = hashProjectSkillPackageFiles(normalizedFiles);
  const base = {
    targetPath,
    relativePackagePath,
    receiptKey: relativePackagePath,
    assetId: skill.id,
    packageHash,
    files: normalizedFiles,
  };

  if (!fs.existsSync(targetPath)) {
    return { ...base, status: 'absent' };
  }

  let localStat: fs.Stats;
  try {
    localStat = fs.lstatSync(targetPath);
  } catch {
    return { ...base, status: 'conflict' };
  }
  if (localStat.isSymbolicLink() || !localStat.isDirectory()) {
    return { ...base, status: 'conflict' };
  }

  const localHash = hashSkillPackageContent(targetPath);
  if (localHash === packageHash) {
    return { ...base, status: 'identical' };
  }

  const recorded = receipt?.managed[relativePackagePath];
  if (recorded !== undefined
    && recorded.assetId === skill.id
    && recorded.hash === localHash) {
    return { ...base, status: 'update' };
  }

  return { ...base, status: 'conflict' };
}

function normalizeSkillRelativePath(relativePath: string): string {
  return relativePath.replace(/\\/g, '/');
}
