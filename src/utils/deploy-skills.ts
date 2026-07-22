import * as fs from 'fs';
import * as path from 'path';
import type { DeployFile, DeviceContext } from '../adapters/types';
import { findSymbolicLinkAncestor } from './files';

export interface LegacySkillDuplicates {
  names: string[];
  files: string[];
}

export function findLegacyCodexSkillDuplicates(
  context: DeviceContext,
  deployFiles: DeployFile[],
  codexEnabled: boolean,
): LegacySkillDuplicates {
  if (!codexEnabled) return { names: [], files: [] };
  const officialRoot = path.resolve(context.homeDir, '.agents', 'skills');
  const codexHome = context.env.CODEX_HOME || path.join(context.homeDir, '.codex');
  const legacyRoot = path.resolve(codexHome, 'skills');
  if (samePath(officialRoot, legacyRoot, context.platform) || findSymbolicLinkAncestor(legacyRoot)) {
    return { names: [], files: [] };
  }

  const desiredBySkill = new Map<string, Map<string, Buffer>>();
  for (const file of deployFiles) {
    const relativePath = path.relative(officialRoot, path.resolve(file.targetPath));
    if (!relativePath || relativePath.startsWith(`..${path.sep}`) || path.isAbsolute(relativePath)) continue;
    const [skillName, ...rest] = relativePath.split(path.sep);
    if (!skillName || rest.length === 0) continue;
    const skillFiles = desiredBySkill.get(skillName) ?? new Map<string, Buffer>();
    skillFiles.set(rest.join('/'), Buffer.isBuffer(file.content) ? file.content : Buffer.from(file.content));
    desiredBySkill.set(skillName, skillFiles);
  }

  const names: string[] = [];
  const files: string[] = [];
  for (const [skillName, desiredFiles] of desiredBySkill) {
    const legacySkillRoot = path.join(legacyRoot, skillName);
    const legacyFiles = collectRegularFiles(legacySkillRoot);
    if (!legacyFiles || legacyFiles.size !== desiredFiles.size) continue;
    const exactDuplicate = [...desiredFiles].every(([relativePath, content]) => {
      const legacyPath = legacyFiles.get(relativePath);
      return legacyPath !== undefined && fs.readFileSync(legacyPath).equals(content);
    });
    if (!exactDuplicate) continue;
    names.push(skillName);
    files.push(...legacyFiles.values());
  }
  return { names: names.sort(), files: files.sort() };
}

function collectRegularFiles(root: string): Map<string, string> | undefined {
  if (!fs.existsSync(root) || fs.lstatSync(root).isSymbolicLink()) return undefined;
  const files = new Map<string, string>();
  const visit = (directory: string): boolean => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) return false;
      const current = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!visit(current)) return false;
      } else if (entry.isFile()) {
        files.set(path.relative(root, current).replace(/\\/g, '/'), current);
      }
    }
    return true;
  };
  return visit(root) ? files : undefined;
}

function samePath(left: string, right: string, platform: NodeJS.Platform | undefined): boolean {
  return platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right;
}
