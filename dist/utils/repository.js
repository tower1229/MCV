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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CURRENT_SCHEMA_VERSION = void 0;
exports.readManifest = readManifest;
exports.validateManifest = validateManifest;
exports.resolveBoundRepository = resolveBoundRepository;
exports.bindRepository = bindRepository;
exports.unbindRepository = unbindRepository;
exports.migrateRepository = migrateRepository;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const yaml = __importStar(require("yaml"));
const files_1 = require("./files");
const state_1 = require("./state");
const objects_1 = require("./objects");
const mcp_1 = require("../core/mcp");
const _2020_1 = __importDefault(require("ajv/dist/2020"));
exports.CURRENT_SCHEMA_VERSION = 2;
let manifestValidator;
function readManifest(repositoryPath) {
    const manifestPath = path.join(repositoryPath, 'mcv.yaml');
    const raw = yaml.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (!(0, objects_1.isRecord)(raw))
        throw new Error(`${manifestPath} must contain a YAML object.`);
    if (raw.schemaVersion !== exports.CURRENT_SCHEMA_VERSION) {
        throw new Error(`Repository schema ${String(raw.schemaVersion)} requires migration; run \`mcv migrate\`.`);
    }
    validateManifest(raw, manifestPath);
    return raw;
}
function validateManifest(raw, source = 'mcv.yaml') {
    manifestValidator ??= createManifestValidator();
    if (!manifestValidator(raw)) {
        const details = manifestValidator.errors?.map((error) => `${error.instancePath || '/'} ${error.message ?? 'is invalid'}`).join('; ');
        throw new Error(`${source}: schema validation failed: ${details}`);
    }
}
function createManifestValidator() {
    const schemaPath = path.resolve(__dirname, '../../schemas/mcv.schema.json');
    const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
    return new _2020_1.default({ allErrors: true, useDefaults: true, strict: true }).compile(schema);
}
function resolveBoundRepository(context, explicitPath) {
    const state = (0, state_1.readState)(context);
    const current = process.cwd();
    const candidate = explicitPath
        ? path.resolve(explicitPath)
        : state.repositoryPath
            ?? (fs.existsSync(path.join(current, 'mcv.yaml')) ? current : undefined);
    if (!candidate || !fs.existsSync(path.join(candidate, 'mcv.yaml'))) {
        throw new Error('No bound MCV repository found. Run `mcv bind <path>` or `mcv init`.');
    }
    const parsed = yaml.parse(fs.readFileSync(path.join(candidate, 'mcv.yaml'), 'utf8'));
    if (!(0, objects_1.isRecord)(parsed) || typeof parsed.repositoryId !== 'string') {
        throw new Error(`${candidate} is not a valid MCV repository.`);
    }
    if (!explicitPath && state.defaultRepositoryId && state.defaultRepositoryId !== parsed.repositoryId) {
        throw new Error('Bound repository ID does not match local state. Run `mcv bind <path>` again.');
    }
    return candidate;
}
function bindRepository(context, repositoryPath) {
    const resolved = path.resolve(repositoryPath);
    const manifest = migrateRepository(context, resolved, false);
    const state = (0, state_1.readState)(context);
    state.schemaVersion = 2;
    state.repositoryPath = resolved;
    state.defaultRepositoryId = manifest.repositoryId;
    (0, state_1.writeState)(context, state);
}
function unbindRepository(context) {
    const state = (0, state_1.readState)(context);
    delete state.repositoryPath;
    delete state.defaultRepositoryId;
    delete state.baselineSnapshot;
    (0, state_1.writeState)(context, state);
}
function migrateRepository(context, repositoryPath, dryRun) {
    const manifestPath = path.join(repositoryPath, 'mcv.yaml');
    if (!fs.existsSync(manifestPath))
        throw new Error(`${repositoryPath} does not contain mcv.yaml.`);
    const raw = yaml.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (!(0, objects_1.isRecord)(raw))
        throw new Error(`${manifestPath} must contain a YAML object.`);
    if (raw.schemaVersion === 2) {
        validateManifest(raw, manifestPath);
        return raw;
    }
    if (raw.schemaVersion !== 1)
        throw new Error(`Unsupported repository schema ${String(raw.schemaVersion)}.`);
    const targets = (0, objects_1.isRecord)(raw.targets) ? raw.targets : {};
    const gemini = (0, objects_1.isRecord)(targets.gemini) ? targets.gemini : {};
    const migrated = {
        ...raw,
        schemaVersion: 2,
        repositoryId: String(raw.repositoryId),
        initializedAt: typeof raw.initializedAt === 'string' ? raw.initializedAt : new Date().toISOString(),
        targets: {
            ...targets,
            codex: { ...((0, objects_1.isRecord)(targets.codex) ? targets.codex : {}), enabled: (0, objects_1.isRecord)(targets.codex) ? targets.codex.enabled !== false : true },
            claudeCode: { ...((0, objects_1.isRecord)(targets.claudeCode) ? targets.claudeCode : {}), enabled: (0, objects_1.isRecord)(targets.claudeCode) ? targets.claudeCode.enabled !== false : true },
            gemini: {
                ...gemini,
                enabled: gemini.enabled !== false,
                surfaces: { geminiCli: 'auto', antigravity: 'auto' },
            },
        },
        variables: (0, objects_1.isRecord)(raw.variables) ? raw.variables : {},
        security: { scanSecrets: true, allowPlaintextSecrets: false },
        capture: {
            preserveUnknownNativeFields: !(0, objects_1.isRecord)(raw.capture) || raw.capture.preserveUnknownNativeFields !== false,
        },
        deploy: { backupBeforeWrite: true, useSymlinks: false },
    };
    delete migrated.includeRuntimeState;
    delete migrated.allowPlaintextSecrets;
    if (dryRun)
        return migrated;
    const backupRoot = path.join(path.dirname((0, state_1.getStateFilePath)(context)), 'repository-backups');
    fs.mkdirSync(backupRoot, { recursive: true });
    const backupDirectory = fs.mkdtempSync(path.join(backupRoot, 'schema-v1-'));
    const backupPath = path.join(backupDirectory, 'repository');
    fs.cpSync(repositoryPath, backupPath, { recursive: true });
    try {
        migrateGeminiNativeLayout(repositoryPath);
        migrateMcpRegistry(repositoryPath);
        (0, files_1.atomicWriteTextFile)(manifestPath, yaml.stringify(migrated));
    }
    catch (error) {
        fs.cpSync(backupPath, repositoryPath, { recursive: true, force: true });
        throw error;
    }
    return migrated;
}
function migrateGeminiNativeLayout(repositoryPath) {
    const nativeRoot = path.join(repositoryPath, 'ide', 'gemini', 'native');
    const mappings = [
        ['settings.json', path.join('gemini-cli', 'settings.json')],
        ['config.json', path.join('antigravity', 'config.json')],
        ['mcp_config.json', path.join('antigravity', 'mcp_config.json')],
    ];
    for (const [legacy, current] of mappings) {
        const source = path.join(nativeRoot, legacy);
        const destination = path.join(nativeRoot, current);
        if (!fs.existsSync(source) || fs.existsSync(destination))
            continue;
        fs.mkdirSync(path.dirname(destination), { recursive: true });
        fs.renameSync(source, destination);
    }
}
function migrateMcpRegistry(repositoryPath) {
    const registryPath = path.join(repositoryPath, 'common', 'mcp.yaml');
    if (!fs.existsSync(registryPath))
        return;
    const registry = yaml.parse(fs.readFileSync(registryPath, 'utf8'));
    if (!(0, objects_1.isRecord)(registry) || !(0, objects_1.isRecord)(registry.servers))
        return;
    const normalized = (0, mcp_1.normalizeMcpServers)(registry.servers, 'codex');
    (0, files_1.atomicWriteTextFile)(registryPath, yaml.stringify({ ...registry, servers: normalized.servers }));
}
