"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.findLegacyCodexSkillDuplicates = findLegacyCodexSkillDuplicates;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const files_1 = require("./files");
function findLegacyCodexSkillDuplicates(context, deployFiles, codexEnabled) {
    if (!codexEnabled)
        return { names: [], files: [] };
    const officialRoot = path.resolve(context.homeDir, '.agents', 'skills');
    const codexHome = context.env.CODEX_HOME || path.join(context.homeDir, '.codex');
    const legacyRoot = path.resolve(codexHome, 'skills');
    if (samePath(officialRoot, legacyRoot, context.platform) || (0, files_1.findSymbolicLinkAncestor)(legacyRoot)) {
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
