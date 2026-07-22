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
exports.createDeployPlan = createDeployPlan;
exports.applyDeployPlan = applyDeployPlan;
const crypto = __importStar(require("crypto"));
const buffer_1 = require("buffer");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const uuid_1 = require("uuid");
const adapters_1 = require("../adapters");
const overlay_policies_1 = require("../adapters/overlay-policies");
const files_1 = require("../utils/files");
const objects_1 = require("../utils/objects");
const repository_1 = require("../utils/repository");
const sanitize_1 = require("../utils/sanitize");
const state_1 = require("../utils/state");
const structured_config_1 = require("../utils/structured-config");
const variables_1 = require("../utils/variables");
const deploy_skills_1 = require("../utils/deploy-skills");
const contracts_1 = require("./contracts");
const activeDeployPlans = new WeakMap();
async function createDeployPlan(context) {
    const operationId = (0, uuid_1.v4)();
    let repositoryPath = null;
    try {
        repositoryPath = (0, repository_1.resolveBoundRepository)(context);
        const mutations = new Map();
        const plan = await buildDeployPlan(context, repositoryPath, operationId, mutations);
        registerDeployPlan(plan, mutations);
        return plan;
    }
    catch {
        return freezeDeployPlan({
            schemaVersion: contracts_1.OPERATION_SCHEMA_VERSION,
            operation: 'deploy',
            status: 'failed',
            readyToApply: false,
            operationId,
            preconditions: {},
            repositoryPath,
            changes: [],
            issues: [{
                    severity: 'error',
                    code: 'deploy.planFailed',
                    message: 'The Deploy Plan could not be generated safely.',
                }],
            nextActions: ['Fix the reported Repository or IDE configuration problem, then regenerate the Deploy Plan.'],
            error: {
                code: 'deploy.planFailed',
                message: 'The Deploy Plan could not be generated safely.',
                nextActions: ['Fix the Repository or IDE configuration problem, then regenerate the Deploy Plan.'],
            },
        });
    }
}
async function buildDeployPlan(context, repositoryPath, operationId, mutations) {
    const manifest = (0, repository_1.readManifest)(repositoryPath);
    const definitions = (0, adapters_1.createAdapterDefinitions)().filter(({ targetId }) => manifest.targets[targetId]?.enabled === true);
    if (definitions.length === 0) {
        return {
            schemaVersion: contracts_1.OPERATION_SCHEMA_VERSION,
            operation: 'deploy',
            status: 'planned',
            readyToApply: true,
            operationId,
            preconditions: {},
            repositoryPath,
            changes: [],
            issues: [{
                    severity: 'notice',
                    code: 'deploy.noEnabledTargets',
                    message: 'No IDE targets are enabled in this Repository.',
                }],
            nextActions: ['Enable at least one IDE target in mcv.yaml before deploying configuration.'],
        };
    }
    const deployContext = {
        ...context,
        variables: resolveManifestVariables(manifest.variables, context, repositoryPath),
    };
    const desired = (await Promise.all(definitions.map(async (definition) => {
        const operation = await definition.adapter.deploy(repositoryPath, deployContext);
        return operation.files.flatMap((file) => {
            const semantics = inferDeploymentSemantics(file.targetPath, definition.targetId, repositoryPath, context);
            return semantics.capabilities.map((capability) => ({
                ...file,
                ide: ideName(definition.targetId),
                capability,
                strategy: semantics.strategy,
            }));
        });
    }))).flat();
    const issues = [];
    const safeDesired = desired.filter((file) => {
        const linkPath = (0, files_1.findSymbolicLinkAncestor)(file.targetPath);
        if (!linkPath)
            return true;
        issues.push({
            severity: 'warning',
            code: `deploy.symbolicLinkSkipped.${issues.length + 1}`,
            message: `A target beneath a symbolic link was excluded: ${file.targetPath}.`,
            details: `Symbolic link ancestor: ${linkPath}`,
        });
        return false;
    });
    const changes = safeDesired.flatMap((file) => {
        const previous = fs.existsSync(file.targetPath) ? fs.readFileSync(file.targetPath) : undefined;
        const next = toBuffer(file.content);
        if (previous?.equals(next))
            return [];
        const filePreview = preview(file.targetPath, file.ide, file.capability, next, previous, issues);
        if (filePreview.kind === 'text' && filePreview.diff.length === 0)
            return [];
        const change = previous === undefined ? 'add' : 'modify';
        const id = selectionId(file.ide, file.capability, file.targetPath);
        mutations.set(id, { content: next });
        return [{
                id,
                ide: file.ide,
                capability: file.capability,
                name: displayName(file.targetPath, file.capability),
                targetPath: file.targetPath,
                change,
                defaultSelected: true,
                group: 'standard',
                strategy: file.strategy,
                preview: filePreview,
            }];
    });
    const legacyDuplicates = (0, deploy_skills_1.findLegacyCodexSkillDuplicates)(context, safeDesired, definitions.some(({ targetId }) => targetId === 'codex'));
    if (legacyDuplicates.names.length > 0) {
        issues.push({
            severity: 'notice',
            code: 'deploy.legacyCodexSkillDuplicates',
            message: `[duplicate:codex-legacy] ${legacyDuplicates.names.join(', ')}; review the Advanced Cleanup candidates.`,
        });
        for (const targetPath of legacyDuplicates.files) {
            changes.push({
                id: selectionId('codex', 'skills', targetPath),
                ide: 'codex',
                capability: 'skills',
                name: displayName(targetPath, 'skills'),
                targetPath,
                change: 'delete',
                defaultSelected: false,
                group: 'advanced',
                strategy: 'replace-entire-file',
                preview: preview(targetPath, 'codex', 'skills', Buffer.alloc(0), fs.readFileSync(targetPath), issues),
            });
            mutations.set(selectionId('codex', 'skills', targetPath), {});
        }
    }
    const sourcePreconditions = new Map();
    const desiredPaths = new Set(safeDesired.map((file) => path.resolve(file.targetPath)));
    const managedInventory = (0, state_1.readState)(context).managedInventory ?? {};
    for (const [targetPath, inventoryEntry] of Object.entries(managedInventory)) {
        if (desiredPaths.has(path.resolve(targetPath)) || !fs.existsSync(targetPath))
            continue;
        const ide = inferIde(targetPath, context);
        if (!ide)
            continue;
        const semantics = inferDeploymentSemantics(targetPath, targetIdForIde(ide), repositoryPath, context);
        const capability = semantics.capabilities[0];
        if (semantics.strategy !== 'replace-entire-file' || !capability)
            continue;
        const deletion = {
            id: selectionId(ide, capability, targetPath),
            ide,
            capability,
            name: displayName(targetPath, capability),
            targetPath,
            change: 'delete',
            defaultSelected: false,
            group: 'advanced',
            strategy: semantics.strategy,
            preview: preview(targetPath, ide, capability, Buffer.alloc(0), fs.readFileSync(targetPath), issues),
        };
        changes.push(deletion);
        mutations.set(deletion.id, {});
        sourcePreconditions.set(deletion.id, hashText(stableValue(inventoryEntry)));
    }
    changes.sort(compareChanges);
    const repositorySourceHash = hashRepositoryInputs(repositoryPath);
    const preconditions = Object.fromEntries(changes.flatMap((change) => {
        return [
            [`source:${change.id}`, sourcePreconditions.get(change.id) ?? repositorySourceHash],
            [`target:${change.id}`, fs.existsSync(change.targetPath) ? (0, files_1.hashFile)(change.targetPath) : hashText('<missing>')],
        ];
    }));
    const blocked = issues.some((issue) => issue.severity === 'decisionRequired' || issue.severity === 'error');
    return {
        schemaVersion: contracts_1.OPERATION_SCHEMA_VERSION,
        operation: 'deploy',
        status: 'planned',
        readyToApply: !blocked,
        operationId,
        preconditions,
        repositoryPath,
        changes,
        issues,
        nextActions: blocked
            ? ['Resolve every decisionRequired or error Issue, then regenerate the Deploy Plan.']
            : [],
    };
}
function registerDeployPlan(plan, mutations) {
    freezeDeployPlan(plan);
    activeDeployPlans.set(plan, { operationId: plan.operationId, mutations });
}
async function applyDeployPlan(context, plan, selection, options = {}) {
    if (plan.status === 'failed')
        return failedDeployResult(plan.repositoryPath, plan.error, plan.issues);
    const active = activeDeployPlans.get(plan);
    if (!active || active.operationId !== plan.operationId) {
        return failedDeployResult(plan.repositoryPath, invalidPlanError());
    }
    const selectedIds = [...new Set(selection.changeIds)];
    const knownIds = new Set(plan.changes.map((change) => change.id));
    if (selectedIds.some((id) => !knownIds.has(id))) {
        return failedDeployResult(plan.repositoryPath, {
            code: 'deploy.invalidSelection',
            message: 'The Deploy selection contains an ID that is not in the active Plan.',
            nextActions: ['Choose only change IDs from the current Deploy Plan.'],
        });
    }
    const selected = new Set(selectedIds);
    const blocking = deployBlockingIssues(plan, selection, options);
    if (blocking.length > 0)
        return blockedDeployResult(plan, blocking);
    if (!plan.repositoryPath || (0, repository_1.resolveBoundRepository)(context) !== plan.repositoryPath) {
        activeDeployPlans.delete(plan);
        return failedDeployResult(plan.repositoryPath, stalePlanError());
    }
    let freshPlan;
    try {
        freshPlan = await buildDeployPlan(context, plan.repositoryPath, plan.operationId, new Map());
    }
    catch {
        activeDeployPlans.delete(plan);
        return failedDeployResult(plan.repositoryPath, stalePlanError());
    }
    if (!sameDeploySnapshot(plan, freshPlan)) {
        activeDeployPlans.delete(plan);
        return failedDeployResult(plan.repositoryPath, stalePlanError());
    }
    const selectedChanges = plan.changes.filter((change) => selected.has(change.id));
    const prepared = prepareDeployWrites(selectedChanges, active.mutations);
    if (selectedChanges.length === 0) {
        try {
            updateDeployState(context, plan.repositoryPath, selectedChanges);
        }
        catch (error) {
            activeDeployPlans.delete(plan);
            return failedDeployResult(plan.repositoryPath, {
                code: 'deploy.stateUpdateFailed',
                message: 'Deploy could not record the successful empty selection in device state.',
                technicalDetails: errorMessage(error),
                nextActions: ['Check local state storage permissions, then generate a new Deploy Plan.'],
            });
        }
        activeDeployPlans.delete(plan);
        return {
            schemaVersion: contracts_1.OPERATION_SCHEMA_VERSION,
            operation: 'deploy',
            status: 'succeeded',
            repositoryPath: plan.repositoryPath,
            changes: [],
            issues: [],
            nextActions: [],
            data: { appliedChangeIds: [], writtenPaths: [], deletedPaths: [] },
        };
    }
    let backupPath;
    try {
        backupPath = createDeployBackup(context, plan, selectedChanges, options.copyFile ?? fs.copyFileSync);
    }
    catch (error) {
        activeDeployPlans.delete(plan);
        if (error instanceof StaleDeployPlanError) {
            return failedDeployResult(plan.repositoryPath, stalePlanError(error.message));
        }
        return failedDeployResult(plan.repositoryPath, {
            code: 'deploy.backupFailed',
            message: 'Deploy could not create and verify every selected backup before writing.',
            technicalDetails: errorMessage(error),
            nextActions: ['Check local state storage and target file permissions, then generate a new Deploy Plan.'],
        });
    }
    try {
        assertSelectedPreconditions(context, plan, selectedChanges);
        applyPreparedDeployWrites(prepared, backupPath, options.writeFile ?? ((targetPath, content) => (0, files_1.atomicWriteFile)(targetPath, content)), options.removeFile ?? ((targetPath) => fs.rmSync(targetPath, { force: true })), options.restoreFile ?? ((targetPath, content) => (0, files_1.atomicWriteFile)(targetPath, content)), () => {
            finalizeDeployBackup(backupPath);
            updateDeployState(context, plan.repositoryPath, selectedChanges);
        });
        activeDeployPlans.delete(plan);
        return {
            schemaVersion: contracts_1.OPERATION_SCHEMA_VERSION,
            operation: 'deploy',
            status: 'succeeded',
            repositoryPath: plan.repositoryPath,
            changes: selectedChanges,
            issues: [],
            nextActions: [],
            data: {
                appliedChangeIds: selectedIds,
                writtenPaths: prepared.filter((item) => item.change === 'write').map((item) => item.targetPath),
                deletedPaths: prepared.filter((item) => item.change === 'delete').map((item) => item.targetPath),
                backupPath,
            },
        };
    }
    catch (error) {
        activeDeployPlans.delete(plan);
        markDeployBackupFailed(backupPath, error);
        if (error instanceof StaleDeployPlanError) {
            return failedDeployResult(plan.repositoryPath, stalePlanError(error.message));
        }
        if (error instanceof DeployRollbackError) {
            return failedDeployResult(plan.repositoryPath, {
                code: 'deploy.rollbackFailed',
                message: 'Deploy failed and could not fully restore the selected device configuration.',
                technicalDetails: error.message,
                nextActions: [`Restore the affected files from ${backupPath}, then generate a new Deploy Plan.`],
            });
        }
        return failedDeployResult(plan.repositoryPath, {
            code: 'deploy.transactionFailed',
            message: 'Deploy could not commit the selected changes and restored the device configuration.',
            technicalDetails: errorMessage(error),
            nextActions: ['Check target permissions, then generate and review a new Deploy Plan.'],
        });
    }
}
function deployBlockingIssues(plan, selection, options) {
    if (options.nonInteractive) {
        const unsafe = plan.issues.some((issue) => issue.severity !== 'notice')
            || plan.changes.some((change) => change.change === 'delete');
        return unsafe ? [{
                severity: 'decisionRequired',
                code: 'deploy.nonInteractiveBlocked',
                message: 'Non-interactive Deploy cannot apply warnings, decisions, errors, or deletions.',
            }] : [];
    }
    const confirmed = new Set(selection.confirmedIssueCodes ?? []);
    const warnings = plan.issues.filter((issue) => issue.severity === 'warning' && !confirmed.has(issue.code));
    if (warnings.length > 0)
        return warnings;
    return plan.issues.filter((issue) => issue.severity === 'decisionRequired' || issue.severity === 'error');
}
function sameDeploySnapshot(left, right) {
    return left.repositoryPath === right.repositoryPath
        && stableValue(left.preconditions) === stableValue(right.preconditions)
        && stableValue(left.changes.map(deploySnapshotChange))
            === stableValue(right.changes.map(deploySnapshotChange))
        && stableValue(left.issues.map((issue) => [issue.severity, issue.code]))
            === stableValue(right.issues.map((issue) => [issue.severity, issue.code]));
}
function deploySnapshotChange(change) {
    return {
        id: change.id,
        change: change.change,
        capability: change.capability,
        targetPath: change.targetPath,
        preview: change.preview,
    };
}
function prepareDeployWrites(changes, mutations) {
    const grouped = new Map();
    for (const change of changes) {
        grouped.set(change.targetPath, [...(grouped.get(change.targetPath) ?? []), change]);
    }
    return [...grouped].map(([targetPath, targetChanges]) => {
        if (targetChanges.some((change) => change.change === 'delete')) {
            return { targetPath, change: 'delete' };
        }
        const mutation = mutations.get(targetChanges[0].id);
        if (!mutation?.content)
            throw new Error(`Missing active Deploy mutation for ${targetChanges[0].id}.`);
        return {
            targetPath,
            change: 'write',
            content: composeSelectedContent(targetPath, targetChanges, mutation.content),
        };
    });
}
function composeSelectedContent(targetPath, changes, desiredContent) {
    if (changes.some((change) => change.strategy === 'replace-entire-file')) {
        return Buffer.from(desiredContent);
    }
    const format = structuredFormat(targetPath);
    if (!format)
        return Buffer.from(desiredContent);
    const current = fs.existsSync(targetPath)
        ? (0, structured_config_1.parseStructuredObject)(fs.readFileSync(targetPath, 'utf8'), format, targetPath)
        : {};
    const desired = (0, structured_config_1.parseStructuredObject)(desiredContent.toString('utf8'), format, targetPath);
    const selectedCapabilities = new Set(changes.map((change) => change.capability));
    const managedKey = managedTopLevelKey(changes[0].ide);
    const result = { ...current };
    if (selectedCapabilities.has('mcp'))
        copyStructuredKey(desired, result, managedKey);
    if (selectedCapabilities.has('native')) {
        for (const key of new Set([...Object.keys(current), ...Object.keys(desired)])) {
            if (key !== managedKey)
                copyStructuredKey(desired, result, key);
        }
    }
    return Buffer.from((0, structured_config_1.stringifyStructuredObject)(result, format));
}
function copyStructuredKey(source, target, key) {
    if (key in source)
        target[key] = source[key];
    else
        delete target[key];
}
function createDeployBackup(context, plan, changes, copyFile) {
    assertSelectedPreconditions(context, plan, changes);
    const backupRoot = path.join(path.dirname((0, state_1.getStateFilePath)(context)), 'backups');
    fs.mkdirSync(backupRoot, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = fs.mkdtempSync(path.join(backupRoot, `${timestamp}-`));
    const filesPath = path.join(backupPath, 'files');
    fs.mkdirSync(filesPath);
    try {
        const files = changes.map((change, index) => {
            const expected = plan.preconditions[`target:${change.id}`];
            if (change.change === 'add') {
                if (fs.existsSync(change.targetPath))
                    throw new StaleDeployPlanError('A selected add target appeared during backup.');
                return { changeId: change.id, action: change.change, originalPath: change.targetPath };
            }
            const relativeBackupPath = path.join('files', `${index}-${path.basename(change.targetPath)}`);
            const copiedPath = path.join(backupPath, relativeBackupPath);
            copyFile(change.targetPath, copiedPath);
            if ((0, files_1.hashFile)(copiedPath) !== expected || (0, files_1.hashFile)(change.targetPath) !== expected) {
                throw new StaleDeployPlanError('A selected target changed while its backup was being verified.');
            }
            return {
                changeId: change.id,
                action: change.change,
                originalPath: change.targetPath,
                backupPath: relativeBackupPath,
                beforeHash: expected,
            };
        });
        const manifest = {
            createdAt: new Date().toISOString(),
            status: 'pending',
            files,
        };
        (0, files_1.atomicWriteFile)(path.join(backupPath, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
        return backupPath;
    }
    catch (error) {
        fs.rmSync(backupPath, { recursive: true, force: true });
        throw error;
    }
}
function assertSelectedPreconditions(context, plan, changes) {
    const repositoryHash = plan.repositoryPath ? hashRepositoryInputs(plan.repositoryPath) : undefined;
    const inventory = (0, state_1.readState)(context).managedInventory ?? {};
    for (const change of changes) {
        const targetHash = fs.existsSync(change.targetPath)
            ? (0, files_1.hashFile)(change.targetPath)
            : hashText('<missing>');
        const sourceHash = change.change === 'delete' && inventory[change.targetPath] !== undefined
            ? hashText(stableValue(inventory[change.targetPath]))
            : repositoryHash;
        if (targetHash !== plan.preconditions[`target:${change.id}`]
            || sourceHash !== plan.preconditions[`source:${change.id}`]) {
            throw new StaleDeployPlanError('Deploy source or target state changed after the Plan was reviewed.');
        }
    }
}
function applyPreparedDeployWrites(writes, backupPath, writeFile, removeFile, restoreFile, commit) {
    const attemptedPaths = new Set();
    try {
        for (const write of writes) {
            attemptedPaths.add(write.targetPath);
            if (write.change === 'delete')
                removeFile(write.targetPath);
            else
                writeFile(write.targetPath, write.content);
        }
        commit();
    }
    catch (error) {
        const rollbackErrors = rollbackDeployWrites(backupPath, attemptedPaths, removeFile, restoreFile);
        if (rollbackErrors.length > 0) {
            throw new DeployRollbackError(`${errorMessage(error)} Rollback was incomplete: ${rollbackErrors.join('; ')}`);
        }
        throw error;
    }
}
function rollbackDeployWrites(backupPath, attemptedPaths, removeFile, restoreFile) {
    const manifest = readDeployBackupManifest(backupPath);
    const entriesByPath = new Map();
    for (const entry of manifest.files) {
        if (attemptedPaths.has(entry.originalPath) && !entriesByPath.has(entry.originalPath)) {
            entriesByPath.set(entry.originalPath, entry);
        }
    }
    const errors = [];
    for (const entry of [...entriesByPath.values()].reverse()) {
        try {
            if (!entry.backupPath)
                removeFile(entry.originalPath);
            else
                restoreFile(entry.originalPath, fs.readFileSync(path.join(backupPath, entry.backupPath)));
        }
        catch (error) {
            errors.push(`${entry.originalPath}: ${errorMessage(error)}`);
        }
    }
    return errors;
}
function finalizeDeployBackup(backupPath) {
    const manifest = readDeployBackupManifest(backupPath);
    for (const entry of manifest.files) {
        if (fs.existsSync(entry.originalPath))
            entry.afterHash = (0, files_1.hashFile)(entry.originalPath);
    }
    manifest.status = 'complete';
    manifest.completedAt = new Date().toISOString();
    (0, files_1.atomicWriteFile)(path.join(backupPath, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
}
function markDeployBackupFailed(backupPath, error) {
    try {
        const manifest = readDeployBackupManifest(backupPath);
        manifest.status = 'failed';
        manifest.failedAt = new Date().toISOString();
        manifest.error = errorMessage(error);
        (0, files_1.atomicWriteFile)(path.join(backupPath, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    }
    catch { /* Preserve the primary Deploy failure. */ }
}
function readDeployBackupManifest(backupPath) {
    return JSON.parse(fs.readFileSync(path.join(backupPath, 'manifest.json'), 'utf8'));
}
function updateDeployState(context, repositoryPath, changes) {
    const state = (0, state_1.readState)(context);
    const baselineFiles = { ...(state.baselineSnapshot?.files ?? {}) };
    const managedInventory = { ...(state.managedInventory ?? {}) };
    for (const change of changes) {
        if (change.change === 'delete' || !fs.existsSync(change.targetPath)) {
            delete baselineFiles[change.targetPath];
            delete managedInventory[change.targetPath];
        }
        else {
            const hash = (0, files_1.hashFile)(change.targetPath);
            baselineFiles[change.targetPath] = hash;
            managedInventory[change.targetPath] = { source: repositoryPath, hash };
        }
    }
    const lastDeploySelection = {};
    for (const change of changes) {
        const capabilities = lastDeploySelection[change.ide] ?? [];
        if (!capabilities.includes(change.capability))
            capabilities.push(change.capability);
        lastDeploySelection[change.ide] = capabilities;
    }
    state.baselineSnapshot = { recordedAt: new Date().toISOString(), files: baselineFiles };
    state.managedInventory = managedInventory;
    state.lastDeploySelection = lastDeploySelection;
    state.lastOperation = { kind: 'deploy', time: new Date().toISOString(), success: true };
    (0, state_1.writeState)(context, state);
}
class StaleDeployPlanError extends Error {
}
class DeployRollbackError extends Error {
}
function errorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}
function invalidPlanError() {
    return {
        code: 'operation.invalidPlan',
        message: 'The Deploy Plan is not the active in-process Plan.',
        nextActions: ['Generate and review a new Deploy Plan.'],
    };
}
function stalePlanError(technicalDetails) {
    return {
        code: 'operation.stalePlan',
        message: 'Deploy source or target state changed after the Plan was generated.',
        technicalDetails,
        nextActions: ['Generate and review a new Deploy Plan.'],
    };
}
function failedDeployResult(repositoryPath, error, issues = [{ severity: 'error', code: error.code, message: error.message }]) {
    return {
        schemaVersion: contracts_1.OPERATION_SCHEMA_VERSION,
        operation: 'deploy',
        status: 'failed',
        repositoryPath,
        changes: [],
        issues,
        nextActions: error.nextActions,
        error,
    };
}
function blockedDeployResult(plan, issues) {
    return {
        schemaVersion: contracts_1.OPERATION_SCHEMA_VERSION,
        operation: 'deploy',
        status: 'blocked',
        repositoryPath: plan.repositoryPath,
        changes: [],
        issues,
        nextActions: issues.some((issue) => issue.severity === 'warning')
            ? ['Confirm every warning explicitly before applying the Deploy Plan.']
            : ['Review and resolve the Deploy Plan interactively before applying it.'],
    };
}
function freezeDeployPlan(plan) {
    for (const change of plan.changes) {
        Object.freeze(change.preview);
        Object.freeze(change);
    }
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
function preview(targetPath, ide, capability, next, previous, issues) {
    const metadata = next.length === 0 && previous ? previous : next;
    if (!isText(next) || (previous !== undefined && !isText(previous))) {
        return { targetPath, kind: 'binary', bytes: metadata.length, sha256: hashBuffer(metadata) };
    }
    const diff = renderSafeDiff(targetPath, ide, capability, previous?.toString('utf8'), next.toString('utf8'));
    if ((0, sanitize_1.scanTextForSecrets)(diff).length > 0) {
        issues.push({
            severity: 'error',
            code: `deploy.unsafeDiffWithheld.${issues.length + 1}`,
            message: 'Unsafe plaintext content was withheld from the Deploy preview.',
        });
        return {
            targetPath,
            kind: 'text',
            bytes: metadata.length,
            sha256: hashBuffer(metadata),
            diff: '[unsafe text withheld]',
        };
    }
    return { targetPath, kind: 'text', bytes: metadata.length, sha256: hashBuffer(metadata), diff };
}
function renderSafeDiff(targetPath, ide, capability, previous, next) {
    if (next.length === 0 || capability === 'rules' || capability === 'skills') {
        return renderChangedLines(previous, next);
    }
    const format = structuredFormat(targetPath);
    if (!format)
        return renderChangedLines(previous, next);
    try {
        const before = previous === undefined ? {} : (0, structured_config_1.parseStructuredObject)(previous, format, targetPath);
        const after = (0, structured_config_1.parseStructuredObject)(next, format, targetPath);
        const managedKey = managedTopLevelKey(ide);
        const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])]
            .filter((key) => capability === 'mcp' ? key === managedKey : key !== managedKey)
            .filter((key) => stableValue(before[key]) !== stableValue(after[key]))
            .sort();
        return keys.flatMap((key) => {
            const changed = [];
            if (key in before)
                changed.push(`- ${key}: ${stableValue(before[key])}`);
            if (key in after)
                changed.push(`+ ${key}: ${stableValue(after[key])}`);
            return changed;
        }).join('\n');
    }
    catch {
        return renderChangedLines(previous, next);
    }
}
function structuredFormat(targetPath) {
    if (targetPath.endsWith('.json'))
        return 'json';
    if (targetPath.endsWith('.yaml') || targetPath.endsWith('.yml'))
        return 'yaml';
    if (targetPath.endsWith('.toml'))
        return 'toml';
    return undefined;
}
const MCP_PATH_BY_IDE = {
    codex: overlay_policies_1.CODEX_MCP_PATH,
    'claude-code': overlay_policies_1.CLAUDE_CODE_MCP_PATH,
    gemini: overlay_policies_1.GEMINI_MCP_PATH,
};
function managedTopLevelKey(ide) {
    return MCP_PATH_BY_IDE[ide].slice(2);
}
function stableValue(value) {
    if (Array.isArray(value))
        return `[${value.map(stableValue).join(',')}]`;
    if ((0, objects_1.isRecord)(value)) {
        return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableValue(value[key])}`).join(',')}}`;
    }
    if (value instanceof Date)
        return JSON.stringify(value.toISOString());
    return JSON.stringify(value);
}
function renderChangedLines(previous, next) {
    const before = previous === undefined ? [] : lines(previous);
    const after = lines(next);
    if (previous === undefined)
        return after.map((line) => `+ ${line}`).join('\n');
    if (next.length === 0)
        return before.map((line) => `- ${line}`).join('\n');
    const lengths = Array.from({ length: before.length + 1 }, () => new Array(after.length + 1).fill(0));
    for (let left = before.length - 1; left >= 0; left -= 1) {
        for (let right = after.length - 1; right >= 0; right -= 1) {
            lengths[left][right] = before[left] === after[right]
                ? lengths[left + 1][right + 1] + 1
                : Math.max(lengths[left + 1][right], lengths[left][right + 1]);
        }
    }
    const changed = [];
    let left = 0;
    let right = 0;
    while (left < before.length || right < after.length) {
        if (left < before.length && right < after.length && before[left] === after[right]) {
            left += 1;
            right += 1;
        }
        else if (right < after.length && (left === before.length || lengths[left][right + 1] >= lengths[left + 1][right])) {
            changed.push(`+ ${after[right]}`);
            right += 1;
        }
        else {
            changed.push(`- ${before[left]}`);
            left += 1;
        }
    }
    return changed.join('\n');
}
function inferDeploymentSemantics(targetPath, targetId, repositoryPath, context) {
    const normalized = targetPath.replace(/\\/g, '/');
    const base = path.basename(targetPath).toLowerCase();
    if (base === 'agents.md' || base === 'claude.md' || base === 'gemini.md') {
        return { capabilities: ['rules'], strategy: 'replace-entire-file' };
    }
    if (normalized.includes('/skills/')) {
        return { capabilities: ['skills'], strategy: 'replace-entire-file' };
    }
    if (base === 'keybindings.json') {
        return { capabilities: ['native'], strategy: 'replace-entire-file' };
    }
    const capabilities = [];
    if (nativeSourceExists(targetPath, targetId, repositoryPath, context))
        capabilities.push('native');
    if (isMcpTarget(targetPath, targetId, context))
        capabilities.push('mcp');
    return { capabilities: capabilities.length > 0 ? capabilities : ['native'], strategy: 'managed-merge' };
}
function nativeSourceExists(targetPath, targetId, repositoryPath, context) {
    const candidate = nativeRepositoryPath(targetPath, targetId, context);
    if (!candidate)
        return false;
    const platform = context.platform === 'win32' ? 'windows' : 'macos';
    return fs.existsSync(path.join(repositoryPath, 'overrides', platform, ...candidate.split('/')))
        || fs.existsSync(path.join(repositoryPath, ...candidate.split('/')))
        || (targetId === 'gemini'
            && candidate === 'ide/gemini/native/gemini-cli/settings.json'
            && fs.existsSync(path.join(repositoryPath, 'ide', 'gemini', 'native', 'settings.json')));
}
function nativeRepositoryPath(targetPath, targetId, context) {
    const resolved = path.resolve(targetPath);
    if (targetId === 'codex')
        return 'ide/codex/native/config.toml';
    if (targetId === 'claudeCode') {
        if (resolved === path.resolve(context.homeDir, '.claude.json'))
            return 'ide/claude-code/native/.claude.json';
        return 'ide/claude-code/native/settings.json';
    }
    const root = path.resolve(context.homeDir, '.gemini');
    const relative = path.relative(root, resolved).replace(/\\/g, '/');
    const mappings = {
        'settings.json': 'ide/gemini/native/gemini-cli/settings.json',
        'config/config.json': 'ide/gemini/native/antigravity/config.json',
        'config/mcp_config.json': 'ide/gemini/native/antigravity/mcp_config.json',
        'antigravity-cli/settings.json': 'ide/gemini/native/antigravity/cli-settings.json',
    };
    if (mappings[relative])
        return mappings[relative];
    if (path.basename(resolved) === 'settings.json')
        return 'ide/gemini/native/antigravity/ide-settings.json';
    if (path.basename(resolved) === 'keybindings.json')
        return 'ide/gemini/native/antigravity/keybindings.json';
    return undefined;
}
function isMcpTarget(targetPath, targetId, context) {
    if (targetId === 'codex') {
        return path.resolve(targetPath) === path.resolve(context.env.CODEX_HOME || path.join(context.homeDir, '.codex'), 'config.toml');
    }
    if (targetId === 'claudeCode')
        return path.basename(targetPath) === '.claude.json';
    return path.basename(targetPath) === 'mcp_config.json'
        || path.resolve(targetPath) === path.resolve(context.homeDir, '.gemini', 'settings.json');
}
function selectionId(ide, capability, targetPath) {
    return `deploy-${hashText(`${ide}\0${capability}\0${path.resolve(targetPath)}`).slice(0, 16)}`;
}
function displayName(targetPath, capability) {
    if (capability === 'rules')
        return 'Shared Rules';
    if (capability === 'skills') {
        const segments = targetPath.replace(/\\/g, '/').split('/');
        const skillIndex = segments.lastIndexOf('skills');
        return segments[skillIndex + 1] ?? path.basename(targetPath);
    }
    if (capability === 'mcp')
        return 'MCP';
    return path.basename(targetPath);
}
function compareChanges(left, right) {
    const groupOrder = { standard: 0, advanced: 1 };
    const capabilityOrder = {
        rules: 0, skills: 1, mcp: 2, native: 3,
    };
    return groupOrder[left.group] - groupOrder[right.group]
        || left.ide.localeCompare(right.ide)
        || capabilityOrder[left.capability] - capabilityOrder[right.capability]
        || left.targetPath.localeCompare(right.targetPath);
}
function ideName(targetId) {
    if (targetId === 'claudeCode')
        return 'claude-code';
    return targetId;
}
function targetIdForIde(ide) {
    return ide === 'claude-code' ? 'claudeCode' : ide;
}
function inferIde(targetPath, context) {
    const resolved = path.resolve(targetPath);
    const roots = [
        ['codex', path.resolve(context.env.CODEX_HOME || path.join(context.homeDir, '.codex'))],
        ['codex', path.resolve(context.homeDir, '.agents', 'skills')],
        ['claude-code', path.resolve(context.env.CLAUDE_CONFIG_DIR || path.join(context.homeDir, '.claude'))],
        ['claude-code', path.resolve(context.homeDir, '.claude.json')],
        ['gemini', path.resolve(context.homeDir, '.gemini')],
    ];
    return roots.find(([, root]) => resolved === root || resolved.startsWith(`${root}${path.sep}`))?.[0];
}
function resolveManifestVariables(declarations, context, repositoryPath) {
    const platformKey = context.platform === 'win32'
        ? 'windows'
        : context.platform === 'darwin'
            ? 'macos'
            : 'linux';
    const definitions = {};
    for (const [name, declaration] of Object.entries(declarations ?? {})) {
        const value = typeof declaration === 'string'
            ? declaration
            : (0, objects_1.isRecord)(declaration) && typeof declaration[platformKey] === 'string'
                ? declaration[platformKey]
                : undefined;
        if (value !== undefined)
            definitions[name] = value;
    }
    return (0, variables_1.resolveVariableDefinitions)(definitions, {
        ...context.variables,
        HOME: context.homeDir,
        MCV_REPO: repositoryPath,
    }, context.platform);
}
function toBuffer(value) {
    return Buffer.isBuffer(value) ? Buffer.from(value) : Buffer.from(value);
}
function isText(value) {
    return value.length === 0 || ((0, buffer_1.isUtf8)(value) && !value.includes(0));
}
function lines(value) {
    const result = value.replace(/\r\n?/g, '\n').split('\n');
    if (result.at(-1) === '')
        result.pop();
    return result;
}
function hashBuffer(value) {
    return crypto.createHash('sha256').update(value).digest('hex');
}
function hashText(value) {
    return hashBuffer(Buffer.from(value));
}
function hashRepositoryInputs(repositoryPath) {
    const hash = crypto.createHash('sha256');
    const visit = (current) => {
        const relative = path.relative(repositoryPath, current).replace(/\\/g, '/');
        if (!fs.existsSync(current)) {
            hash.update(`missing\0${relative}\0`);
            return;
        }
        const stat = fs.lstatSync(current);
        if (stat.isSymbolicLink()) {
            hash.update(`symlink\0${relative}\0${fs.readlinkSync(current)}\0`);
            return;
        }
        if (stat.isDirectory()) {
            hash.update(`directory\0${relative}\0`);
            for (const entry of fs.readdirSync(current).sort())
                visit(path.join(current, entry));
            return;
        }
        hash.update(`file\0${relative}\0`);
        hash.update(fs.readFileSync(current));
        hash.update('\0');
    };
    visit(path.join(repositoryPath, 'mcv.yaml'));
    visit(path.join(repositoryPath, 'common'));
    visit(path.join(repositoryPath, 'ide'));
    visit(path.join(repositoryPath, 'overrides'));
    return hash.digest('hex');
}
