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
exports.hasExecutable = hasExecutable;
exports.readCanonicalSource = readCanonicalSource;
exports.readDeployTarget = readDeployTarget;
exports.repositoryFileForPlatform = repositoryFileForPlatform;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const yaml = __importStar(require("yaml"));
const variables_1 = require("../utils/variables");
function hasExecutable(executable, context) {
    const platform = context.platform ?? process.platform;
    const pathEnv = context.pathEnv ?? process.env.PATH ?? '';
    const delimiter = platform === 'win32' ? ';' : ':';
    const extensions = platform === 'win32'
        ? (context.pathExt ?? process.env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD')
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
function readCanonicalSource(repositoryPath, context) {
    const commonRoot = path.join(repositoryPath, 'common');
    const platformDirectory = (context.platform ?? process.platform) === 'win32' ? 'windows' : 'macos';
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
        source.mcp = (0, variables_1.resolvePortableValue)(yaml.parse(fs.readFileSync(mcpPath, 'utf8')), context.variables ?? {}, context.platform ?? process.platform);
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
function readDeployTarget(targetPath) {
    if (!fs.existsSync(targetPath))
        return undefined;
    return { targetPath, content: fs.readFileSync(targetPath) };
}
function repositoryFileForPlatform(repositoryPath, relativePath, context) {
    const platformDirectory = (context.platform ?? process.platform) === 'win32' ? 'windows' : 'macos';
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
