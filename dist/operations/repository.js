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
exports.bindRepository = bindRepository;
exports.unbindRepository = unbindRepository;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const yaml = __importStar(require("yaml"));
const child_process_1 = require("child_process");
const objects_1 = require("../utils/objects");
const repository_1 = require("../utils/repository");
const state_1 = require("../utils/state");
const contracts_1 = require("./contracts");
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
    let inspectedRepositoryId = state.defaultRepositoryId ?? null;
    let inspectedSchemaVersion = null;
    try {
        const raw = yaml.parse(fs.readFileSync(path.join(repositoryPath, 'mcv.yaml'), 'utf8'));
        if ((0, objects_1.isRecord)(raw)) {
            if (typeof raw.repositoryId === 'string')
                inspectedRepositoryId = raw.repositoryId;
            if (typeof raw.schemaVersion === 'number')
                inspectedSchemaVersion = raw.schemaVersion;
        }
    }
    catch {
        // Full validation below provides the stable Issue and technical details.
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
function bindRepository(context, repositoryPath = process.cwd()) {
    const resolvedPath = path.resolve(repositoryPath);
    let manifest;
    try {
        manifest = (0, repository_1.readManifest)(resolvedPath);
    }
    catch (error) {
        return {
            schemaVersion: contracts_1.OPERATION_SCHEMA_VERSION,
            operation: 'bind',
            status: 'failed',
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
    state.schemaVersion = 2;
    state.repositoryPath = resolvedPath;
    state.defaultRepositoryId = manifest.repositoryId;
    (0, state_1.writeState)(context, state);
    return {
        schemaVersion: contracts_1.OPERATION_SCHEMA_VERSION,
        operation: 'bind',
        status: 'succeeded',
        repositoryPath: resolvedPath,
        changes: [],
        issues: [],
        nextActions: [],
        data: {
            repositoryId: manifest.repositoryId,
            repositorySchemaVersion: manifest.schemaVersion,
            previousRepositoryPath,
        },
    };
}
function unbindRepository(context) {
    const state = (0, state_1.readState)(context);
    const previousRepositoryPath = state.repositoryPath ?? null;
    const repositoryId = state.defaultRepositoryId ?? null;
    delete state.repositoryPath;
    delete state.defaultRepositoryId;
    (0, state_1.writeState)(context, state);
    return {
        schemaVersion: contracts_1.OPERATION_SCHEMA_VERSION,
        operation: 'unbind',
        status: 'succeeded',
        repositoryPath: previousRepositoryPath,
        changes: [],
        issues: [],
        nextActions: [],
        data: {
            repositoryId,
            previousRepositoryPath,
        },
    };
}
