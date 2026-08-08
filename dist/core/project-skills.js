import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { hashSkillPackageContent } from './managed-skill-layout.js';
import { assertPathContainedInProjectRoot } from './project-target.js';
export function projectSkillDestinationRoots(targets) {
    const roots = [];
    if (targets.codex || targets.geminiCli)
        roots.push('.agents/skills');
    if (targets.claudeCode)
        roots.push('.claude/skills');
    return roots;
}
export function hashProjectSkillPackageFiles(files) {
    const hash = crypto.createHash('sha256');
    for (const file of [...files].sort((left, right) => normalizeSkillRelativePath(left.relativePath)
        .localeCompare(normalizeSkillRelativePath(right.relativePath)))) {
        hash.update(normalizeSkillRelativePath(file.relativePath));
        hash.update(file.content);
    }
    return hash.digest('hex');
}
export function projectSkillPackage(targetRoot, relativeRoot, skill, receipt) {
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
    let localStat;
    try {
        localStat = fs.lstatSync(targetPath);
    }
    catch {
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
function normalizeSkillRelativePath(relativePath) {
    return relativePath.replace(/\\/g, '/');
}
