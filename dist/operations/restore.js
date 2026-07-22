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
exports.createRestorePlan = createRestorePlan;
exports.findLatestVerifiedBackup = findLatestVerifiedBackup;
const crypto = __importStar(require("crypto"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const uuid_1 = require("uuid");
const files_1 = require("../utils/files");
const objects_1 = require("../utils/objects");
const repository_1 = require("../utils/repository");
const state_1 = require("../utils/state");
const contracts_1 = require("./contracts");
const MISSING_HASH = hashText('<missing>');
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
function createRestorePlan(context) {
    const operationId = (0, uuid_1.v4)();
    const state = (0, state_1.readState)(context);
    const repositoryPath = state.repositoryPath ?? null;
    try {
        if (repositoryPath)
            (0, repository_1.readManifest)(repositoryPath);
        const backupRoot = path.join(path.dirname((0, state_1.getStateFilePath)(context)), 'backups');
        const backup = findLatestVerifiedBackup(backupRoot);
        if (!backup) {
            return freezeRestorePlan(failedRestorePlan(operationId, repositoryPath, 'restore.backupNotFound', 'No complete and verified deployment backup is available.', ['Run a successful Deploy before trying Restore again.']));
        }
        return freezeRestorePlan(buildRestorePlan(operationId, repositoryPath, backup));
    }
    catch (error) {
        return freezeRestorePlan(failedRestorePlan(operationId, repositoryPath, 'restore.planFailed', 'The Restore Plan could not be generated safely.', ['Fix the reported local state or Repository problem, then regenerate the Restore Plan.'], errorMessage(error)));
    }
}
function buildRestorePlan(operationId, repositoryPath, backup) {
    const preconditions = {
        'backup:manifest': backup.manifestHash,
    };
    const conflicts = [];
    const changes = backup.manifest.files.map((file) => {
        const action = file.action === 'add' ? 'delete' : 'restore';
        const id = stableRestoreId(action, file.originalPath);
        const targetHash = currentFileHash(file.originalPath);
        const expectedTargetHash = file.afterHash ?? MISSING_HASH;
        preconditions[`source:${id}`] = file.beforeHash ?? MISSING_HASH;
        preconditions[`target:${id}`] = targetHash;
        if (targetHash !== expectedTargetHash)
            conflicts.push(file.originalPath);
        return { id, action, targetPath: file.originalPath };
    });
    const issues = conflicts.length === 0 ? [] : [{
            severity: 'error',
            code: 'restore.conflict',
            message: 'Restore would overwrite files that changed after the deployment.',
            details: conflicts.join('\n'),
        }];
    return {
        schemaVersion: contracts_1.OPERATION_SCHEMA_VERSION,
        operation: 'restore',
        status: 'planned',
        readyToApply: issues.length === 0,
        operationId,
        preconditions,
        repositoryPath,
        backup: {
            id: path.basename(backup.directory),
            createdAt: backup.manifest.createdAt,
        },
        changes,
        issues,
        nextActions: issues.length === 0
            ? ['Review this Plan, then run `mcv restore` to restore the listed files.']
            : ['Back up or manually resolve every Restore Conflict, then generate a new Restore Plan.'],
    };
}
function findLatestVerifiedBackup(backupRoot) {
    if (!fs.existsSync(backupRoot))
        return undefined;
    return fs.readdirSync(backupRoot, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .flatMap((entry) => {
        const verified = verifyDeployBackup(path.join(backupRoot, entry.name));
        return verified ? [verified] : [];
    })
        .sort((left, right) => Date.parse(right.manifest.createdAt) - Date.parse(left.manifest.createdAt))[0];
}
function verifyDeployBackup(directory) {
    const manifestPath = path.join(directory, 'manifest.json');
    try {
        const manifestStats = fs.lstatSync(manifestPath);
        if (!manifestStats.isFile() || manifestStats.isSymbolicLink())
            return undefined;
        const manifestContent = fs.readFileSync(manifestPath);
        const value = JSON.parse(manifestContent.toString('utf8'));
        if (!(0, objects_1.isRecord)(value)
            || value.status !== 'complete'
            || typeof value.createdAt !== 'string'
            || !Number.isFinite(Date.parse(value.createdAt))
            || !Array.isArray(value.files)
            || value.files.length === 0)
            return undefined;
        const seenPaths = new Set();
        const files = [];
        for (const entry of value.files) {
            const file = verifyDeployBackupFile(directory, entry);
            if (!file || seenPaths.has(file.originalPath))
                return undefined;
            seenPaths.add(file.originalPath);
            files.push(file);
        }
        return {
            directory,
            manifest: { createdAt: value.createdAt, status: 'complete', files },
            manifestHash: hashBuffer(manifestContent),
        };
    }
    catch {
        return undefined;
    }
}
function verifyDeployBackupFile(directory, value) {
    if (!(0, objects_1.isRecord)(value)
        || (value.action !== 'add' && value.action !== 'modify' && value.action !== 'delete')
        || typeof value.originalPath !== 'string'
        || !path.isAbsolute(value.originalPath))
        return undefined;
    const action = value.action;
    if (action === 'add') {
        if (value.backupPath !== undefined
            || value.beforeHash !== undefined
            || typeof value.afterHash !== 'string'
            || !SHA256_PATTERN.test(value.afterHash))
            return undefined;
        return { action, originalPath: value.originalPath, afterHash: value.afterHash };
    }
    if (typeof value.backupPath !== 'string'
        || typeof value.beforeHash !== 'string'
        || !SHA256_PATTERN.test(value.beforeHash)
        || (action === 'modify'
            ? typeof value.afterHash !== 'string' || !SHA256_PATTERN.test(value.afterHash)
            : value.afterHash !== undefined))
        return undefined;
    const sourcePath = resolveVerifiedBackupFile(directory, value.backupPath);
    if (!sourcePath || (0, files_1.hashFile)(sourcePath) !== value.beforeHash)
        return undefined;
    return {
        action,
        originalPath: value.originalPath,
        backupPath: value.backupPath,
        beforeHash: value.beforeHash,
        ...(action === 'modify' ? { afterHash: value.afterHash } : {}),
    };
}
function resolveVerifiedBackupFile(directory, backupPath) {
    const sourcePath = path.resolve(directory, backupPath);
    if (!isContainedPath(directory, sourcePath))
        return undefined;
    const stats = fs.lstatSync(sourcePath);
    if (!stats.isFile() || stats.isSymbolicLink())
        return undefined;
    const realDirectory = fs.realpathSync(directory);
    const realSource = fs.realpathSync(sourcePath);
    return isContainedPath(realDirectory, realSource) ? sourcePath : undefined;
}
function isContainedPath(root, candidate) {
    const relative = path.relative(root, candidate);
    return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}
function currentFileHash(targetPath) {
    let stats;
    try {
        stats = fs.lstatSync(targetPath);
    }
    catch (error) {
        if (isMissingPathError(error))
            return MISSING_HASH;
        throw error;
    }
    if (!stats.isFile() || stats.isSymbolicLink()) {
        return hashText(`<unsupported:${stats.mode}>`);
    }
    return (0, files_1.hashFile)(targetPath);
}
function isMissingPathError(error) {
    return (0, objects_1.isRecord)(error) && error.code === 'ENOENT';
}
function stableRestoreId(action, targetPath) {
    return `restore-${hashText(`${action}\0${targetPath}`).slice(0, 16)}`;
}
function failedRestorePlan(operationId, repositoryPath, code, message, nextActions, technicalDetails) {
    const error = { code, message, technicalDetails, nextActions };
    return {
        schemaVersion: contracts_1.OPERATION_SCHEMA_VERSION,
        operation: 'restore',
        status: 'failed',
        readyToApply: false,
        operationId,
        preconditions: {},
        repositoryPath,
        backup: null,
        changes: [],
        issues: [{ severity: 'error', code, message }],
        nextActions,
        error,
    };
}
function freezeRestorePlan(plan) {
    if (plan.backup)
        Object.freeze(plan.backup);
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
    return Object.freeze(plan);
}
function hashBuffer(value) {
    return crypto.createHash('sha256').update(value).digest('hex');
}
function hashText(value) {
    return crypto.createHash('sha256').update(value).digest('hex');
}
function errorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}
