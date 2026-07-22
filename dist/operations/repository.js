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
exports.inspectRepository = inspectRepository;
exports.createInitPlan = createInitPlan;
exports.applyInitPlan = applyInitPlan;
exports.createMigrationPlan = createMigrationPlan;
exports.applyMigrationPlan = applyMigrationPlan;
exports.createBindPlan = createBindPlan;
exports.applyBindPlan = applyBindPlan;
exports.createUnbindPlan = createUnbindPlan;
exports.applyUnbindPlan = applyUnbindPlan;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const yaml = __importStar(require("yaml"));
const child_process_1 = require("child_process");
const crypto_1 = require("crypto");
const uuid_1 = require("uuid");
const mcp_1 = require("../core/mcp");
const files_1 = require("../utils/files");
const objects_1 = require("../utils/objects");
const repository_1 = require("../utils/repository");
const state_1 = require("../utils/state");
const contracts_1 = require("./contracts");
const activeRepositoryPlans = new WeakMap();
const activeLifecyclePlans = new WeakMap();
function inspectRepository(context) {
    const state = (0, state_1.readState)(context);
    const repositoryPath = state.repositoryPath ?? null;
    if (!repositoryPath) {
        return {
            schemaVersion: contracts_1.OPERATION_SCHEMA_VERSION,
            operation: 'repository',
            status: 'reported',
            ready: false,
            repositoryPath: null,
            repositoryId: state.defaultRepositoryId ?? null,
            repositorySchemaVersion: null,
            valid: false,
            changes: [],
            issues: [{
                    severity: 'notice',
                    code: 'repository.notBound',
                    message: 'This device is not bound to an MCV Repository.',
                }],
            nextActions: ['Run `mcv bind [path]` to bind a Repository.'],
        };
    }
    const identity = inspectManifestIdentity(repositoryPath);
    const inspectedRepositoryId = identity.repositoryId ?? state.defaultRepositoryId ?? null;
    const inspectedSchemaVersion = identity.schemaVersion;
    if (inspectedSchemaVersion !== null
        && inspectedSchemaVersion !== repository_1.CURRENT_SCHEMA_VERSION) {
        const migratable = inspectedSchemaVersion === 1;
        const code = migratable
            ? 'repository.migrationRequired'
            : 'repository.unsupportedSchema';
        const message = migratable
            ? `Repository schema ${inspectedSchemaVersion} requires migration.`
            : `Repository schema ${inspectedSchemaVersion} is not supported by this MCV version.`;
        const nextActions = migratable
            ? ['Run `mcv migrate --dry-run` to review the required migration.']
            : ['Update MCV to a version that supports this Repository schema.'];
        return {
            schemaVersion: contracts_1.OPERATION_SCHEMA_VERSION,
            operation: 'repository',
            status: 'reported',
            ready: false,
            repositoryPath,
            repositoryId: inspectedRepositoryId,
            repositorySchemaVersion: inspectedSchemaVersion,
            valid: false,
            changes: [],
            issues: [{
                    severity: 'error',
                    code,
                    message,
                }],
            nextActions,
        };
    }
    let manifest;
    try {
        manifest = (0, repository_1.readManifest)(repositoryPath);
    }
    catch (error) {
        return {
            schemaVersion: contracts_1.OPERATION_SCHEMA_VERSION,
            operation: 'repository',
            status: 'reported',
            ready: false,
            repositoryPath,
            repositoryId: inspectedRepositoryId,
            repositorySchemaVersion: inspectedSchemaVersion,
            valid: false,
            changes: [],
            issues: [{
                    severity: 'error',
                    code: 'repository.invalidManifest',
                    message: 'The bound path does not contain a valid MCV Repository manifest.',
                    details: error instanceof Error ? error.message : String(error),
                }],
            nextActions: ['Move the Repository back or run `mcv bind [path]` with its new location.'],
        };
    }
    if (state.defaultRepositoryId
        && state.defaultRepositoryId !== manifest.repositoryId) {
        return {
            schemaVersion: contracts_1.OPERATION_SCHEMA_VERSION,
            operation: 'repository',
            status: 'reported',
            ready: false,
            repositoryPath,
            repositoryId: manifest.repositoryId,
            repositorySchemaVersion: manifest.schemaVersion,
            valid: false,
            changes: [],
            issues: [{
                    severity: 'error',
                    code: 'repository.idMismatch',
                    message: 'The Repository ID does not match the current local binding.',
                }],
            nextActions: ['Restore the expected Repository or rebind its moved location.'],
        };
    }
    return {
        schemaVersion: contracts_1.OPERATION_SCHEMA_VERSION,
        operation: 'repository',
        status: 'reported',
        ready: true,
        repositoryPath,
        repositoryId: manifest.repositoryId,
        repositorySchemaVersion: manifest.schemaVersion,
        valid: true,
        changes: [],
        issues: [],
        nextActions: [],
        ...inspectGitRepository(repositoryPath),
    };
}
function inspectGitRepository(repositoryPath) {
    try {
        (0, child_process_1.execFileSync)('git', ['rev-parse', '--is-inside-work-tree'], {
            cwd: repositoryPath,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore'],
        });
        const branch = (0, child_process_1.execFileSync)('git', ['branch', '--show-current'], {
            cwd: repositoryPath,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore'],
        }).trim() || null;
        const status = (0, child_process_1.execFileSync)('git', ['status', '--porcelain'], {
            cwd: repositoryPath,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore'],
        });
        return { git: { branch, clean: status.trim().length === 0 } };
    }
    catch {
        return {};
    }
}
function createInitPlan(context, repositoryPath = process.cwd()) {
    const resolvedPath = path.resolve(repositoryPath);
    const manifestPath = path.join(resolvedPath, 'mcv.yaml');
    const stateSnapshot = readStateSnapshot(context);
    const preconditions = {
        manifest: hashOptionalFile(manifestPath),
        manifestTarget: hashText(manifestPath),
        state: stateSnapshot.hash,
        stateTarget: hashText(stateSnapshot.path),
    };
    const operationId = (0, uuid_1.v4)();
    const failed = (error) => freezeLifecyclePlan({
        schemaVersion: contracts_1.OPERATION_SCHEMA_VERSION,
        operation: 'init',
        status: 'failed',
        readyToApply: false,
        operationId,
        preconditions,
        repositoryPath: resolvedPath,
        changes: [],
        issues: [{ severity: 'error', code: error.code, message: error.message }],
        nextActions: error.nextActions,
        error,
    });
    let entries;
    try {
        if (!fs.statSync(resolvedPath).isDirectory()) {
            return failed({
                code: 'repository.invalidInitTarget',
                message: 'The Init target is not a directory.',
                nextActions: ['Choose an existing writable directory.'],
            });
        }
        entries = fs.readdirSync(resolvedPath).filter((entry) => entry !== '.git');
    }
    catch (error) {
        return failed({
            code: 'repository.invalidInitTarget',
            message: 'MCV could not inspect the Init target directory.',
            technicalDetails: error instanceof Error ? error.message : String(error),
            nextActions: ['Choose an existing writable directory and try again.'],
        });
    }
    if (preconditions.manifest !== 'missing') {
        return failed({
            code: 'repository.alreadyInitialized',
            message: 'An mcv.yaml manifest already exists in this directory.',
            nextActions: ['Run `mcv bind [path]` to bind the existing Repository.'],
        });
    }
    if (stateSnapshot.state.repositoryPath || stateSnapshot.state.defaultRepositoryId) {
        return failed({
            code: 'repository.alreadyBound',
            message: 'This device is already bound to an MCV Repository.',
            nextActions: ['Run `mcv unbind` before initializing a different Repository.'],
        });
    }
    const repositoryId = (0, uuid_1.v4)();
    const initializedAt = new Date().toISOString();
    const issues = entries.length === 0 ? [] : [{
            severity: 'warning',
            code: 'repository.initTargetNotEmpty',
            message: 'The Init target contains existing files that MCV will leave unchanged.',
            details: `${entries.length} existing entr${entries.length === 1 ? 'y' : 'ies'}.`,
        }];
    return registerLifecyclePlan({
        schemaVersion: contracts_1.OPERATION_SCHEMA_VERSION,
        operation: 'init',
        status: 'planned',
        readyToApply: true,
        operationId,
        preconditions,
        repositoryPath: resolvedPath,
        changes: [{
                id: 'repository-manifest',
                kind: 'add',
                path: manifestPath,
                repositoryPath: resolvedPath,
                repositoryId,
                initializedAt,
                schemaVersion: repository_1.CURRENT_SCHEMA_VERSION,
            }, {
                id: 'repository-binding',
                kind: 'bind',
                repositoryPath: resolvedPath,
                repositoryId,
            }],
        issues,
        nextActions: [],
    });
}
function applyInitPlan(context, plan) {
    if (plan.status === 'failed')
        return failedInitResult(plan.repositoryPath, plan.error, plan.issues);
    const validation = validateLifecyclePlan(context, plan);
    if ('error' in validation)
        return failedInitResult(plan.repositoryPath, validation.error);
    const manifestChange = plan.changes.find((change) => change.id === 'repository-manifest');
    const bindingChange = plan.changes.find((change) => change.id === 'repository-binding');
    if (!manifestChange?.path || !manifestChange.initializedAt || !bindingChange) {
        return failedInitResult(plan.repositoryPath, {
            code: 'operation.invalidPlan',
            message: 'The Init Plan does not contain the required manifest and binding changes.',
            nextActions: ['Generate a new Init Plan.'],
        });
    }
    const manifest = createEmptyManifest(manifestChange.repositoryId, manifestChange.initializedAt);
    const state = validation.state;
    state.schemaVersion = 2;
    state.deviceId ??= (0, uuid_1.v4)();
    state.defaultRepositoryId = bindingChange.repositoryId;
    state.repositoryPath = bindingChange.repositoryPath;
    state.baselineSnapshot = { recordedAt: manifestChange.initializedAt, files: {} };
    let manifestWritten = false;
    try {
        (0, files_1.atomicWriteTextFile)(manifestChange.path, yaml.stringify(manifest));
        manifestWritten = true;
        (0, state_1.writeState)(context, state);
    }
    catch (error) {
        if (manifestWritten) {
            try {
                fs.rmSync(manifestChange.path, { force: true });
            }
            catch { /* best effort rollback */ }
        }
        return failedInitResult(plan.repositoryPath, {
            code: 'repository.initWriteFailed',
            message: 'MCV could not initialize and bind the Repository.',
            technicalDetails: error instanceof Error ? error.message : String(error),
            nextActions: ['Check directory permissions and generate a new Init Plan.'],
        });
    }
    finally {
        activeLifecyclePlans.delete(plan);
    }
    return {
        schemaVersion: contracts_1.OPERATION_SCHEMA_VERSION,
        operation: 'init',
        status: 'succeeded',
        repositoryPath: bindingChange.repositoryPath,
        changes: [],
        issues: [],
        nextActions: [],
        data: {
            repositoryId: bindingChange.repositoryId,
            repositorySchemaVersion: repository_1.CURRENT_SCHEMA_VERSION,
        },
    };
}
function createMigrationPlan(context, repositoryPath = process.cwd()) {
    const resolvedPath = path.resolve(repositoryPath);
    const operationId = (0, uuid_1.v4)();
    const preconditions = {
        repository: hashDirectory(resolvedPath),
        repositoryTarget: hashText(resolvedPath),
        stateTarget: hashText(path.dirname((0, state_1.getStateFilePath)(context))),
    };
    const failed = (error) => freezeLifecyclePlan({
        schemaVersion: contracts_1.OPERATION_SCHEMA_VERSION,
        operation: 'migrate',
        status: 'failed',
        readyToApply: false,
        operationId,
        preconditions,
        repositoryPath: resolvedPath,
        changes: [],
        issues: [{ severity: 'error', code: error.code, message: error.message }],
        nextActions: error.nextActions,
        error,
    });
    const manifestPath = path.join(resolvedPath, 'mcv.yaml');
    let raw;
    try {
        const parsed = yaml.parse(fs.readFileSync(manifestPath, 'utf8'));
        if (!(0, objects_1.isRecord)(parsed))
            throw new Error(`${manifestPath} must contain a YAML object.`);
        raw = parsed;
    }
    catch (error) {
        return failed({
            code: 'repository.invalidManifest',
            message: 'The selected directory does not contain a readable MCV Repository manifest.',
            technicalDetails: error instanceof Error ? error.message : String(error),
            nextActions: ['Choose a Repository containing a schema v1 mcv.yaml manifest.'],
        });
    }
    if (raw.schemaVersion !== 1) {
        const current = raw.schemaVersion === repository_1.CURRENT_SCHEMA_VERSION;
        return failed({
            code: current ? 'repository.migrationNotRequired' : 'repository.unsupportedSchema',
            message: current
                ? 'This Repository already uses the current schema.'
                : `Repository schema ${String(raw.schemaVersion)} is not supported by this MCV version.`,
            nextActions: current
                ? ['Continue with the requested Repository operation.']
                : ['Update MCV to a version that supports this Repository schema.'],
        });
    }
    if (typeof raw.repositoryId !== 'string' || raw.repositoryId.length === 0) {
        return failed({
            code: 'repository.invalidManifest',
            message: 'The schema v1 manifest does not contain a Repository ID.',
            nextActions: ['Repair repositoryId in mcv.yaml before migrating.'],
        });
    }
    const changes = [{
            id: 'repository-backup',
            kind: 'backup',
            path: path.join(path.dirname((0, state_1.getStateFilePath)(context)), 'repository-backups'),
        }, {
            id: 'schema-version',
            kind: 'modify',
            path: manifestPath,
            before: 1,
            after: repository_1.CURRENT_SCHEMA_VERSION,
        }];
    for (const mapping of geminiLayoutMappings(resolvedPath)) {
        if (fs.existsSync(mapping.sourcePath) && !fs.existsSync(mapping.targetPath)) {
            changes.push({ id: mapping.id, kind: 'move', sourcePath: mapping.sourcePath, targetPath: mapping.targetPath });
        }
    }
    const registryPath = path.join(resolvedPath, 'common', 'mcp.yaml');
    const normalizedRegistry = readNormalizedMcpRegistry(registryPath);
    if (normalizedRegistry !== undefined && normalizedRegistry !== fs.readFileSync(registryPath, 'utf8')) {
        changes.push({ id: 'mcp-registry', kind: 'modify', path: registryPath });
    }
    return registerLifecyclePlan({
        schemaVersion: contracts_1.OPERATION_SCHEMA_VERSION,
        operation: 'migrate',
        status: 'planned',
        readyToApply: true,
        operationId,
        preconditions,
        repositoryPath: resolvedPath,
        changes,
        issues: [],
        nextActions: [],
    });
}
function applyMigrationPlan(context, plan) {
    if (plan.status === 'failed')
        return failedMigrationResult(plan.repositoryPath, plan.error, plan.issues);
    const validation = validateLifecyclePlan(context, plan);
    if ('error' in validation)
        return failedMigrationResult(plan.repositoryPath, validation.error);
    if (!plan.repositoryPath) {
        return failedMigrationResult(null, {
            code: 'operation.invalidPlan',
            message: 'The Migration Plan does not identify a Repository.',
            nextActions: ['Generate a new Migration Plan.'],
        });
    }
    const repositoryPath = plan.repositoryPath;
    const backupRoot = path.join(path.dirname((0, state_1.getStateFilePath)(context)), 'repository-backups');
    let backupPath;
    let backupVerified = false;
    try {
        fs.mkdirSync(backupRoot, { recursive: true });
        const backupDirectory = fs.mkdtempSync(path.join(backupRoot, 'schema-v1-'));
        backupPath = path.join(backupDirectory, 'repository');
        fs.cpSync(repositoryPath, backupPath, { recursive: true, verbatimSymlinks: true });
        if (hashDirectory(backupPath) !== plan.preconditions.repository) {
            throw new Error('The Repository backup did not match the planned source snapshot.');
        }
        backupVerified = true;
        const manifestPath = path.join(repositoryPath, 'mcv.yaml');
        const raw = yaml.parse(fs.readFileSync(manifestPath, 'utf8'));
        if (!(0, objects_1.isRecord)(raw) || raw.schemaVersion !== 1)
            throw new Error('The Repository is no longer schema v1.');
        const migrated = migrateV1Manifest(raw);
        (0, repository_1.validateManifest)(migrated, manifestPath);
        for (const change of plan.changes) {
            if (change.kind === 'move' && change.sourcePath && change.targetPath) {
                fs.mkdirSync(path.dirname(change.targetPath), { recursive: true });
                fs.renameSync(change.sourcePath, change.targetPath);
            }
            if (change.id === 'mcp-registry' && change.path) {
                const content = readNormalizedMcpRegistry(change.path);
                if (content === undefined)
                    throw new Error('The MCP registry can no longer be normalized.');
                (0, files_1.atomicWriteTextFile)(change.path, content);
            }
        }
        (0, files_1.atomicWriteTextFile)(manifestPath, yaml.stringify(migrated));
        (0, repository_1.readManifest)(repositoryPath);
    }
    catch (error) {
        if (backupVerified && backupPath && fs.existsSync(backupPath)) {
            try {
                fs.rmSync(repositoryPath, { recursive: true, force: true });
                fs.cpSync(backupPath, repositoryPath, { recursive: true, verbatimSymlinks: true });
            }
            catch { /* preserve the verified backup for manual recovery */ }
        }
        return failedMigrationResult(repositoryPath, {
            code: 'repository.migrationFailed',
            message: 'MCV could not back up and migrate the Repository safely.',
            technicalDetails: error instanceof Error ? error.message : String(error),
            nextActions: backupVerified && backupPath
                ? [`Recover the Repository from ${backupPath} before retrying.`]
                : ['Check local state and Repository permissions before retrying.'],
        });
    }
    finally {
        activeLifecyclePlans.delete(plan);
    }
    const manifest = (0, repository_1.readManifest)(repositoryPath);
    return {
        schemaVersion: contracts_1.OPERATION_SCHEMA_VERSION,
        operation: 'migrate',
        status: 'succeeded',
        repositoryPath,
        changes: [],
        issues: [],
        nextActions: [],
        data: {
            repositoryId: manifest.repositoryId,
            previousSchemaVersion: 1,
            repositorySchemaVersion: repository_1.CURRENT_SCHEMA_VERSION,
            backupPath: backupPath,
            backupVerified: true,
        },
    };
}
function createBindPlan(context, repositoryPath = process.cwd()) {
    const resolvedPath = path.resolve(repositoryPath);
    const operationId = (0, uuid_1.v4)();
    const stateSnapshot = readStateSnapshot(context);
    const manifestPath = path.join(resolvedPath, 'mcv.yaml');
    const manifestSnapshot = readManifestSnapshot(manifestPath);
    const preconditions = {
        manifest: manifestSnapshot.hash,
        state: stateSnapshot.hash,
        stateTarget: hashText(stateSnapshot.path),
    };
    const identity = manifestSnapshot.identity;
    if (identity.schemaVersion !== null
        && identity.schemaVersion !== repository_1.CURRENT_SCHEMA_VERSION) {
        const migratable = identity.schemaVersion === 1;
        const code = migratable
            ? 'repository.migrationRequired'
            : 'repository.unsupportedSchema';
        const nextActions = migratable
            ? ['Run `mcv migrate --dry-run` to review the required migration.']
            : ['Update MCV to a version that supports this Repository schema.'];
        const message = migratable
            ? `Repository schema ${identity.schemaVersion} requires migration.`
            : `Repository schema ${identity.schemaVersion} is not supported by this MCV version.`;
        return freezePlan({
            schemaVersion: contracts_1.OPERATION_SCHEMA_VERSION,
            operation: 'bind',
            status: 'failed',
            readyToApply: false,
            operationId,
            preconditions,
            repositoryPath: resolvedPath,
            changes: [],
            issues: [{
                    severity: 'error',
                    code,
                    message,
                }],
            nextActions,
            error: {
                code,
                message,
                nextActions,
            },
        });
    }
    const manifest = manifestSnapshot.manifest;
    if (!manifest) {
        const error = manifestSnapshot.error;
        return freezePlan({
            schemaVersion: contracts_1.OPERATION_SCHEMA_VERSION,
            operation: 'bind',
            status: 'failed',
            readyToApply: false,
            operationId,
            preconditions,
            repositoryPath: resolvedPath,
            changes: [],
            issues: [{
                    severity: 'error',
                    code: 'repository.invalidManifest',
                    message: 'The selected directory is not a valid MCV Repository.',
                }],
            nextActions: ['Choose a directory containing a valid mcv.yaml manifest.'],
            error: {
                code: 'repository.invalidManifest',
                message: 'The selected directory is not a valid MCV Repository.',
                technicalDetails: error,
                nextActions: ['Choose a directory containing a valid mcv.yaml manifest.'],
            },
        });
    }
    const state = stateSnapshot.state;
    const previousRepositoryPath = state.repositoryPath ?? null;
    if (state.defaultRepositoryId
        && state.defaultRepositoryId !== manifest.repositoryId) {
        return freezePlan({
            schemaVersion: contracts_1.OPERATION_SCHEMA_VERSION,
            operation: 'bind',
            status: 'failed',
            readyToApply: false,
            operationId,
            preconditions,
            repositoryPath: resolvedPath,
            changes: [],
            issues: [{
                    severity: 'error',
                    code: 'repository.idMismatch',
                    message: 'The Repository ID does not match the current local binding.',
                }],
            nextActions: ['Unbind the current Repository before binding a different one.'],
            error: {
                code: 'repository.idMismatch',
                message: 'The Repository ID does not match the current local binding.',
                nextActions: ['Unbind the current Repository before binding a different one.'],
            },
        });
    }
    const plan = {
        schemaVersion: contracts_1.OPERATION_SCHEMA_VERSION,
        operation: 'bind',
        status: 'planned',
        readyToApply: true,
        operationId,
        preconditions,
        repositoryPath: resolvedPath,
        changes: [{
                id: 'repository-binding',
                kind: 'bind',
                previousRepositoryPath,
                repositoryPath: resolvedPath,
                repositoryId: manifest.repositoryId,
            }],
        issues: [],
        nextActions: [],
    };
    return registerPlan(plan);
}
function applyBindPlan(context, plan) {
    if (plan.status === 'failed')
        return failedResultFromPlan(plan);
    const validation = validateActivePlan(context, plan);
    if ('error' in validation)
        return failedBindResult(plan.repositoryPath, validation.error);
    const change = plan.changes[0];
    if (!change?.repositoryPath || !change.repositoryId) {
        return failedBindResult(plan.repositoryPath, {
            code: 'operation.invalidPlan',
            message: 'The Bind Plan does not contain a valid Repository binding change.',
            nextActions: ['Generate a new Bind Plan.'],
        });
    }
    const state = validation.state;
    state.schemaVersion = 2;
    state.repositoryPath = change.repositoryPath;
    state.defaultRepositoryId = change.repositoryId;
    try {
        (0, state_1.writeState)(context, state);
    }
    catch (error) {
        return failedBindResult(plan.repositoryPath, {
            code: 'repository.stateWriteFailed',
            message: 'MCV could not write the local Repository binding.',
            technicalDetails: error instanceof Error ? error.message : String(error),
            nextActions: ['Check permissions for the MCV local state directory and try again.'],
        });
    }
    finally {
        activeRepositoryPlans.delete(plan);
    }
    return {
        schemaVersion: contracts_1.OPERATION_SCHEMA_VERSION,
        operation: 'bind',
        status: 'succeeded',
        repositoryPath: change.repositoryPath,
        changes: [],
        issues: [],
        nextActions: [],
        data: {
            repositoryId: change.repositoryId,
            repositorySchemaVersion: repository_1.CURRENT_SCHEMA_VERSION,
            previousRepositoryPath: change.previousRepositoryPath,
        },
    };
}
function createUnbindPlan(context) {
    const stateSnapshot = readStateSnapshot(context);
    const state = stateSnapshot.state;
    const previousRepositoryPath = state.repositoryPath ?? null;
    const repositoryId = state.defaultRepositoryId ?? null;
    const plan = {
        schemaVersion: contracts_1.OPERATION_SCHEMA_VERSION,
        operation: 'unbind',
        status: 'planned',
        readyToApply: true,
        operationId: (0, uuid_1.v4)(),
        preconditions: {
            state: stateSnapshot.hash,
            stateTarget: hashText(stateSnapshot.path),
        },
        repositoryPath: previousRepositoryPath,
        changes: [{
                id: 'repository-binding',
                kind: 'unbind',
                previousRepositoryPath,
                repositoryPath: null,
                repositoryId,
            }],
        issues: [],
        nextActions: [],
    };
    return registerPlan(plan);
}
function applyUnbindPlan(context, plan) {
    if (plan.status === 'failed')
        return failedUnbindResult(plan.repositoryPath, plan.error);
    const validation = validateActivePlan(context, plan);
    if ('error' in validation)
        return failedUnbindResult(plan.repositoryPath, validation.error);
    const change = plan.changes[0];
    if (!change) {
        return failedUnbindResult(plan.repositoryPath, {
            code: 'operation.invalidPlan',
            message: 'The Unbind Plan does not contain a binding change.',
            nextActions: ['Generate a new Unbind Plan.'],
        });
    }
    const state = validation.state;
    delete state.repositoryPath;
    delete state.defaultRepositoryId;
    try {
        (0, state_1.writeState)(context, state);
    }
    catch (error) {
        return failedUnbindResult(plan.repositoryPath, {
            code: 'repository.stateWriteFailed',
            message: 'MCV could not remove the local Repository binding.',
            technicalDetails: error instanceof Error ? error.message : String(error),
            nextActions: ['Check permissions for the MCV local state directory and try again.'],
        });
    }
    finally {
        activeRepositoryPlans.delete(plan);
    }
    return {
        schemaVersion: contracts_1.OPERATION_SCHEMA_VERSION,
        operation: 'unbind',
        status: 'succeeded',
        repositoryPath: change.previousRepositoryPath,
        changes: [],
        issues: [],
        nextActions: [],
        data: {
            repositoryId: change.repositoryId,
            previousRepositoryPath: change.previousRepositoryPath,
        },
    };
}
function registerPlan(plan) {
    freezePlan(plan);
    activeRepositoryPlans.set(plan, plan.operationId);
    return plan;
}
function freezePlan(plan) {
    for (const change of plan.changes)
        Object.freeze(change);
    Object.freeze(plan.changes);
    for (const issue of plan.issues)
        Object.freeze(issue);
    Object.freeze(plan.issues);
    Object.freeze(plan.nextActions);
    Object.freeze(plan.preconditions);
    if (plan.status === 'failed') {
        Object.freeze(plan.error.nextActions);
        Object.freeze(plan.error);
    }
    Object.freeze(plan);
    return plan;
}
function validateActivePlan(context, plan) {
    if (activeRepositoryPlans.get(plan) !== plan.operationId) {
        return { error: {
                code: 'operation.invalidPlan',
                message: 'The Repository Plan is not the active in-process Plan.',
                nextActions: ['Generate a new Repository Plan.'],
            } };
    }
    const stateSnapshot = readStateSnapshot(context);
    const manifestPath = plan.repositoryPath
        ? path.join(plan.repositoryPath, 'mcv.yaml')
        : null;
    const stale = hashText(stateSnapshot.path) !== plan.preconditions.stateTarget
        || stateSnapshot.hash !== plan.preconditions.state
        || (plan.operation === 'bind'
            && manifestPath !== null
            && hashOptionalFile(manifestPath) !== plan.preconditions.manifest);
    if (!stale)
        return { state: stateSnapshot.state };
    activeRepositoryPlans.delete(plan);
    return { error: {
            code: 'operation.stalePlan',
            message: 'Repository or local binding state changed after the Plan was generated.',
            nextActions: ['Generate and review a new Repository Plan.'],
        } };
}
function failedResultFromPlan(plan) {
    const error = plan.status === 'failed'
        ? plan.error
        : {
            code: 'operation.invalidPlan',
            message: 'The Bind Plan cannot be applied.',
            nextActions: ['Generate a new Bind Plan.'],
        };
    return failedBindResult(plan.repositoryPath, error, plan.issues);
}
function failedBindResult(repositoryPath, error, issues = [{ severity: 'error', code: error.code, message: error.message }]) {
    return {
        schemaVersion: contracts_1.OPERATION_SCHEMA_VERSION,
        operation: 'bind',
        status: 'failed',
        repositoryPath,
        changes: [],
        issues,
        nextActions: error.nextActions,
        error,
    };
}
function failedUnbindResult(repositoryPath, error) {
    return {
        schemaVersion: contracts_1.OPERATION_SCHEMA_VERSION,
        operation: 'unbind',
        status: 'failed',
        repositoryPath,
        changes: [],
        issues: [{ severity: 'error', code: error.code, message: error.message }],
        nextActions: error.nextActions,
        error,
    };
}
function hashOptionalFile(filePath) {
    try {
        return (0, crypto_1.createHash)('sha256').update(fs.readFileSync(filePath)).digest('hex');
    }
    catch (error) {
        if (error.code === 'ENOENT')
            return 'missing';
        return 'unreadable';
    }
}
function hashText(value) {
    return (0, crypto_1.createHash)('sha256').update(value).digest('hex');
}
function readStateSnapshot(context) {
    const statePath = (0, state_1.getStateFilePath)(context);
    try {
        const content = fs.readFileSync(statePath);
        let state = {};
        try {
            state = JSON.parse(content.toString('utf8'));
        }
        catch {
            // Match readState(): invalid local state is treated as empty.
        }
        return {
            path: statePath,
            hash: (0, crypto_1.createHash)('sha256').update(content).digest('hex'),
            state,
        };
    }
    catch (error) {
        return {
            path: statePath,
            hash: error.code === 'ENOENT' ? 'missing' : 'unreadable',
            state: {},
        };
    }
}
function readManifestSnapshot(manifestPath) {
    let content;
    try {
        content = fs.readFileSync(manifestPath);
    }
    catch (error) {
        return {
            hash: error.code === 'ENOENT' ? 'missing' : 'unreadable',
            identity: { repositoryId: null, schemaVersion: null },
            error: error instanceof Error ? error.message : String(error),
        };
    }
    const hash = (0, crypto_1.createHash)('sha256').update(content).digest('hex');
    try {
        const raw = yaml.parse(content.toString('utf8'));
        if (!(0, objects_1.isRecord)(raw)) {
            return {
                hash,
                identity: { repositoryId: null, schemaVersion: null },
                error: `${manifestPath} must contain a YAML object.`,
            };
        }
        const identity = {
            repositoryId: typeof raw.repositoryId === 'string' ? raw.repositoryId : null,
            schemaVersion: typeof raw.schemaVersion === 'number' ? raw.schemaVersion : null,
        };
        if (identity.schemaVersion !== repository_1.CURRENT_SCHEMA_VERSION)
            return { hash, identity };
        (0, repository_1.validateManifest)(raw, manifestPath);
        return { hash, identity, manifest: raw };
    }
    catch (error) {
        return {
            hash,
            identity: { repositoryId: null, schemaVersion: null },
            error: error instanceof Error ? error.message : String(error),
        };
    }
}
function inspectManifestIdentity(repositoryPath) {
    try {
        const raw = yaml.parse(fs.readFileSync(path.join(repositoryPath, 'mcv.yaml'), 'utf8'));
        if (!(0, objects_1.isRecord)(raw))
            return { repositoryId: null, schemaVersion: null };
        return {
            repositoryId: typeof raw.repositoryId === 'string' ? raw.repositoryId : null,
            schemaVersion: typeof raw.schemaVersion === 'number' ? raw.schemaVersion : null,
        };
    }
    catch {
        return { repositoryId: null, schemaVersion: null };
    }
}
function createEmptyManifest(repositoryId, initializedAt) {
    return {
        schemaVersion: repository_1.CURRENT_SCHEMA_VERSION,
        repositoryId,
        initializedAt,
        targets: {
            codex: { enabled: true },
            claudeCode: { enabled: true },
            gemini: {
                enabled: true,
                surfaces: { geminiCli: 'auto', antigravity: 'auto' },
            },
        },
        variables: {},
        security: { scanSecrets: true, allowPlaintextSecrets: false },
        capture: { preserveUnknownNativeFields: true },
        deploy: { backupBeforeWrite: true, useSymlinks: false },
    };
}
function migrateV1Manifest(raw) {
    const targets = (0, objects_1.isRecord)(raw.targets) ? raw.targets : {};
    const gemini = (0, objects_1.isRecord)(targets.gemini) ? targets.gemini : {};
    const migrated = {
        ...raw,
        schemaVersion: repository_1.CURRENT_SCHEMA_VERSION,
        repositoryId: String(raw.repositoryId),
        initializedAt: typeof raw.initializedAt === 'string' ? raw.initializedAt : new Date().toISOString(),
        targets: {
            ...targets,
            codex: {
                ...((0, objects_1.isRecord)(targets.codex) ? targets.codex : {}),
                enabled: (0, objects_1.isRecord)(targets.codex) ? targets.codex.enabled !== false : true,
            },
            claudeCode: {
                ...((0, objects_1.isRecord)(targets.claudeCode) ? targets.claudeCode : {}),
                enabled: (0, objects_1.isRecord)(targets.claudeCode) ? targets.claudeCode.enabled !== false : true,
            },
            gemini: {
                ...gemini,
                enabled: gemini.enabled !== false,
                surfaces: { geminiCli: 'auto', antigravity: 'auto' },
            },
        },
        variables: (0, objects_1.isRecord)(raw.variables) ? raw.variables : {},
        security: { scanSecrets: true, allowPlaintextSecrets: false },
        capture: {
            preserveUnknownNativeFields: !(0, objects_1.isRecord)(raw.capture)
                || raw.capture.preserveUnknownNativeFields !== false,
        },
        deploy: { backupBeforeWrite: true, useSymlinks: false },
    };
    delete migrated.includeRuntimeState;
    delete migrated.allowPlaintextSecrets;
    return migrated;
}
function geminiLayoutMappings(repositoryPath) {
    const nativeRoot = path.join(repositoryPath, 'ide', 'gemini', 'native');
    return [
        { id: 'gemini-settings-layout', sourcePath: path.join(nativeRoot, 'settings.json'), targetPath: path.join(nativeRoot, 'gemini-cli', 'settings.json') },
        { id: 'antigravity-config-layout', sourcePath: path.join(nativeRoot, 'config.json'), targetPath: path.join(nativeRoot, 'antigravity', 'config.json') },
        { id: 'antigravity-mcp-layout', sourcePath: path.join(nativeRoot, 'mcp_config.json'), targetPath: path.join(nativeRoot, 'antigravity', 'mcp_config.json') },
    ];
}
function readNormalizedMcpRegistry(registryPath) {
    if (!fs.existsSync(registryPath))
        return undefined;
    const registry = yaml.parse(fs.readFileSync(registryPath, 'utf8'));
    if (!(0, objects_1.isRecord)(registry) || !(0, objects_1.isRecord)(registry.servers))
        return undefined;
    const normalized = (0, mcp_1.normalizeMcpServers)(registry.servers, 'codex');
    return yaml.stringify({ ...registry, servers: normalized.servers });
}
function hashDirectory(root) {
    const hash = (0, crypto_1.createHash)('sha256');
    const visit = (current, relative) => {
        const stat = fs.lstatSync(current);
        if (stat.isSymbolicLink()) {
            hash.update(`link\0${relative}\0${fs.readlinkSync(current)}\0`);
            return;
        }
        if (stat.isDirectory()) {
            hash.update(`directory\0${relative}\0`);
            for (const entry of fs.readdirSync(current).sort()) {
                visit(path.join(current, entry), relative ? `${relative}/${entry}` : entry);
            }
            return;
        }
        if (stat.isFile()) {
            hash.update(`file\0${relative}\0`);
            hash.update(fs.readFileSync(current));
            hash.update('\0');
            return;
        }
        hash.update(`other\0${relative}\0`);
    };
    try {
        visit(root, '');
        return hash.digest('hex');
    }
    catch (error) {
        return error.code === 'ENOENT' ? 'missing' : 'unreadable';
    }
}
function registerLifecyclePlan(plan) {
    freezeLifecyclePlan(plan);
    activeLifecyclePlans.set(plan, plan.operationId);
    return plan;
}
function freezeLifecyclePlan(plan) {
    for (const change of plan.changes)
        Object.freeze(change);
    Object.freeze(plan.changes);
    for (const issue of plan.issues)
        Object.freeze(issue);
    Object.freeze(plan.issues);
    Object.freeze(plan.nextActions);
    Object.freeze(plan.preconditions);
    if (plan.status === 'failed') {
        Object.freeze(plan.error.nextActions);
        Object.freeze(plan.error);
    }
    Object.freeze(plan);
    return plan;
}
function validateLifecyclePlan(context, plan) {
    if (activeLifecyclePlans.get(plan) !== plan.operationId) {
        return { error: {
                code: 'operation.invalidPlan',
                message: 'The Repository lifecycle Plan is not the active in-process Plan.',
                nextActions: [`Generate a new ${plan.operation === 'init' ? 'Init' : 'Migration'} Plan.`],
            } };
    }
    if (plan.operation === 'init') {
        const stateSnapshot = readStateSnapshot(context);
        const manifestPath = plan.repositoryPath ? path.join(plan.repositoryPath, 'mcv.yaml') : '';
        const stale = hashText(stateSnapshot.path) !== plan.preconditions.stateTarget
            || stateSnapshot.hash !== plan.preconditions.state
            || hashText(manifestPath) !== plan.preconditions.manifestTarget
            || hashOptionalFile(manifestPath) !== plan.preconditions.manifest;
        if (!stale)
            return { state: stateSnapshot.state };
    }
    else {
        const backupTarget = path.dirname((0, state_1.getStateFilePath)(context));
        const stale = hashText(plan.repositoryPath ?? '') !== plan.preconditions.repositoryTarget
            || hashText(backupTarget) !== plan.preconditions.stateTarget
            || hashDirectory(plan.repositoryPath ?? '') !== plan.preconditions.repository;
        if (!stale)
            return { state: (0, state_1.readState)(context) };
    }
    activeLifecyclePlans.delete(plan);
    return { error: {
            code: 'operation.stalePlan',
            message: 'Repository or local binding state changed after the Plan was generated.',
            nextActions: [`Generate and review a new ${plan.operation === 'init' ? 'Init' : 'Migration'} Plan.`],
        } };
}
function failedInitResult(repositoryPath, error, issues = [{ severity: 'error', code: error.code, message: error.message }]) {
    return {
        schemaVersion: contracts_1.OPERATION_SCHEMA_VERSION,
        operation: 'init',
        status: 'failed',
        repositoryPath,
        changes: [],
        issues,
        nextActions: error.nextActions,
        error,
    };
}
function failedMigrationResult(repositoryPath, error, issues = [{ severity: 'error', code: error.code, message: error.message }]) {
    return {
        schemaVersion: contracts_1.OPERATION_SCHEMA_VERSION,
        operation: 'migrate',
        status: 'failed',
        repositoryPath,
        changes: [],
        issues,
        nextActions: error.nextActions,
        error,
    };
}
