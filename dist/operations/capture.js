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
exports.createCapturePlan = createCapturePlan;
exports.applyCapturePlan = applyCapturePlan;
const crypto = __importStar(require("crypto"));
const buffer_1 = require("buffer");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const uuid_1 = require("uuid");
const yaml = __importStar(require("yaml"));
const adapters_1 = require("../adapters");
const skills_1 = require("../core/skills");
const objects_1 = require("../utils/objects");
const repository_1 = require("../utils/repository");
const sanitize_1 = require("../utils/sanitize");
const structured_config_1 = require("../utils/structured-config");
const contracts_1 = require("./contracts");
const activeCapturePlans = new WeakMap();
const EMPTY_SUMMARY = {
    sensitiveFieldCount: 0,
    parameterizedPathCount: 0,
    excludedFileCount: 0,
};
async function createCapturePlan(context) {
    const operationId = (0, uuid_1.v4)();
    let repositoryPath = null;
    try {
        repositoryPath = (0, repository_1.resolveBoundRepository)(context);
        const mutations = new Map();
        const plan = await buildCapturePlan(context, repositoryPath, operationId, mutations);
        registerCapturePlan(plan, mutations);
        return plan;
    }
    catch {
        return {
            schemaVersion: contracts_1.OPERATION_SCHEMA_VERSION,
            operation: 'capture',
            status: 'failed',
            readyToApply: false,
            operationId,
            preconditions: {},
            repositoryPath,
            changes: [],
            issues: [{
                    severity: 'error',
                    code: 'capture.planFailed',
                    message: 'The Capture Plan could not be generated safely.',
                }],
            nextActions: ['Fix the reported Repository or IDE configuration problem, then regenerate the Capture Plan.'],
            error: {
                code: 'capture.planFailed',
                message: 'The Capture Plan could not be generated safely.',
                nextActions: ['Fix the Repository or IDE configuration problem, then regenerate the Capture Plan.'],
            },
            summary: EMPTY_SUMMARY,
        };
    }
}
async function buildCapturePlan(context, repositoryPath, operationId, mutations) {
    const manifest = (0, repository_1.readManifest)(repositoryPath);
    const definitions = (0, adapters_1.createAdapterDefinitions)().filter(({ targetId }) => manifest.targets[targetId]?.enabled === true);
    if (definitions.length === 0) {
        return {
            schemaVersion: contracts_1.OPERATION_SCHEMA_VERSION,
            operation: 'capture',
            status: 'planned',
            readyToApply: true,
            operationId,
            preconditions: {},
            repositoryPath,
            changes: [],
            issues: [{
                    severity: 'notice',
                    code: 'capture.noEnabledTargets',
                    message: 'No IDE targets are enabled in this Repository.',
                }],
            nextActions: ['Enable at least one IDE target in mcv.yaml before capturing configuration.'],
            summary: EMPTY_SUMMARY,
        };
    }
    const captureContext = {
        ...context,
        variables: resolveManifestVariables(manifest.variables, context),
    };
    const captured = await Promise.all(definitions.map(async (definition) => {
        const discovered = await definition.adapter.discoverFiles(captureContext);
        const result = await definition.adapter.capture(discovered, captureContext);
        return { definition, discovered, result };
    }));
    const issues = captured.flatMap(({ result }, resultIndex) => result.warnings.map((_warning, warningIndex) => ({
        severity: 'warning',
        code: `capture.sourceSkipped.${resultIndex + 1}.${warningIndex + 1}`,
        message: 'A source item was skipped because it could not be processed safely.',
    })));
    const sourcedFiles = captured.flatMap(({ definition, result }) => result.files.map((file) => ({
        ...file,
        ide: ideName(definition.targetId),
        surface: surfaceName(file.repositoryPath, definition.targetId),
    })));
    const skills = (0, skills_1.collectSkills)((0, skills_1.getSkillSources)(captureContext, {
        codex: manifest.targets.codex?.enabled === true,
        claudeCode: manifest.targets.claudeCode?.enabled === true,
        gemini: manifest.targets.gemini?.enabled === true,
    }));
    for (let index = 0; index < skills.warnings.length; index += 1) {
        issues.push({
            severity: 'warning',
            code: `capture.skillSkipped.${index + 1}`,
            message: 'A Skill source item was skipped because it could not be processed safely.',
        });
    }
    const summary = captured.reduce((total, { result }) => ({
        sensitiveFieldCount: total.sensitiveFieldCount + result.summary.sensitiveFieldCount,
        parameterizedPathCount: total.parameterizedPathCount + result.summary.parameterizedPathCount,
        excludedFileCount: total.excludedFileCount + result.summary.excludedFileCount,
    }), {
        ...EMPTY_SUMMARY,
        excludedFileCount: skills.excludedFileCount,
    });
    const changes = [];
    const plannedRepositoryPaths = new Set();
    addRulesChange(repositoryPath, sourcedFiles, changes, issues, plannedRepositoryPaths, mutations);
    addMcpChanges(repositoryPath, sourcedFiles, changes, issues, plannedRepositoryPaths, mutations);
    addFileChanges(repositoryPath, sourcedFiles, changes, issues, plannedRepositoryPaths, mutations);
    addSkillChanges(repositoryPath, skills.packages, changes, issues, plannedRepositoryPaths, mutations);
    addRepositoryDeletionChanges(repositoryPath, definitions.map(({ targetId }) => targetId), sourcedFiles, skills.packages, changes, issues, plannedRepositoryPaths, mutations);
    const rawSourceHash = hashSourcePaths([
        ...captured.flatMap(({ discovered }) => discovered.map((file) => file.path)),
        ...[...skills.packages.values()].flatMap((copies) => copies.flatMap((skill) => skill.files.map((file) => path.join(skill.directory, file.relativePath)))),
    ]);
    for (const mutation of mutations.values())
        mutation.sourceHash = rawSourceHash;
    changes.sort(compareChanges);
    const preconditions = {
        sourceSnapshot: rawSourceHash,
        ...Object.fromEntries(changes.flatMap((change) => [
            [`source:${change.id}`, mutations.get(change.id)?.sourceHash ?? hashText('<missing>')],
            [`target:${change.id}`, hashRepositoryPaths(repositoryPath, change.repositoryPaths)],
        ])),
    };
    const blocked = issues.some((issue) => issue.severity === 'decisionRequired' || issue.severity === 'error');
    return {
        schemaVersion: contracts_1.OPERATION_SCHEMA_VERSION,
        operation: 'capture',
        status: 'planned',
        readyToApply: !blocked,
        operationId,
        preconditions,
        repositoryPath,
        changes,
        issues,
        nextActions: blocked
            ? ['Resolve every decisionRequired or error Issue, then regenerate the Capture Plan.']
            : [],
        summary,
    };
}
async function applyCapturePlan(context, plan, selection, options = {}) {
    if (plan.status === 'failed')
        return failedCaptureResult(plan.repositoryPath, plan.error, plan.issues);
    const active = activeCapturePlans.get(plan);
    if (!active || active.operationId !== plan.operationId) {
        return failedCaptureResult(plan.repositoryPath, invalidPlanError());
    }
    const selectedIds = [...new Set(selection.changeIds)];
    const knownIds = new Set(plan.changes.map((change) => change.id));
    if (selectedIds.some((id) => !knownIds.has(id))) {
        return failedCaptureResult(plan.repositoryPath, {
            code: 'capture.invalidSelection',
            message: 'The Capture selection contains an ID that is not in the active Plan.',
            nextActions: ['Choose only change IDs from the current Capture Plan.'],
        });
    }
    const selected = new Set(selectedIds);
    const blocking = captureBlockingIssues(plan, selected, selection, options);
    if (blocking.length > 0) {
        return blockedCaptureResult(plan, blocking);
    }
    if (!plan.repositoryPath || (0, repository_1.resolveBoundRepository)(context) !== plan.repositoryPath) {
        activeCapturePlans.delete(plan);
        return failedCaptureResult(plan.repositoryPath, stalePlanError());
    }
    let freshPlan;
    try {
        freshPlan = await buildCapturePlan(context, plan.repositoryPath, plan.operationId, new Map());
    }
    catch {
        activeCapturePlans.delete(plan);
        return failedCaptureResult(plan.repositoryPath, stalePlanError());
    }
    if (!sameCaptureSnapshot(plan, freshPlan)) {
        activeCapturePlans.delete(plan);
        return failedCaptureResult(plan.repositoryPath, stalePlanError());
    }
    const selectedChanges = plan.changes.filter((change) => selected.has(change.id));
    const selectedMutations = selectedChanges.map((change) => active.mutations.get(change.id));
    if (selectedMutations.some((mutation) => mutation === undefined)) {
        return blockedCaptureResult(plan, [{
                severity: 'decisionRequired',
                code: 'capture.unresolvedDecision',
                message: 'The Capture selection does not resolve every required decision.',
            }]);
    }
    try {
        const applied = applyCaptureTransaction(plan.repositoryPath, selectedMutations, options.moveFile ?? fs.renameSync, options.restoreFile ?? ((targetPath, content) => fs.writeFileSync(targetPath, content)));
        activeCapturePlans.delete(plan);
        return {
            schemaVersion: contracts_1.OPERATION_SCHEMA_VERSION,
            operation: 'capture',
            status: 'succeeded',
            repositoryPath: plan.repositoryPath,
            changes: selectedChanges,
            issues: [],
            nextActions: [],
            data: {
                appliedChangeIds: selectedIds,
                writtenPaths: applied.writtenPaths,
                deletedPaths: applied.deletedPaths,
            },
        };
    }
    catch (error) {
        activeCapturePlans.delete(plan);
        if (error instanceof CaptureRollbackError) {
            return failedCaptureResult(plan.repositoryPath, {
                code: 'capture.rollbackFailed',
                message: 'Capture failed and could not fully restore the Repository automatically.',
                technicalDetails: error.message,
                nextActions: [`Restore the affected files from ${error.recoveryPath}, then generate a new Capture Plan.`],
            });
        }
        return failedCaptureResult(plan.repositoryPath, {
            code: 'capture.transactionFailed',
            message: 'Capture could not commit the selected changes and restored the Repository.',
            technicalDetails: error instanceof Error ? error.message : String(error),
            nextActions: ['Check Repository permissions, then generate and review a new Capture Plan.'],
        });
    }
}
function registerCapturePlan(plan, mutations) {
    freezeCapturePlan(plan);
    activeCapturePlans.set(plan, { operationId: plan.operationId, mutations });
}
function freezeCapturePlan(plan) {
    for (const change of plan.changes) {
        for (const previewItem of change.previews)
            Object.freeze(previewItem);
        Object.freeze(change.previews);
        Object.freeze(change.repositoryPaths);
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
    Object.freeze(plan.summary);
    Object.freeze(plan);
}
function captureBlockingIssues(plan, selected, selection, options) {
    if (options.nonInteractive) {
        const unsafe = plan.issues.some((issue) => issue.severity !== 'notice')
            || plan.changes.some((change) => change.change === 'delete');
        return unsafe ? [{
                severity: 'decisionRequired',
                code: 'capture.nonInteractiveBlocked',
                message: 'Non-interactive Capture cannot apply warnings, decisions, errors, or deletions.',
            }] : [];
    }
    const confirmed = new Set(selection.confirmedIssueCodes ?? []);
    const unconfirmedWarnings = plan.issues.filter((issue) => issue.severity === 'warning' && !confirmed.has(issue.code));
    if (unconfirmedWarnings.length > 0)
        return unconfirmedWarnings;
    const errors = plan.issues.filter((issue) => issue.severity === 'error');
    if (errors.length > 0)
        return errors;
    const conflictChanges = plan.changes.filter((change) => change.change === 'conflict');
    const groups = new Map();
    for (const change of conflictChanges) {
        if (!change.decisionGroupId)
            return plan.issues.filter((issue) => issue.severity === 'decisionRequired');
        groups.set(change.decisionGroupId, [...(groups.get(change.decisionGroupId) ?? []), change]);
    }
    if ([...groups.values()].some((choices) => choices.filter((choice) => selected.has(choice.id)).length !== 1)) {
        return plan.issues.filter((issue) => issue.severity === 'decisionRequired');
    }
    return [];
}
function sameCaptureSnapshot(left, right) {
    return left.repositoryPath === right.repositoryPath
        && stableValue(left.preconditions) === stableValue(right.preconditions)
        && stableValue(left.changes.map((change) => ({
            id: change.id,
            change: change.change,
            repositoryPaths: change.repositoryPaths,
        }))) === stableValue(right.changes.map((change) => ({
            id: change.id,
            change: change.change,
            repositoryPaths: change.repositoryPaths,
        })))
        && stableValue(left.issues.map((issue) => [issue.severity, issue.code]))
            === stableValue(right.issues.map((issue) => [issue.severity, issue.code]));
}
function applyCaptureTransaction(repositoryPath, mutations, moveFile, restoreFile) {
    const writes = new Map();
    const deletes = new Set();
    const mcpMutations = mutations.flatMap((mutation) => mutation.mcp ? [mutation.mcp] : []);
    for (const mutation of mutations) {
        for (const write of mutation.writes)
            writes.set(write.repositoryPath, write.content);
        for (const deleted of mutation.deletes)
            deletes.add(deleted);
    }
    if (mcpMutations.length > 0) {
        const registryPath = path.join(repositoryPath, 'common', 'mcp.yaml');
        const servers = readMcpServers(registryPath);
        for (const mutation of mcpMutations) {
            if (mutation.value === undefined)
                delete servers[mutation.name];
            else
                servers[mutation.name] = mutation.value;
        }
        writes.set('common/mcp.yaml', Buffer.from(yaml.stringify({ servers })));
        deletes.delete('common/mcp.yaml');
    }
    const affected = new Set([...writes.keys(), ...deletes]);
    const originals = new Map();
    const temporaryPaths = [];
    const createdDirectories = [];
    for (const repositoryFile of affected) {
        const target = repositoryTarget(repositoryPath, repositoryFile);
        originals.set(repositoryFile, fs.existsSync(target) ? fs.readFileSync(target) : undefined);
    }
    const recoveryPath = createRecoveryBackup(repositoryPath, originals);
    try {
        let sequence = 0;
        for (const [repositoryFile, content] of writes) {
            const target = repositoryTarget(repositoryPath, repositoryFile);
            createParentDirectories(path.dirname(target), repositoryPath, createdDirectories);
            const temporary = `${target}.mcv-${process.pid}-${sequence += 1}.tmp`;
            fs.writeFileSync(temporary, content);
            temporaryPaths.push(temporary);
        }
        for (let index = 0; index < temporaryPaths.length; index += 1) {
            const repositoryFile = [...writes.keys()][index];
            moveFile(temporaryPaths[index], repositoryTarget(repositoryPath, repositoryFile));
        }
        for (const repositoryFile of deletes) {
            fs.rmSync(repositoryTarget(repositoryPath, repositoryFile), { force: true });
        }
    }
    catch (error) {
        const rollbackErrors = [];
        for (const temporary of temporaryPaths) {
            try {
                fs.rmSync(temporary, { force: true });
            }
            catch (rollbackError) {
                rollbackErrors.push(errorMessage(rollbackError));
            }
        }
        for (const [repositoryFile, original] of originals) {
            const target = repositoryTarget(repositoryPath, repositoryFile);
            try {
                if (original === undefined)
                    fs.rmSync(target, { force: true });
                else {
                    fs.mkdirSync(path.dirname(target), { recursive: true });
                    restoreFile(target, original);
                }
            }
            catch (rollbackError) {
                rollbackErrors.push(`${repositoryFile}: ${errorMessage(rollbackError)}`);
            }
        }
        for (const directory of createdDirectories.reverse()) {
            try {
                fs.rmdirSync(directory);
            }
            catch { /* directory is not empty */ }
        }
        if (rollbackErrors.length > 0) {
            throw new CaptureRollbackError(recoveryPath, `${errorMessage(error)} Rollback was incomplete: ${rollbackErrors.join('; ')}`);
        }
        removeRecoveryBackup(recoveryPath);
        throw error;
    }
    removeRecoveryBackup(recoveryPath);
    return { writtenPaths: [...writes.keys()], deletedPaths: [...deletes] };
}
function removeRecoveryBackup(recoveryPath) {
    try {
        fs.rmSync(recoveryPath, { recursive: true, force: true });
    }
    catch { /* a complete backup is safe to leave for manual cleanup */ }
}
class CaptureRollbackError extends Error {
    recoveryPath;
    constructor(recoveryPath, message) {
        super(message);
        this.recoveryPath = recoveryPath;
        this.name = 'CaptureRollbackError';
    }
}
function createRecoveryBackup(repositoryPath, originals) {
    const recoveryPath = path.join(path.dirname(repositoryPath), `.${path.basename(repositoryPath)}.mcv-capture-${(0, uuid_1.v4)()}`);
    try {
        const filesPath = path.join(recoveryPath, 'files');
        fs.mkdirSync(filesPath, { recursive: true });
        const manifest = [...originals].map(([repositoryFile, original], index) => {
            const backupFile = original === undefined ? null : `${index}`;
            if (backupFile && original !== undefined) {
                fs.writeFileSync(path.join(filesPath, backupFile), original);
            }
            return { repositoryFile, backupFile };
        });
        fs.writeFileSync(path.join(recoveryPath, 'manifest.json'), `${JSON.stringify({ repositoryPath, files: manifest }, null, 2)}\n`);
        return recoveryPath;
    }
    catch (error) {
        fs.rmSync(recoveryPath, { recursive: true, force: true });
        throw error;
    }
}
function errorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}
function createParentDirectories(directory, repositoryPath, created) {
    if (fs.existsSync(directory) || directory === repositoryPath)
        return;
    createParentDirectories(path.dirname(directory), repositoryPath, created);
    fs.mkdirSync(directory);
    created.push(directory);
}
function repositoryTarget(repositoryPath, repositoryFile) {
    return path.join(repositoryPath, ...repositoryFile.split('/'));
}
function writeMutation(repositoryPath, content, sourcePaths) {
    return {
        writes: [{ repositoryPath, content: toBuffer(content) }],
        deletes: [],
        sourceHash: hashSourcePaths(sourcePaths),
    };
}
function deleteMutation(repositoryPaths) {
    return { writes: [], deletes: [...repositoryPaths], sourceHash: hashText('<missing>') };
}
function emptyMutation(sourcePaths) {
    return { writes: [], deletes: [], sourceHash: hashSourcePaths(sourcePaths) };
}
function mcpMutation(name, value, sourcePaths) {
    return { ...emptyMutation(sourcePaths), mcp: { name, value } };
}
function hashSourcePaths(sourcePaths) {
    const hash = crypto.createHash('sha256');
    const unique = [...new Set(sourcePaths)].sort();
    if (unique.length === 0)
        hash.update('<missing>');
    for (const sourcePath of unique) {
        hash.update(sourcePath);
        hash.update(fs.existsSync(sourcePath) ? fs.readFileSync(sourcePath) : '<missing>');
    }
    return hash.digest('hex');
}
function invalidPlanError() {
    return {
        code: 'operation.invalidPlan',
        message: 'The Capture Plan is not the active in-process Plan.',
        nextActions: ['Generate and review a new Capture Plan.'],
    };
}
function stalePlanError() {
    return {
        code: 'operation.stalePlan',
        message: 'Capture source or Repository target state changed after the Plan was generated.',
        nextActions: ['Generate and review a new Capture Plan.'],
    };
}
function failedCaptureResult(repositoryPath, error, issues = [{ severity: 'error', code: error.code, message: error.message }]) {
    return {
        schemaVersion: contracts_1.OPERATION_SCHEMA_VERSION,
        operation: 'capture',
        status: 'failed',
        repositoryPath,
        changes: [],
        issues,
        nextActions: error.nextActions,
        error,
    };
}
function blockedCaptureResult(plan, issues) {
    return {
        schemaVersion: contracts_1.OPERATION_SCHEMA_VERSION,
        operation: 'capture',
        status: 'blocked',
        repositoryPath: plan.repositoryPath,
        changes: [],
        issues,
        nextActions: issues.some((issue) => issue.severity === 'warning')
            ? ['Confirm every warning explicitly before applying the Capture Plan.']
            : ['Review and resolve the Capture Plan interactively before applying it.'],
    };
}
function addRulesChange(repositoryPath, files, changes, issues, plannedRepositoryPaths, mutations) {
    const candidates = files.filter((file) => file.repositoryPath === 'common/AGENTS.md');
    if (candidates.length === 0)
        return;
    const targetPath = path.join(repositoryPath, 'common', 'AGENTS.md');
    const contents = [
        ...(fs.existsSync(targetPath) ? [fs.readFileSync(targetPath, 'utf8')] : []),
        ...candidates.flatMap((candidate) => typeof candidate.content === 'string' ? [candidate.content] : []),
    ];
    const content = mergeCanonicalRules(contents);
    const planned = planFile(repositoryPath, {
        ...candidates[0],
        ide: 'shared',
        surface: 'shared',
        sourcePath: candidates.map((candidate) => candidate.sourcePath).join(', '),
        content,
    }, issues);
    if (!planned || sameOptionalContent(planned.existingContent, planned.finalContent))
        return;
    const change = fileChange('shared', 'shared', 'file', 'rules', 'Shared Rules', planned, issues);
    changes.push(change);
    mutations.set(change.id, writeMutation(planned.repositoryPath, planned.finalContent, candidates.map((candidate) => candidate.sourcePath)));
    plannedRepositoryPaths.add(planned.repositoryPath);
}
function addMcpChanges(repositoryPath, files, changes, issues, plannedRepositoryPaths, mutations) {
    const registryFiles = files.filter((file) => file.repositoryPath === 'common/mcp.yaml' && typeof file.content === 'string');
    const candidatesByName = new Map();
    for (const file of registryFiles) {
        const parsed = yaml.parse(file.content);
        if (!(0, objects_1.isRecord)(parsed) || !(0, objects_1.isRecord)(parsed.servers)) {
            issues.push({
                severity: 'error',
                code: 'capture.invalidMcpRegistry',
                message: 'An MCP source could not be represented as a safe registry.',
            });
            continue;
        }
        for (const [name, value] of Object.entries(parsed.servers)) {
            if (!(0, objects_1.isRecord)(value))
                continue;
            candidatesByName.set(name, [
                ...(candidatesByName.get(name) ?? []),
                { sourcePath: file.sourcePath, ide: file.ide, value },
            ]);
        }
    }
    const existingServers = readMcpServers(path.join(repositoryPath, 'common', 'mcp.yaml'));
    const names = new Set([...candidatesByName.keys(), ...Object.keys(existingServers)]);
    for (const name of [...names].sort()) {
        const deviceCandidates = uniqueMcpCandidates(candidatesByName.get(name) ?? []);
        const existing = (0, objects_1.isRecord)(existingServers[name]) ? existingServers[name] : undefined;
        if (deviceCandidates.length === 0 && existing) {
            const content = yaml.stringify({ [name]: existing });
            const change = {
                id: selectionId('mcp', 'shared', name),
                ide: 'shared',
                surface: 'shared',
                itemType: 'mcp',
                capability: 'mcp',
                name,
                change: 'delete',
                defaultSelected: false,
                repositoryPaths: [`common/mcp.yaml#${name}`],
                previews: [preview(`common/mcp.yaml#${name}`, '', content, issues)],
            };
            changes.push(change);
            mutations.set(change.id, mcpMutation(name, undefined, []));
            continue;
        }
        const allCandidates = uniqueMcpCandidates([
            ...(existing ? [{ sourcePath: 'Repository common/mcp.yaml', ide: 'shared', value: existing }] : []),
            ...deviceCandidates,
        ]);
        const uniqueCore = new Set(allCandidates.map((candidate) => stableValue(withoutOverrides(candidate.value))));
        if (uniqueCore.size > 1) {
            const decisionGroupId = `capture-decision-${hashText(`mcp\0${name}`).slice(0, 16)}`;
            for (const candidate of allCandidates) {
                const candidateValue = stableValue(candidate.value);
                const change = {
                    id: selectionId('mcp', 'shared', `${name}\0${candidateValue}`),
                    ide: 'shared',
                    surface: 'shared',
                    itemType: 'mcp',
                    capability: 'mcp',
                    name,
                    change: 'conflict',
                    defaultSelected: false,
                    repositoryPaths: [`common/mcp.yaml#${name}`],
                    previews: [preview(`common/mcp.yaml#${name}`, yaml.stringify({ [name]: candidate.value }), undefined, issues)],
                    decisionGroupId,
                    decision: 'candidate',
                    sourceLabel: sourceLabel(candidate.ide, candidate.sourcePath),
                };
                changes.push(change);
                mutations.set(change.id, mcpMutation(name, candidate.value, deviceCandidates.map((item) => item.sourcePath)));
            }
            const skip = {
                id: selectionId('mcp', 'shared', `${name}\0skip`),
                ide: 'shared',
                surface: 'shared',
                itemType: 'mcp',
                capability: 'mcp',
                name: `${name} (skip)`,
                change: 'conflict',
                defaultSelected: false,
                repositoryPaths: [`common/mcp.yaml#${name}`],
                previews: [],
                decisionGroupId,
                decision: 'skip',
                sourceLabel: 'Skip this item',
            };
            changes.push(skip);
            mutations.set(skip.id, emptyMutation(deviceCandidates.map((item) => item.sourcePath)));
            issues.push({
                severity: 'decisionRequired',
                code: 'capture.mcpCoreConflict',
                message: `MCP server ${safeLabel(name)} has conflicting core definitions.`,
            });
            continue;
        }
        const merged = mergeMcpCandidates(allCandidates);
        if (existing && stableValue(existing) === stableValue(merged))
            continue;
        const before = existing ? yaml.stringify({ [name]: existing }) : undefined;
        const after = yaml.stringify({ [name]: merged });
        const change = {
            id: selectionId('mcp', 'shared', name),
            ide: 'shared',
            surface: 'shared',
            itemType: 'mcp',
            capability: 'mcp',
            name,
            change: existing ? 'modify' : 'add',
            defaultSelected: true,
            repositoryPaths: [`common/mcp.yaml#${name}`],
            previews: [preview(`common/mcp.yaml#${name}`, after, before, issues)],
        };
        changes.push(change);
        mutations.set(change.id, mcpMutation(name, merged, deviceCandidates.map((item) => item.sourcePath)));
    }
    if (names.size > 0)
        plannedRepositoryPaths.add('common/mcp.yaml');
}
function addFileChanges(repositoryPath, files, changes, issues, plannedRepositoryPaths, mutations) {
    const groups = new Map();
    for (const file of files) {
        if (file.repositoryPath === 'common/AGENTS.md' || file.repositoryPath === 'common/mcp.yaml')
            continue;
        groups.set(file.repositoryPath, [...(groups.get(file.repositoryPath) ?? []), file]);
    }
    for (const [repositoryFile, candidates] of groups) {
        plannedRepositoryPaths.add(repositoryFile);
        const unique = candidates.filter((candidate, index) => candidates.findIndex((other) => sameContent(other.content, candidate.content)) === index);
        if (unique.length > 1) {
            issues.push({
                severity: 'decisionRequired',
                code: 'capture.managedSourceConflict',
                message: `Capture source ${safeLabel(repositoryFile)} has conflicting definitions.`,
            });
            const decisionGroupId = `capture-decision-${hashText(`file\0${repositoryFile}`).slice(0, 16)}`;
            for (const candidate of unique) {
                const planned = planFile(repositoryPath, candidate, issues);
                if (!planned)
                    continue;
                const change = {
                    id: selectionId('file', candidate.ide, `${repositoryFile}\0${hashBuffer(toBuffer(candidate.content))}`),
                    ide: candidate.ide,
                    surface: candidate.surface,
                    itemType: repositoryFile.includes('mcp-overrides') ? 'mcp' : 'file',
                    capability: repositoryFile.includes('mcp-overrides') ? 'mcp' : 'native',
                    name: path.posix.basename(repositoryFile),
                    change: 'conflict',
                    defaultSelected: false,
                    repositoryPaths: [repositoryFile],
                    previews: [preview(repositoryFile, planned.finalContent, planned.existingContent, issues)],
                    decisionGroupId,
                    decision: 'candidate',
                    sourceLabel: sourceLabel(candidate.surface, candidate.sourcePath),
                };
                changes.push(change);
                mutations.set(change.id, writeMutation(repositoryFile, planned.finalContent, unique.map((item) => item.sourcePath)));
            }
            const skip = {
                id: selectionId('file', 'shared', `${repositoryFile}\0skip`),
                ide: unique[0].ide,
                surface: unique[0].surface,
                itemType: repositoryFile.includes('mcp-overrides') ? 'mcp' : 'file',
                capability: repositoryFile.includes('mcp-overrides') ? 'mcp' : 'native',
                name: `${path.posix.basename(repositoryFile)} (skip)`,
                change: 'conflict',
                defaultSelected: false,
                repositoryPaths: [repositoryFile],
                previews: [],
                decisionGroupId,
                decision: 'skip',
                sourceLabel: 'Skip this item',
            };
            changes.push(skip);
            mutations.set(skip.id, emptyMutation(unique.map((item) => item.sourcePath)));
            continue;
        }
        const planned = planFile(repositoryPath, unique[0], issues);
        if (!planned || sameOptionalContent(planned.existingContent, planned.finalContent))
            continue;
        const mcpOverride = repositoryFile.includes('mcp-overrides');
        const change = fileChange(planned.ide, planned.surface, mcpOverride ? 'mcp' : 'file', mcpOverride ? 'mcp' : 'native', path.posix.basename(repositoryFile), planned, issues);
        changes.push(change);
        mutations.set(change.id, writeMutation(planned.repositoryPath, planned.finalContent, candidates.map((candidate) => candidate.sourcePath)));
    }
}
function addSkillChanges(repositoryPath, packages, changes, issues, plannedRepositoryPaths, mutations) {
    for (const [name, copies] of packages) {
        const selected = newestSkillCopy(uniqueSkillCopies(copies));
        const previews = [];
        const repositoryPaths = [];
        let changed = false;
        let added = true;
        const writes = [];
        const deletes = [];
        for (const file of selected.files) {
            const repositoryFile = path.posix.join('common', 'skills', name, file.relativePath.replace(/\\/g, '/'));
            const targetPath = path.join(repositoryPath, ...repositoryFile.split('/'));
            const existing = fs.existsSync(targetPath) ? fs.readFileSync(targetPath) : undefined;
            if (existing)
                added = false;
            if (!existing?.equals(file.content))
                changed = true;
            previews.push(preview(repositoryFile, file.content, existing, issues));
            repositoryPaths.push(repositoryFile);
            plannedRepositoryPaths.add(repositoryFile);
            writes.push({ repositoryPath: repositoryFile, content: Buffer.from(file.content) });
        }
        const repositorySkillRoot = path.join(repositoryPath, 'common', 'skills', name);
        for (const repositoryFile of listFiles(repositorySkillRoot)) {
            const relative = path.relative(repositoryPath, repositoryFile).replace(/\\/g, '/');
            if (repositoryPaths.includes(relative))
                continue;
            const existing = fs.readFileSync(repositoryFile);
            changed = true;
            added = false;
            previews.push(preview(relative, '', existing, issues));
            repositoryPaths.push(relative);
            plannedRepositoryPaths.add(relative);
            deletes.push(relative);
        }
        if (!changed)
            continue;
        const change = {
            id: selectionId('skill', 'shared', name),
            ide: 'shared',
            surface: selected.source.surface,
            itemType: 'skill',
            capability: 'skills',
            name,
            change: added ? 'add' : 'modify',
            defaultSelected: true,
            repositoryPaths: repositoryPaths.sort(),
            previews: previews.sort((left, right) => left.repositoryPath.localeCompare(right.repositoryPath)),
        };
        changes.push(change);
        mutations.set(change.id, {
            writes,
            deletes,
            sourceHash: hashSourcePaths(selected.files.map((file) => path.join(selected.directory, file.relativePath))),
        });
    }
}
function addRepositoryDeletionChanges(repositoryPath, enabledTargets, sourcedFiles, packages, changes, issues, plannedRepositoryPaths, mutations) {
    const repositoryRules = path.join(repositoryPath, 'common', 'AGENTS.md');
    if (fs.existsSync(repositoryRules)
        && !sourcedFiles.some((file) => file.repositoryPath === 'common/AGENTS.md')) {
        const change = deletionFileChange(repositoryPath, 'shared', 'shared', 'file', 'rules', 'Shared Rules', 'common/AGENTS.md', issues);
        changes.push(change);
        mutations.set(change.id, deleteMutation(change.repositoryPaths));
    }
    const skillsRoot = path.join(repositoryPath, 'common', 'skills');
    if (fs.existsSync(skillsRoot)) {
        for (const entry of fs.readdirSync(skillsRoot, { withFileTypes: true })) {
            if (!entry.isDirectory() || packages.has(entry.name))
                continue;
            const repositoryPaths = listFiles(path.join(skillsRoot, entry.name))
                .map((file) => path.relative(repositoryPath, file).replace(/\\/g, '/'));
            const change = {
                id: selectionId('skill', 'shared', entry.name),
                ide: 'shared',
                surface: 'shared',
                itemType: 'skill',
                capability: 'skills',
                name: entry.name,
                change: 'delete',
                defaultSelected: false,
                repositoryPaths,
                previews: repositoryPaths.map((repositoryFile) => preview(repositoryFile, '', fs.readFileSync(path.join(repositoryPath, ...repositoryFile.split('/'))), issues)),
            };
            changes.push(change);
            mutations.set(change.id, deleteMutation(repositoryPaths));
        }
    }
    for (const targetId of enabledTargets) {
        const ide = ideName(targetId);
        const nativeRoot = path.join(repositoryPath, 'ide', ide, 'native');
        for (const repositoryFile of listFiles(nativeRoot)) {
            const relative = path.relative(repositoryPath, repositoryFile).replace(/\\/g, '/');
            if (plannedRepositoryPaths.has(relative))
                continue;
            const change = deletionFileChange(repositoryPath, ide, surfaceName(relative, targetId), 'file', 'native', path.posix.basename(relative), relative, issues);
            changes.push(change);
            mutations.set(change.id, deleteMutation(change.repositoryPaths));
        }
    }
}
function planFile(repositoryPath, file, issues) {
    const contentBuffer = toBuffer(file.content);
    if (isText(contentBuffer) && (0, sanitize_1.scanTextForSecrets)(contentBuffer.toString('utf8')).length > 0) {
        issues.push({
            severity: 'error',
            code: 'capture.plaintextSecretBlocked',
            message: 'A Capture source contains a suspected plaintext secret and was blocked.',
        });
        return undefined;
    }
    const destinationPath = path.join(repositoryPath, ...file.repositoryPath.split('/'));
    const existingContent = fs.existsSync(destinationPath)
        ? fs.readFileSync(destinationPath)
        : undefined;
    const finalContent = mergeWithRepository(file, existingContent);
    return { ...file, existingContent, finalContent };
}
function fileChange(ide, surface, itemType, capability, name, file, issues) {
    return {
        id: selectionId(itemType, ide, file.repositoryPath),
        ide,
        surface,
        itemType,
        capability,
        name,
        change: file.existingContent ? 'modify' : 'add',
        defaultSelected: true,
        repositoryPaths: [file.repositoryPath],
        previews: [preview(file.repositoryPath, file.finalContent, file.existingContent, issues)],
    };
}
function deletionFileChange(repositoryPath, ide, surface, itemType, capability, name, repositoryFile, issues) {
    const existing = fs.readFileSync(path.join(repositoryPath, ...repositoryFile.split('/')));
    return {
        id: selectionId(itemType, ide, repositoryFile),
        ide,
        surface,
        itemType,
        capability,
        name,
        change: 'delete',
        defaultSelected: false,
        repositoryPaths: [repositoryFile],
        previews: [preview(repositoryFile, '', existing, issues)],
    };
}
function preview(repositoryPath, next, previous, issues) {
    const nextBuffer = toBuffer(next);
    const previousBuffer = previous === undefined ? undefined : toBuffer(previous);
    const binary = !isText(nextBuffer) || (previousBuffer !== undefined && !isText(previousBuffer));
    if (binary) {
        const metadataBuffer = nextBuffer.length === 0 && previousBuffer
            ? previousBuffer
            : nextBuffer;
        return {
            repositoryPath,
            kind: 'binary',
            bytes: metadataBuffer.length,
            sha256: hashBuffer(metadataBuffer),
        };
    }
    const nextText = nextBuffer.toString('utf8');
    const previousText = previousBuffer?.toString('utf8');
    if ((0, sanitize_1.scanTextForSecrets)(nextText).length > 0
        || (previousText !== undefined && (0, sanitize_1.scanTextForSecrets)(previousText).length > 0)) {
        issues.push({
            severity: 'error',
            code: 'capture.plaintextSecretBlocked',
            message: 'Unsafe plaintext content was withheld from the Capture preview.',
        });
        return {
            repositoryPath,
            kind: 'text',
            bytes: nextBuffer.length,
            sha256: hashBuffer(nextBuffer),
            diff: '[unsafe text withheld]',
        };
    }
    return {
        repositoryPath,
        kind: 'text',
        bytes: nextBuffer.length,
        sha256: hashBuffer(nextBuffer),
        diff: renderDiff(previousText, nextText),
    };
}
function renderDiff(previous, next) {
    if (previous === undefined)
        return lines(next).map((line) => `+ ${line}`).join('\n');
    if (next.length === 0)
        return lines(previous).map((line) => `- ${line}`).join('\n');
    return [
        ...lines(previous).map((line) => `- ${line}`),
        ...lines(next).map((line) => `+ ${line}`),
    ].join('\n');
}
function lines(value) {
    const normalized = value.replace(/\r\n?/g, '\n');
    const result = normalized.split('\n');
    if (result.at(-1) === '')
        result.pop();
    return result;
}
function mergeWithRepository(file, existingBuffer) {
    if (!existingBuffer || Buffer.isBuffer(file.content))
        return file.content;
    const format = structuredFormat(file.repositoryPath);
    if (file.ownership !== 'native' || !format)
        return file.content;
    const existing = (0, structured_config_1.parseStructuredObject)(existingBuffer.toString('utf8'), format, file.repositoryPath);
    const captured = (0, structured_config_1.parseStructuredObject)(file.content, format, file.repositoryPath);
    const merged = (0, objects_1.mergeRecords)(existing, captured);
    for (const localPath of file.localPaths ?? [])
        (0, structured_config_1.deleteObjectPath)(merged, localPath);
    return (0, structured_config_1.stringifyStructuredObject)(merged, format);
}
function structuredFormat(repositoryPath) {
    if (repositoryPath.endsWith('.json'))
        return 'json';
    if (repositoryPath.endsWith('.yaml') || repositoryPath.endsWith('.yml'))
        return 'yaml';
    if (repositoryPath.endsWith('.toml'))
        return 'toml';
    return undefined;
}
function readMcpServers(registryPath) {
    if (!fs.existsSync(registryPath))
        return {};
    const parsed = yaml.parse(fs.readFileSync(registryPath, 'utf8'));
    return (0, objects_1.isRecord)(parsed) && (0, objects_1.isRecord)(parsed.servers) ? parsed.servers : {};
}
function uniqueMcpCandidates(candidates) {
    return candidates.filter((candidate, index) => candidates.findIndex((other) => stableValue(other.value) === stableValue(candidate.value)) === index);
}
function mergeMcpCandidates(candidates) {
    const sorted = [...candidates].sort((left, right) => left.sourcePath.localeCompare(right.sourcePath));
    const result = { ...withoutOverrides(sorted[0].value) };
    const overrides = sorted.reduce((merged, candidate) => (0, objects_1.isRecord)(candidate.value.overrides)
        ? (0, objects_1.mergeRecords)(merged, candidate.value.overrides)
        : merged, {});
    if (Object.keys(overrides).length > 0)
        result.overrides = overrides;
    return result;
}
function withoutOverrides(value) {
    const copy = { ...value };
    delete copy.overrides;
    return copy;
}
function mergeCanonicalRules(contents) {
    const blocks = [];
    const seen = new Set();
    for (const content of contents) {
        for (const block of content.replace(/\r\n?/g, '\n').trim().split(/\n{2,}/)) {
            const normalized = block.trim();
            if (!normalized || seen.has(normalized))
                continue;
            seen.add(normalized);
            blocks.push(normalized);
        }
    }
    return `${blocks.join('\n\n')}\n`;
}
function uniqueSkillCopies(copies) {
    const seen = new Set();
    return copies.filter((copy) => !seen.has(copy.hash) && seen.add(copy.hash));
}
function newestSkillCopy(copies) {
    return [...copies].sort((left, right) => right.modifiedAtMs - left.modifiedAtMs
        || left.source.surface.localeCompare(right.source.surface)
        || left.directory.localeCompare(right.directory))[0];
}
function selectionId(itemType, ide, name) {
    return `capture-${hashText(`${itemType}\0${ide}\0${name}`).slice(0, 16)}`;
}
function hashRepositoryPaths(repositoryPath, repositoryPaths) {
    const hash = crypto.createHash('sha256');
    for (const repositoryFile of [...repositoryPaths].sort()) {
        const cleanPath = repositoryFile.split('#')[0];
        const target = path.join(repositoryPath, ...cleanPath.split('/'));
        hash.update(repositoryFile);
        hash.update(fs.existsSync(target) ? fs.readFileSync(target) : '<missing>');
    }
    return hash.digest('hex');
}
function hashText(value) {
    return crypto.createHash('sha256').update(value).digest('hex');
}
function hashBuffer(value) {
    return crypto.createHash('sha256').update(value).digest('hex');
}
function stableValue(value) {
    if (Array.isArray(value))
        return `[${value.map(stableValue).join(',')}]`;
    if ((0, objects_1.isRecord)(value)) {
        return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableValue(value[key])}`).join(',')}}`;
    }
    return JSON.stringify(value);
}
function ideName(targetId) {
    return targetId === 'claudeCode' ? 'claude-code' : targetId;
}
function surfaceName(repositoryPath, targetId) {
    if (targetId !== 'gemini')
        return ideName(targetId);
    if (repositoryPath.includes('/antigravity/'))
        return 'antigravity';
    return 'gemini-cli';
}
function resolveManifestVariables(variables, context) {
    const platformKey = context.platform === 'win32'
        ? 'windows'
        : context.platform === 'darwin' ? 'macos' : 'linux';
    return Object.fromEntries(Object.entries(variables ?? {}).flatMap(([name, declaration]) => {
        const value = typeof declaration === 'string'
            ? declaration
            : (0, objects_1.isRecord)(declaration) && typeof declaration[platformKey] === 'string'
                ? declaration[platformKey]
                : undefined;
        return value ? [[name, value.replace(/\$\{HOME\}/g, context.homeDir)]] : [];
    }));
}
function listFiles(directory) {
    if (!fs.existsSync(directory))
        return [];
    return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const target = path.join(directory, entry.name);
        return entry.isDirectory() ? listFiles(target) : entry.isFile() ? [target] : [];
    }).sort();
}
function isText(content) {
    const sample = content.subarray(0, Math.min(content.length, 8_192));
    if (sample.includes(0) || !(0, buffer_1.isUtf8)(sample) || hasBinarySignature(sample))
        return false;
    return !sample.some((byte) => byte < 0x20 && byte !== 0x09 && byte !== 0x0a && byte !== 0x0d);
}
function hasBinarySignature(content) {
    const signatures = [
        Buffer.from('%PDF-'),
        Buffer.from([0x50, 0x4b, 0x03, 0x04]),
        Buffer.from([0x1f, 0x8b]),
        Buffer.from([0x89, 0x50, 0x4e, 0x47]),
        Buffer.from([0xff, 0xd8, 0xff]),
        Buffer.from('GIF87a'),
        Buffer.from('GIF89a'),
        Buffer.from([0x7f, 0x45, 0x4c, 0x46]),
        Buffer.from([0x00, 0x61, 0x73, 0x6d]),
    ];
    return signatures.some((signature) => content.length >= signature.length
        && content.subarray(0, signature.length).equals(signature));
}
function toBuffer(content) {
    return Buffer.isBuffer(content) ? content : Buffer.from(content);
}
function sameContent(left, right) {
    return toBuffer(left).equals(toBuffer(right));
}
function sameOptionalContent(existing, next) {
    return existing?.equals(toBuffer(next)) ?? false;
}
function compareChanges(left, right) {
    return left.ide.localeCompare(right.ide)
        || left.itemType.localeCompare(right.itemType)
        || left.name.localeCompare(right.name)
        || left.id.localeCompare(right.id);
}
function safeLabel(value) {
    return /^[a-zA-Z0-9._/-]+$/.test(value) ? value : '[redacted name]';
}
function sourceLabel(surface, sourcePath) {
    if (surface === 'shared')
        return 'Repository';
    return `${surface} / ${safeLabel(path.basename(sourcePath))}`;
}
