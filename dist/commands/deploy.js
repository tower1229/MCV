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
exports.deployConfigurations = deployConfigurations;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const promises_1 = require("readline/promises");
const yaml = __importStar(require("yaml"));
const claude_code_1 = require("../adapters/claude-code");
const files_1 = require("../utils/files");
const objects_1 = require("../utils/objects");
const state_1 = require("../utils/state");
const variables_1 = require("../utils/variables");
async function deployConfigurations(context, dependencies = {}) {
    const repositoryPath = resolveRepositoryPath();
    const manifest = readManifest(repositoryPath);
    if (manifest.targets?.claudeCode?.enabled === false) {
        console.log('Claude Code deploy is disabled in mcv.yaml.');
        return;
    }
    const variables = resolveManifestVariables(manifest.variables, context, repositoryPath);
    const adapter = new claude_code_1.ClaudeCodeAdapter();
    const operation = await adapter.deploy(repositoryPath, {
        ...context,
        variables,
    });
    const plan = buildDeployPlan(operation.files);
    if (plan.length === 0) {
        recordDeploymentBaseline(operation.files);
        console.log('Claude Code configuration is already in sync.');
        return;
    }
    console.log('Deploy preview:');
    for (const file of plan) {
        console.log(`[${file.change}] ${file.targetPath}`);
    }
    const confirmed = await (dependencies.confirmDeploy ?? confirmInTerminal)();
    if (!confirmed) {
        console.log('Deploy cancelled; local configuration was not changed.');
        return;
    }
    backupModifiedFiles(plan);
    for (const file of plan) {
        operation.write(file);
    }
    recordDeploymentBaseline(operation.files);
    console.log(`Deployed ${plan.length} file(s) from ${repositoryPath}.`);
}
function recordDeploymentBaseline(files) {
    const state = (0, state_1.readState)();
    state.baselineSnapshot = {
        recordedAt: new Date().toISOString(),
        files: Object.fromEntries(files
            .filter((file) => fs.existsSync(file.targetPath))
            .map((file) => [
            file.targetPath,
            (0, files_1.hashFile)(file.targetPath),
        ])),
    };
    (0, state_1.writeState)(state);
}
function backupModifiedFiles(plan) {
    const modifiedFiles = plan.filter((file) => file.change === 'modify');
    if (modifiedFiles.length === 0)
        return;
    const backupRoot = path.join(path.dirname((0, state_1.getStateFilePath)()), 'backups');
    fs.mkdirSync(backupRoot, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupDirectory = fs.mkdtempSync(path.join(backupRoot, `${timestamp}-`));
    const filesDirectory = path.join(backupDirectory, 'files');
    fs.mkdirSync(filesDirectory);
    const files = modifiedFiles.map((file, index) => {
        const backupPath = path.join('files', `${index}-${path.basename(file.targetPath)}`);
        fs.copyFileSync(file.targetPath, path.join(backupDirectory, backupPath));
        return { originalPath: file.targetPath, backupPath };
    });
    (0, files_1.atomicWriteTextFile)(path.join(backupDirectory, 'manifest.json'), `${JSON.stringify({ createdAt: new Date().toISOString(), files }, null, 2)}\n`);
}
function buildDeployPlan(files) {
    return files.flatMap((file) => {
        const existingContent = fs.existsSync(file.targetPath)
            ? fs.readFileSync(file.targetPath)
            : undefined;
        const desiredContent = Buffer.isBuffer(file.content)
            ? file.content
            : Buffer.from(file.content);
        if (existingContent?.equals(desiredContent))
            return [];
        return [{
                ...file,
                change: existingContent === undefined ? 'add' : 'modify',
            }];
    });
}
function resolveManifestVariables(declarations, context, repositoryPath) {
    const platform = context.platform ?? process.platform;
    const platformKey = platform === 'win32'
        ? 'windows'
        : platform === 'darwin'
            ? 'macos'
            : 'linux';
    const definitions = {};
    for (const [name, declaration] of Object.entries(declarations ?? {})) {
        const value = typeof declaration === 'string'
            ? declaration
            : (0, objects_1.isRecord)(declaration) && typeof declaration[platformKey] === 'string'
                ? declaration[platformKey]
                : undefined;
        if (value !== undefined) {
            definitions[name] = value;
        }
    }
    return (0, variables_1.resolveVariableDefinitions)(definitions, {
        ...context.variables,
        HOME: context.homeDir,
        MCV_REPO: repositoryPath,
    }, platform);
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
async function confirmInTerminal() {
    const prompt = (0, promises_1.createInterface)({ input: process.stdin, output: process.stdout });
    try {
        const answer = await prompt.question('Write these changes to this device? [y/N] ');
        return /^(y|yes)$/i.test(answer.trim());
    }
    finally {
        prompt.close();
    }
}
