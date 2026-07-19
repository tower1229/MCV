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
const adapters_1 = require("../adapters");
const files_1 = require("../utils/files");
const objects_1 = require("../utils/objects");
const state_1 = require("../utils/state");
const variables_1 = require("../utils/variables");
const repository_1 = require("../utils/repository");
async function deployConfigurations(context, dependencies = {}, options = {}) {
    const repositoryPath = (0, repository_1.resolveBoundRepository)();
    const manifest = (0, repository_1.readManifest)(repositoryPath);
    const definitions = (0, adapters_1.createAdapterDefinitions)().filter(({ targetId }) => manifest.targets?.[targetId]?.enabled === true);
    if (definitions.length === 0) {
        console.log('No IDE targets are enabled in mcv.yaml.');
        return;
    }
    const variables = resolveManifestVariables(manifest.variables, context, repositoryPath);
    const operations = await Promise.all(definitions.map(async (definition) => ({
        definition,
        operation: await definition.adapter.deploy(repositoryPath, {
            ...context,
            variables,
        }),
    })));
    const deployFiles = operations.flatMap(({ operation }) => operation.files.map((file) => ({ ...file, write: operation.write })));
    const plan = buildDeployPlan(deployFiles, options.pruneManaged === true ? (0, state_1.readState)().managedInventory : undefined);
    if (options.yes && plan.some((file) => file.change === 'delete'))
        throw new Error('--yes never applies deletions; review and confirm --prune-managed interactively.');
    if (plan.length === 0) {
        recordDeploymentBaseline(deployFiles);
        const subject = definitions.length === 1
            ? `${definitions[0].name} configuration is`
            : 'Configurations are';
        console.log(`${subject} already in sync.`);
        return;
    }
    if (options.json)
        console.log(JSON.stringify({ repositoryPath, changes: plan.map(({ targetPath, change }) => ({ targetPath, change })) }, null, 2));
    else {
        console.log('Deploy preview:');
        for (const file of plan)
            console.log(`[${file.change}] ${file.targetPath}`);
    }
    if (options.dryRun)
        return;
    if (!process.stdin.isTTY && !options.yes && !dependencies.confirmDeploy) {
        throw new Error('Deploy requires an interactive terminal; use --yes only after reviewing --dry-run.');
    }
    const confirmed = options.yes || await (dependencies.confirmDeploy ?? confirmInTerminal)();
    if (!confirmed) {
        console.log('Deploy cancelled; local configuration was not changed.');
        return;
    }
    const backupDirectory = createDeploymentBackup(plan);
    applyDeployTransaction(plan, backupDirectory);
    finalizeDeploymentBackup(backupDirectory, plan);
    recordDeploymentBaseline(deployFiles, repositoryPath);
    console.log(`Deployed ${plan.length} file(s) from ${repositoryPath}.`);
}
function recordDeploymentBaseline(files, repositoryPath) {
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
    state.managedInventory = Object.fromEntries(files
        .filter((file) => fs.existsSync(file.targetPath))
        .map((file) => [file.targetPath, { source: repositoryPath ?? 'repository', hash: (0, files_1.hashFile)(file.targetPath) }]));
    state.lastOperation = { kind: 'deploy', time: new Date().toISOString(), success: true };
    (0, state_1.writeState)(state);
}
function createDeploymentBackup(plan) {
    const backupRoot = path.join(path.dirname((0, state_1.getStateFilePath)()), 'backups');
    fs.mkdirSync(backupRoot, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupDirectory = fs.mkdtempSync(path.join(backupRoot, `${timestamp}-`));
    const filesDirectory = path.join(backupDirectory, 'files');
    fs.mkdirSync(filesDirectory);
    const files = plan.map((file, index) => {
        if (file.change === 'add')
            return { action: 'add', originalPath: file.targetPath };
        const backupPath = path.join('files', `${index}-${path.basename(file.targetPath)}`);
        fs.copyFileSync(file.targetPath, path.join(backupDirectory, backupPath));
        return { action: file.change, originalPath: file.targetPath, backupPath, beforeHash: (0, files_1.hashFile)(file.targetPath) };
    });
    (0, files_1.atomicWriteTextFile)(path.join(backupDirectory, 'manifest.json'), `${JSON.stringify({ createdAt: new Date().toISOString(), files }, null, 2)}\n`);
    return backupDirectory;
}
function finalizeDeploymentBackup(backupDirectory, plan) {
    const manifestPath = path.join(backupDirectory, 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    for (const entry of manifest.files) {
        if (fs.existsSync(entry.originalPath))
            entry.afterHash = (0, files_1.hashFile)(entry.originalPath);
    }
    (0, files_1.atomicWriteTextFile)(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}
function applyDeployTransaction(plan, backupDirectory) {
    const created = [];
    try {
        for (const file of plan) {
            if (file.change === 'add')
                created.push(file.targetPath);
            if (file.change === 'delete')
                fs.rmSync(file.targetPath, { force: true });
            else
                file.write(file);
        }
    }
    catch (error) {
        for (const targetPath of created)
            fs.rmSync(targetPath, { force: true });
        if (backupDirectory) {
            const manifest = JSON.parse(fs.readFileSync(path.join(backupDirectory, 'manifest.json'), 'utf8'));
            for (const file of manifest.files)
                fs.copyFileSync(path.join(backupDirectory, file.backupPath), file.originalPath);
        }
        throw error;
    }
}
function buildDeployPlan(files, managedInventory) {
    const desiredPaths = new Set(files.map((file) => file.targetPath));
    const changes = files.flatMap((file) => {
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
    const deletions = Object.keys(managedInventory ?? {}).flatMap((targetPath) => desiredPaths.has(targetPath) || !fs.existsSync(targetPath) ? [] : [{ targetPath, content: Buffer.alloc(0), change: 'delete' }]);
    return [...changes, ...deletions];
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
