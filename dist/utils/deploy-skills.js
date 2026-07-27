import * as fs from 'fs';
import * as path from 'path';
import { findSymbolicLinkAncestor } from './files.js';
export function findLegacyCodexSkillDuplicates(context, deployFiles, codexEnabled) {
    if (!codexEnabled)
        return { names: [], files: [] };
    const officialRoot = path.resolve(context.homeDir, '.agents', 'skills');
    const codexHome = context.env.CODEX_HOME || path.join(context.homeDir, '.codex');
    const legacyRoot = path.resolve(codexHome, 'skills');
    if (samePath(officialRoot, legacyRoot, context.platform) || findSymbolicLinkAncestor(legacyRoot)) {
        return { names: [], files: [] };
    }
    const desiredBySkill = new Map();
    for (const file of deployFiles) {
        const relativePath = path.relative(officialRoot, path.resolve(file.targetPath));
        if (!relativePath || relativePath.startsWith(`..${path.sep}`) || path.isAbsolute(relativePath))
            continue;
        const [skillName, ...rest] = relativePath.split(path.sep);
        if (!skillName || rest.length === 0)
            continue;
        const skillFiles = desiredBySkill.get(skillName) ?? new Map();
        skillFiles.set(rest.join('/'), Buffer.isBuffer(file.content) ? file.content : Buffer.from(file.content));
        desiredBySkill.set(skillName, skillFiles);
    }
    const names = [];
    const files = [];
    for (const [skillName, desiredFiles] of desiredBySkill) {
        const legacySkillRoot = path.join(legacyRoot, skillName);
        const legacyFiles = collectRegularFiles(legacySkillRoot);
        if (!legacyFiles || legacyFiles.size !== desiredFiles.size)
            continue;
        const exactDuplicate = [...desiredFiles].every(([relativePath, content]) => {
            const legacyPath = legacyFiles.get(relativePath);
            return legacyPath !== undefined && fs.readFileSync(legacyPath).equals(content);
        });
        if (!exactDuplicate)
            continue;
        names.push(skillName);
        files.push(...legacyFiles.values());
    }
    return { names: names.sort(), files: files.sort() };
}
function collectRegularFiles(root) {
    if (!fs.existsSync(root) || fs.lstatSync(root).isSymbolicLink())
        return undefined;
    const files = new Map();
    const visit = (directory) => {
        for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
            if (entry.isSymbolicLink())
                return false;
            const current = path.join(directory, entry.name);
            if (entry.isDirectory()) {
                if (!visit(current))
                    return false;
            }
            else if (entry.isFile()) {
                files.set(path.relative(root, current).replace(/\\/g, '/'), current);
            }
        }
        return true;
    };
    return visit(root) ? files : undefined;
}
function samePath(left, right, platform) {
    return platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right;
}
