import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'yaml';
import { resolvePortableValue } from '../utils/variables.js';
export function hasExecutable(executable, context) {
    const platform = context.platform;
    const pathEnv = context.pathEnv ?? context.env.PATH ?? '';
    const delimiter = platform === 'win32' ? ';' : ':';
    const extensions = platform === 'win32'
        ? (context.pathExt ?? context.env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD')
            .split(';')
            .filter(Boolean)
            .map((extension) => extension.toLowerCase())
        : [''];
    return pathEnv.split(delimiter).filter(Boolean).some((directory) => extensions.some((extension) => {
        const candidate = path.join(directory, `${executable}${extension}`);
        try {
            if (!fs.statSync(candidate).isFile())
                return false;
            if (platform !== 'win32')
                fs.accessSync(candidate, fs.constants.X_OK);
            return true;
        }
        catch {
            return false;
        }
    }));
}
export function readCanonicalSource(repositoryPath, context) {
    const commonRoot = path.join(repositoryPath, 'common');
    const platformDirectory = context.platform === 'win32' ? 'windows' : 'macos';
    const overrideRoot = path.join(repositoryPath, 'overrides', platformDirectory, 'common');
    const selectOverride = (name) => {
        const override = path.join(overrideRoot, name);
        return fs.existsSync(override) ? override : path.join(commonRoot, name);
    };
    const rulesPath = selectOverride('AGENTS.md');
    const skillsRoot = path.join(commonRoot, 'skills');
    const mcpPath = selectOverride('mcp.yaml');
    const source = {
        skills: fs.existsSync(skillsRoot)
            ? readFilesRecursively(skillsRoot, skillsRoot)
            : [],
    };
    if (fs.existsSync(rulesPath))
        source.rules = fs.readFileSync(rulesPath, 'utf8');
    if (fs.existsSync(mcpPath)) {
        source.mcp = resolvePortableValue(yaml.parse(fs.readFileSync(mcpPath, 'utf8')), context.variables ?? {}, context.platform);
    }
    const overridePaths = {
        codex: 'ide/codex/mcp-overrides.yaml',
        'claude-code': 'ide/claude-code/mcp-overrides.yaml',
        'gemini-cli': 'ide/gemini/gemini-cli/mcp-overrides.yaml',
        antigravity: 'ide/gemini/antigravity/mcp-overrides.yaml',
    };
    for (const [surface, relativePath] of Object.entries(overridePaths)) {
        const overridePath = repositoryFileForPlatform(repositoryPath, relativePath, context);
        if (!fs.existsSync(overridePath))
            continue;
        const parsed = yaml.parse(fs.readFileSync(overridePath, 'utf8'));
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            source.mcpOverrides ??= {};
            source.mcpOverrides[surface] = parsed;
        }
    }
    return source;
}
export function readDeployTarget(targetPath) {
    if (!fs.existsSync(targetPath))
        return undefined;
    return { targetPath, content: fs.readFileSync(targetPath) };
}
export function repositoryFileForPlatform(repositoryPath, relativePath, context) {
    const platformDirectory = context.platform === 'win32' ? 'windows' : 'macos';
    const override = path.join(repositoryPath, 'overrides', platformDirectory, ...relativePath.split('/'));
    return fs.existsSync(override) ? override : path.join(repositoryPath, ...relativePath.split('/'));
}
function readFilesRecursively(sourceRoot, currentDirectory) {
    return fs.readdirSync(currentDirectory, { withFileTypes: true }).flatMap((entry) => {
        const sourcePath = path.join(currentDirectory, entry.name);
        if (entry.isDirectory())
            return readFilesRecursively(sourceRoot, sourcePath);
        if (!entry.isFile())
            return [];
        return [{
                relativePath: path.relative(sourceRoot, sourcePath),
                content: fs.readFileSync(sourcePath),
            }];
    });
}
