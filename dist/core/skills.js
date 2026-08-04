import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { hashDeviceTopologyNode } from './canonical-skill-device-layout.js';
export function getSkillSources(context, enabled) {
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
export function collectSkills(sources, options = {}) {
    const packages = new Map();
    const warnings = [];
    let excludedFileCount = 0;
    for (const source of sources) {
        if (!fs.existsSync(source.root))
            continue;
        for (const entry of fs.readdirSync(source.root, { withFileTypes: true })) {
            if (entry.name === '.system')
                continue;
            const projectionPath = path.join(source.root, entry.name);
            const isLink = entry.isSymbolicLink();
            if (!isLink && !entry.isDirectory())
                continue;
            let physicalDirectory;
            try {
                physicalDirectory = fs.realpathSync(projectionPath);
            }
            catch {
                warnings.push(`Skipped Skill projection ${projectionPath}: unresolved link target.`);
                continue;
            }
            const physicalStat = fs.statSync(physicalDirectory);
            if (!physicalStat.isDirectory())
                continue;
            if (!fs.existsSync(path.join(physicalDirectory, 'SKILL.md')))
                continue;
            const files = [];
            const packageWarnings = [];
            walkSkill(physicalDirectory, physicalDirectory, files, packageWarnings, () => {
                excludedFileCount += 1;
            });
            if (packageWarnings.some((warning) => warning.startsWith('Blocked Skill'))) {
                warnings.push(...packageWarnings);
                continue;
            }
            if (!files.some((file) => file.relativePath === 'SKILL.md'))
                continue;
            const skillText = files.find((file) => file.relativePath === 'SKILL.md').content.toString('utf8');
            const declaredName = skillText.match(/^---\s*[\r\n]+[\s\S]*?^name:\s*["']?([^"'\r\n]+)["']?\s*$[\s\S]*?^---\s*$/m)?.[1]?.trim();
            if (declaredName && declaredName !== entry.name) {
                warnings.push(`Skipped Skill ${projectionPath}: frontmatter name "${declaredName}" does not match directory name "${entry.name}".`);
                excludedFileCount += files.length;
                continue;
            }
            const hash = crypto.createHash('sha256');
            for (const file of files.sort((a, b) => a.relativePath.localeCompare(b.relativePath))) {
                hash.update(file.relativePath.replace(/\\/g, '/'));
                hash.update(file.content);
            }
            const ownership = classifyProjectionOwnership(projectionPath, physicalDirectory, isLink, options.managedProjections);
            const projection = {
                ide: source.ide,
                surface: source.surface,
                projectionPath,
                ownership,
            };
            const existing = (packages.get(entry.name) ?? [])
                .find((skill) => path.resolve(skill.directory) === path.resolve(physicalDirectory));
            if (existing) {
                existing.projections.push(projection);
                continue;
            }
            const skill = {
                name: entry.name,
                source,
                directory: physicalDirectory,
                hash: hash.digest('hex'),
                modifiedAtMs: Math.max(...files.map((file) => fs.statSync(path.join(physicalDirectory, file.relativePath)).mtimeMs)),
                files,
                warnings: packageWarnings,
                projections: [projection],
            };
            packages.set(entry.name, [...(packages.get(entry.name) ?? []), skill]);
            warnings.push(...packageWarnings);
        }
    }
    return { packages, warnings, excludedFileCount };
}
export function skillPackageToCaptureFiles(skill) {
    return skill.files.map((file) => ({
        sourcePath: path.join(skill.directory, file.relativePath),
        repositoryPath: path.posix.join('common', 'skills', skill.name, file.relativePath.replace(/\\/g, '/')),
        content: file.content,
        ownership: 'managed',
    }));
}
function classifyProjectionOwnership(projectionPath, physicalDirectory, isLink, managedProjections) {
    if (!isLink)
        return 'physical';
    const resolvedProjectionPath = path.resolve(projectionPath);
    const managed = managedProjections?.[projectionPath]
        ?? managedProjections?.[resolvedProjectionPath];
    if (!managed || path.resolve(managed.projectionPath) !== resolvedProjectionPath)
        return 'external';
    let expectedPhysical;
    try {
        expectedPhysical = fs.realpathSync(managed.expectedLinkTarget);
    }
    catch {
        return 'external';
    }
    if (path.resolve(expectedPhysical) !== path.resolve(physicalDirectory))
        return 'external';
    return hashDeviceTopologyNode(projectionPath) === managed.topologyHash ? 'managed' : 'external';
}
function walkSkill(root, directory, files, warnings, excluded) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const current = path.join(directory, entry.name);
        if (entry.isSymbolicLink()) {
            warnings.push(`Blocked Skill: symbolic link inside portable Skill package: ${current}`);
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
        const content = fs.readFileSync(current);
        files.push({ relativePath: path.relative(root, current), content });
    }
}
