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
exports.createBindPlan = createBindPlan;
exports.applyBindPlan = applyBindPlan;
exports.bindRepository = bindRepository;
exports.createUnbindPlan = createUnbindPlan;
exports.applyUnbindPlan = applyUnbindPlan;
exports.unbindRepository = unbindRepository;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const yaml = __importStar(require("yaml"));
const child_process_1 = require("child_process");
const crypto_1 = require("crypto");
const uuid_1 = require("uuid");
const objects_1 = require("../utils/objects");
const repository_1 = require("../utils/repository");
const state_1 = require("../utils/state");
const contracts_1 = require("./contracts");
const activeRepositoryPlans = new WeakMap();
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
                    code: 'repository.migrationRequired',
                    message: `Repository schema ${inspectedSchemaVersion} requires migration.`,
                }],
            nextActions: ['Run `mcv migrate --dry-run` to review the required migration.'],
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
function createBindPlan(context, repositoryPath = process.cwd()) {
    const resolvedPath = path.resolve(repositoryPath);
    const operationId = (0, uuid_1.v4)();
    const preconditions = {
        manifest: hashOptionalFile(path.join(resolvedPath, 'mcv.yaml')),
        state: hashOptionalFile((0, state_1.getStateFilePath)(context)),
    };
    const identity = inspectManifestIdentity(resolvedPath);
    if (identity.schemaVersion !== null
        && identity.schemaVersion !== repository_1.CURRENT_SCHEMA_VERSION) {
        const nextActions = ['Run `mcv migrate --dry-run` to review the required migration.'];
        const message = `Repository schema ${identity.schemaVersion} requires migration.`;
        return {
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
                    code: 'repository.migrationRequired',
                    message,
                }],
            nextActions,
            error: {
                code: 'repository.migrationRequired',
                message,
                nextActions,
            },
        };
    }
    let manifest;
    try {
        manifest = (0, repository_1.readManifest)(resolvedPath);
    }
    catch (error) {
        return {
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
                technicalDetails: error instanceof Error ? error.message : String(error),
                nextActions: ['Choose a directory containing a valid mcv.yaml manifest.'],
            },
        };
    }
    const state = (0, state_1.readState)(context);
    const previousRepositoryPath = state.repositoryPath ?? null;
    if (state.defaultRepositoryId
        && state.defaultRepositoryId !== manifest.repositoryId) {
        return {
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
        };
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
    const staleError = validateActivePlan(context, plan);
    if (staleError)
        return failedBindResult(plan.repositoryPath, staleError);
    const change = plan.changes[0];
    if (!change?.repositoryPath || !change.repositoryId) {
        return failedBindResult(plan.repositoryPath, {
            code: 'operation.invalidPlan',
            message: 'The Bind Plan does not contain a valid Repository binding change.',
            nextActions: ['Generate a new Bind Plan.'],
        });
    }
    const state = (0, state_1.readState)(context);
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
function bindRepository(context, repositoryPath = process.cwd()) {
    return applyBindPlan(context, createBindPlan(context, repositoryPath));
}
function createUnbindPlan(context) {
    const state = (0, state_1.readState)(context);
    const previousRepositoryPath = state.repositoryPath ?? null;
    const repositoryId = state.defaultRepositoryId ?? null;
    const plan = {
        schemaVersion: contracts_1.OPERATION_SCHEMA_VERSION,
        operation: 'unbind',
        status: 'planned',
        readyToApply: true,
        operationId: (0, uuid_1.v4)(),
        preconditions: { state: hashOptionalFile((0, state_1.getStateFilePath)(context)) },
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
    const staleError = validateActivePlan(context, plan);
    if (staleError)
        return failedUnbindResult(plan.repositoryPath, staleError);
    const change = plan.changes[0];
    if (!change) {
        return failedUnbindResult(plan.repositoryPath, {
            code: 'operation.invalidPlan',
            message: 'The Unbind Plan does not contain a binding change.',
            nextActions: ['Generate a new Unbind Plan.'],
        });
    }
    const state = (0, state_1.readState)(context);
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
function unbindRepository(context) {
    return applyUnbindPlan(context, createUnbindPlan(context));
}
function registerPlan(plan) {
    for (const change of plan.changes)
        Object.freeze(change);
    Object.freeze(plan.changes);
    for (const issue of plan.issues)
        Object.freeze(issue);
    Object.freeze(plan.issues);
    Object.freeze(plan.nextActions);
    Object.freeze(plan.preconditions);
    Object.freeze(plan);
    activeRepositoryPlans.set(plan, plan.operationId);
    return plan;
}
function validateActivePlan(context, plan) {
    if (activeRepositoryPlans.get(plan) !== plan.operationId) {
        return {
            code: 'operation.invalidPlan',
            message: 'The Repository Plan is not the active in-process Plan.',
            nextActions: ['Generate a new Repository Plan.'],
        };
    }
    const currentStateHash = hashOptionalFile((0, state_1.getStateFilePath)(context));
    const manifestPath = plan.repositoryPath
        ? path.join(plan.repositoryPath, 'mcv.yaml')
        : null;
    const stale = currentStateHash !== plan.preconditions.state
        || (plan.operation === 'bind'
            && manifestPath !== null
            && hashOptionalFile(manifestPath) !== plan.preconditions.manifest);
    if (!stale)
        return undefined;
    activeRepositoryPlans.delete(plan);
    return {
        code: 'operation.stalePlan',
        message: 'Repository or local binding state changed after the Plan was generated.',
        nextActions: ['Generate and review a new Repository Plan.'],
    };
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
