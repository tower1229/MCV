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
exports.getSkillSources = getSkillSources;
exports.collectSkills = collectSkills;
exports.skillPackageToCaptureFiles = skillPackageToCaptureFiles;
const crypto = __importStar(require("crypto"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const sanitize_1 = require("../utils/sanitize");
function getSkillSources(context, enabled) {
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
function collectSkills(sources) {
    const packages = new Map();
    const warnings = [];
    let excludedFileCount = 0;
    for (const source of sources) {
        if (!fs.existsSync(source.root))
            continue;
        for (const entry of fs.readdirSync(source.root, { withFileTypes: true })) {
            if (!entry.isDirectory() || entry.name === '.system')
                continue;
            const directory = path.join(source.root, entry.name);
            if (!fs.existsSync(path.join(directory, 'SKILL.md')))
                continue;
            const files = [];
            const packageWarnings = [];
            walkSkill(directory, directory, files, packageWarnings, () => { excludedFileCount += 1; });
            if (packageWarnings.some((warning) => warning.startsWith('Blocked Skill'))) {
                warnings.push(...packageWarnings);
                continue;
            }
            if (!files.some((file) => file.relativePath === 'SKILL.md'))
                continue;
            const skillText = files.find((file) => file.relativePath === 'SKILL.md').content.toString('utf8');
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
            const skill = {
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
function skillPackageToCaptureFiles(skill) {
    return skill.files.map((file) => ({
        sourcePath: path.join(skill.directory, file.relativePath),
        repositoryPath: path.posix.join('common', 'skills', skill.name, file.relativePath.replace(/\\/g, '/')),
        content: file.content,
        ownership: 'managed',
    }));
}
function walkSkill(root, directory, files, warnings, excluded) {
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
        if (!entry.isFile())
            continue;
        if ((0, sanitize_1.isSensitiveFile)(current)) {
            warnings.push(`Excluded sensitive Skill file: ${current}`);
            excluded();
            continue;
        }
        const content = fs.readFileSync(current);
        if (isText(content)) {
            const findings = (0, sanitize_1.scanTextForSecrets)(content.toString('utf8'));
            if (findings.length > 0) {
                warnings.push(`Blocked Skill file with suspected plaintext secret: ${current} (${findings.join(', ')})`);
                excluded();
                continue;
            }
        }
        files.push({ relativePath: path.relative(root, current), content });
    }
}
function isText(content) {
    return !content.subarray(0, Math.min(content.length, 8_192)).includes(0);
}
