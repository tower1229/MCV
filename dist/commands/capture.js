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
exports.captureConfigurations = captureConfigurations;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const promises_1 = require("readline/promises");
const yaml = __importStar(require("yaml"));
const claude_code_1 = require("../adapters/claude-code");
const objects_1 = require("../utils/objects");
const state_1 = require("../utils/state");
async function captureConfigurations(context, dependencies = {}) {
    const repositoryPath = resolveRepositoryPath();
    const manifest = readManifest(repositoryPath);
    if (manifest.targets?.claudeCode?.enabled === false) {
        console.log('Claude Code capture is disabled in mcv.yaml.');
        return;
    }
    const adapter = new claude_code_1.ClaudeCodeAdapter();
    const captureContext = {
        ...context,
        variables: resolveManifestVariables(manifest.variables, context),
    };
    const files = await adapter.discoverFiles(captureContext);
    const result = await adapter.capture(files, captureContext);
    const plan = buildCapturePlan(repositoryPath, result.files);
    for (const warning of result.warnings) {
        console.log(`Warning: ${warning}`);
    }
    if (plan.length === 0) {
        console.log('No Claude Code configuration changes to capture.');
        return;
    }
    console.log('Capture preview (sanitized and parameterized):');
    for (const file of plan) {
        console.log(`[${file.change}][${file.ownership}] ${file.repositoryPath}`);
        console.log(file.content.trimEnd());
    }
    console.log(`Summary: ${plan.length} file(s), ${result.summary.sensitiveFieldCount} sensitive field(s) replaced, ${result.summary.parameterizedPathCount} path(s) parameterized, ${result.summary.excludedFileCount} sensitive file(s) excluded.`);
    const confirmed = await (dependencies.confirmCapture ?? confirmInTerminal)();
    if (!confirmed) {
        console.log('Capture cancelled; repository was not changed.');
        return;
    }
    for (const file of plan) {
        fs.mkdirSync(path.dirname(file.destinationPath), { recursive: true });
        fs.writeFileSync(file.destinationPath, file.content, 'utf8');
    }
    console.log(`Captured ${plan.length} file(s) into ${repositoryPath}.`);
}
function resolveRepositoryPath() {
    const currentDirectory = process.cwd();
    if (fs.existsSync(path.join(currentDirectory, 'mcv.yaml'))) {
        return currentDirectory;
    }
    const repositoryPath = (0, state_1.readState)().repositoryPath;
    if (repositoryPath && fs.existsSync(path.join(repositoryPath, 'mcv.yaml'))) {
        return repositoryPath;
    }
    throw new Error('No bound MCV repository found. Run `mcv init` first.');
}
function readManifest(repositoryPath) {
    const manifestPath = path.join(repositoryPath, 'mcv.yaml');
    const parsed = yaml.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (!(0, objects_1.isRecord)(parsed)) {
        throw new Error(`${manifestPath} must contain a YAML object.`);
    }
    return parsed;
}
function buildCapturePlan(repositoryPath, files) {
    return files.flatMap((file) => {
        const destinationPath = path.join(repositoryPath, ...file.repositoryPath.split('/'));
        const existingContent = fs.existsSync(destinationPath)
            ? fs.readFileSync(destinationPath, 'utf8')
            : undefined;
        const content = mergeWithRepository(file, existingContent);
        if (existingContent === content)
            return [];
        return [{
                ...file,
                content,
                change: existingContent === undefined ? 'add' : 'modify',
                destinationPath,
            }];
    });
}
function mergeWithRepository(file, existingContent) {
    if (existingContent === undefined)
        return file.content;
    if (file.ownership === 'native' && file.repositoryPath.endsWith('.json')) {
        const existing = JSON.parse(existingContent);
        const captured = JSON.parse(file.content);
        if (!(0, objects_1.isRecord)(existing) || !(0, objects_1.isRecord)(captured)) {
            throw new Error(`${file.repositoryPath} must contain a JSON object.`);
        }
        return `${JSON.stringify((0, objects_1.mergeRecords)(existing, captured), null, 2)}\n`;
    }
    if (file.repositoryPath === 'common/mcp.yaml') {
        const existing = yaml.parse(existingContent);
        const captured = yaml.parse(file.content);
        if (!(0, objects_1.isRecord)(existing) || !(0, objects_1.isRecord)(captured)) {
            throw new Error('common/mcp.yaml must contain a YAML object.');
        }
        return yaml.stringify((0, objects_1.mergeRecords)(existing, captured));
    }
    return file.content;
}
function resolveManifestVariables(variables, context) {
    const platform = context.platform ?? process.platform;
    const platformKey = platform === 'win32'
        ? 'windows'
        : platform === 'darwin'
            ? 'macos'
            : 'linux';
    const resolved = {};
    for (const [name, declaration] of Object.entries(variables ?? {})) {
        const value = typeof declaration === 'string'
            ? declaration
            : (0, objects_1.isRecord)(declaration) && typeof declaration[platformKey] === 'string'
                ? declaration[platformKey]
                : undefined;
        if (value) {
            resolved[name] = value.replace(/\$\{HOME\}/g, context.homeDir);
        }
    }
    return resolved;
}
async function confirmInTerminal() {
    const prompt = (0, promises_1.createInterface)({ input: process.stdin, output: process.stdout });
    try {
        const answer = await prompt.question('Write these changes to the repository? [y/N] ');
        return /^(y|yes)$/i.test(answer.trim());
    }
    finally {
        prompt.close();
    }
}
