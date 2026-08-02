import * as crypto from 'crypto';
import { isUtf8 } from 'buffer';
import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { createAdapterDefinitions } from '../adapters/index.js';
import { CLAUDE_CODE_MCP_PATH, CODEX_MCP_PATH, GEMINI_MCP_PATH, } from '../adapters/overlay-policies.js';
import { atomicWriteFile, findSymbolicLinkAncestor, hashFile } from '../utils/files.js';
import { isRecord } from '../utils/objects.js';
import { readManifest, resolveBoundRepository } from '../utils/repository.js';
import { scanTextForSecrets } from '../utils/sanitize.js';
import { hashSkillPackageContent, resolveSkillPackageStorePath, } from '../core/managed-skill-layout.js';
import { getStateFilePath, readState, writeState } from '../utils/state.js';
import { parseStructuredObject, stringifyStructuredObject, } from '../utils/structured-config.js';
import { resolveVariableDefinitions } from '../utils/variables.js';
import { findLegacyCodexSkillDuplicates } from '../utils/deploy-skills.js';
import { classifyCanonicalSkillLinks, canonicalSkillPackageName, deployPathExists, hashDeviceTopologyNode, planCanonicalSkillDeviceLayout, } from '../core/canonical-skill-device-layout.js';
import { OPERATION_SCHEMA_VERSION, } from './contracts.js';
const activeDeployPlans = new WeakMap();
export async function createDeployPlan(context) {
    const operationId = uuidv4();
    let repositoryPath = null;
    try {
        repositoryPath = resolveBoundRepository(context);
        const mutations = new Map();
        const plan = await buildDeployPlan(context, repositoryPath, operationId, mutations);
        registerDeployPlan(plan, mutations);
        return plan;
    }
    catch (error) {
        return freezeDeployPlan({
            schemaVersion: OPERATION_SCHEMA_VERSION,
            operation: 'deploy',
            status: 'failed',
            readyToApply: false,
            operationId,
            preconditions: {},
            repositoryPath,
            changes: [],
            linkOutcomes: [],
            issues: [{
                    severity: 'error',
                    code: 'deploy.planFailed',
                    message: 'The Deploy Plan could not be generated safely.',
                }],
            nextActions: ['Fix the reported Repository or IDE configuration problem, then regenerate the Deploy Plan.'],
            error: {
                code: 'deploy.planFailed',
                message: 'The Deploy Plan could not be generated safely.',
                technicalDetails: errorMessage(error),
                nextActions: ['Fix the Repository or IDE configuration problem, then regenerate the Deploy Plan.'],
            },
        });
    }
}
async function buildDeployPlan(context, repositoryPath, operationId, mutations) {
    const manifest = readManifest(repositoryPath);
    const definitions = createAdapterDefinitions().filter(({ targetId }) => manifest.targets[targetId]?.enabled === true);
    if (definitions.length === 0) {
        return {
            schemaVersion: OPERATION_SCHEMA_VERSION,
            operation: 'deploy',
            status: 'planned',
            readyToApply: true,
            operationId,
            preconditions: {},
            repositoryPath,
            changes: [],
            linkOutcomes: [],
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
                owner: 'ide',
                ide: ideName(definition.targetId),
                capability,
                strategy: semantics.strategy,
                deploymentKind: capability === 'skills' ? 'copy-projection' : 'ordinary-file',
            }));
        });
    }))).flat();
    const issues = [];
    const linkOutcomes = [];
    const layout = planCanonicalSkillLayout(desired, context, manifest.deploy.useSymlinks, mutations, issues, definitions);
    const safeDesired = layout.desired.filter((file) => {
        const linkPath = findSymbolicLinkAncestor(file.targetPath);
        if (!linkPath)
            return true;
        if (file.capability === 'skills')
            return false;
        issues.push({
            severity: 'warning',
            code: `deploy.symbolicLinkSkipped.${issues.length + 1}`,
            message: `A target beneath a symbolic link was excluded: ${file.targetPath}.`,
            details: `Symbolic link ancestor: ${linkPath}`,
        });
        return false;
    });
    const inventory = readState(context).managedInventory ?? {};
    const linkedSkills = classifyCanonicalSkillLinks(layout.desiredForLinkClassification, (linkPath) => inventory[linkPath]?.hash === hashDeviceTopologyNode(linkPath));
    linkOutcomes.push(...linkedSkills.outcomes);
    issues.push(...linkedSkills.issues);
    const changes = safeDesired.flatMap((file) => {
        const previous = fs.existsSync(file.targetPath) ? fs.readFileSync(file.targetPath) : undefined;
        const next = toBuffer(file.content);
        if (previous?.equals(next))
            return [];
        const filePreview = preview(file.targetPath, canonicalTargetKey(file), file.capability, next, previous, issues);
        if (filePreview.kind === 'text' && filePreview.diff.length === 0)
            return [];
        const change = previous === undefined ? 'add' : 'modify';
        const id = selectionId(canonicalTargetKey(file), file.capability, file.targetPath);
        mutations.set(id, { content: next });
        return [{
                id,
                ...canonicalTarget(file),
                capability: file.capability,
                name: displayName(file.targetPath, file.capability),
                targetPath: file.targetPath,
                change,
                defaultSelected: true,
                group: 'standard',
                strategy: file.strategy,
                deploymentKind: file.deploymentKind,
                preview: filePreview,
            }];
    });
    changes.push(...layout.projectionChanges);
    const legacyDuplicates = findLegacyCodexSkillDuplicates(context, safeDesired, definitions.some(({ targetId }) => targetId === 'codex'));
    if (legacyDuplicates.names.length > 0) {
        issues.push({
            severity: 'notice',
            code: 'deploy.legacyCodexSkillDuplicates',
            message: `[duplicate:codex-legacy] ${legacyDuplicates.names.join(', ')}; review the Advanced Cleanup candidates.`,
        });
        for (const targetPath of legacyDuplicates.files) {
            changes.push({
                id: selectionId('codex', 'skills', targetPath),
                owner: 'ide',
                ide: 'codex',
                capability: 'skills',
                name: displayName(targetPath, 'skills'),
                targetPath,
                change: 'delete',
                defaultSelected: false,
                group: 'advanced',
                strategy: 'replace-entire-file',
                deploymentKind: 'copy-projection',
                preview: preview(targetPath, 'codex', 'skills', Buffer.alloc(0), fs.readFileSync(targetPath), issues),
            });
            mutations.set(selectionId('codex', 'skills', targetPath), {});
        }
    }
    const sourcePreconditions = new Map();
    const desiredPaths = new Set(safeDesired.map((file) => path.resolve(file.targetPath)));
    for (const change of layout.projectionChanges) {
        desiredPaths.add(path.resolve(change.targetPath));
    }
    for (const outcome of linkedSkills.outcomes) {
        if (outcome.status !== 'satisfied-via-link' || outcome.ownership !== 'managed')
            continue;
        for (const linkPath of outcome.linkPaths)
            desiredPaths.add(path.resolve(linkPath));
    }
    const managedInventory = readState(context).managedInventory ?? {};
    const managedSkillLayout = readState(context).managedSkillLayout;
    const managedStorePaths = Object.keys(managedSkillLayout?.packages ?? {})
        .map((storePath) => path.resolve(storePath));
    for (const [targetPath, inventoryEntry] of Object.entries(managedInventory)) {
        if (desiredPaths.has(path.resolve(targetPath)) || !deployPathExists(targetPath))
            continue;
        const resolvedTarget = path.resolve(targetPath);
        if (isPathUnderAnyRoot(resolvedTarget, managedStorePaths))
            continue;
        const linkAncestor = findSymbolicLinkAncestor(targetPath);
        const projection = managedSkillLayout?.projections[targetPath]
            ?? managedSkillLayout?.projections[resolvedTarget];
        const isManagedProjection = Boolean(projection);
        const isSelfSymlink = linkAncestor !== undefined
            && path.resolve(linkAncestor) === resolvedTarget;
        const hasSymlinkParent = linkAncestor !== undefined && !isSelfSymlink;
        if (hasSymlinkParent)
            continue;
        if (isSelfSymlink && !isManagedProjection)
            continue;
        const target = inferDeployTarget(targetPath, context);
        if (!target)
            continue;
        const targetKey = canonicalTargetKey(target);
        const semantics = target.owner === 'canonical-store'
            ? { capabilities: ['skills'], strategy: 'replace-entire-file' }
            : inferDeploymentSemantics(targetPath, targetIdForIde(target.ide), repositoryPath, context);
        const capability = semantics.capabilities[0];
        if (semantics.strategy !== 'replace-entire-file' || !capability)
            continue;
        const deploymentKind = projection
            ? 'managed-link-projection'
            : target.owner === 'canonical-store'
                ? 'physical-materialization'
                : capability === 'skills' ? 'copy-projection' : 'ordinary-file';
        const deletion = {
            id: selectionId(targetKey, capability, targetPath),
            ...canonicalTarget(target),
            capability,
            name: projection?.packageName ?? displayName(targetPath, capability),
            targetPath,
            change: 'delete',
            defaultSelected: false,
            group: 'advanced',
            strategy: semantics.strategy,
            deploymentKind,
            preview: projection
                ? {
                    targetPath,
                    kind: 'link',
                    linkTarget: projection.expectedLinkTarget,
                }
                : preview(targetPath, targetKey, capability, Buffer.alloc(0), fs.readFileSync(targetPath), issues),
        };
        changes.push(deletion);
        mutations.set(deletion.id, {});
        sourcePreconditions.set(deletion.id, hashText(stableValue(inventoryEntry)));
    }
    for (const pkg of Object.values(managedSkillLayout?.packages ?? {})) {
        const storePath = path.resolve(pkg.storePath);
        if (!deployPathExists(storePath))
            continue;
        if (desiredPaths.has(storePath) || [...desiredPaths].some((desired) => isPathUnderRoot(desired, storePath)))
            continue;
        const stillRequired = Object.values(managedSkillLayout?.projections ?? {}).some((projection) => {
            if (path.resolve(projection.expectedLinkTarget) !== storePath
                && projection.packageName !== pkg.packageName)
                return false;
            return desiredPaths.has(path.resolve(projection.projectionPath));
        });
        if (stillRequired)
            continue;
        try {
            const storeStat = fs.lstatSync(storePath);
            if (storeStat.isSymbolicLink() || !storeStat.isDirectory())
                continue;
        }
        catch {
            continue;
        }
        const id = selectionId('canonical-store', 'skills', storePath);
        if (changes.some((change) => change.id === id))
            continue;
        const deletion = {
            id,
            owner: 'canonical-store',
            capability: 'skills',
            name: pkg.packageName,
            targetPath: storePath,
            change: 'delete',
            defaultSelected: false,
            group: 'advanced',
            strategy: 'replace-entire-file',
            deploymentKind: 'physical-materialization',
            preview: {
                targetPath: storePath,
                kind: 'text',
                bytes: 0,
                sha256: hashText(`remove-package:${pkg.packageName}`),
                diff: `Remove MCV-owned Canonical Skill package ${pkg.packageName}`,
            },
        };
        changes.push(deletion);
        mutations.set(deletion.id, {});
        sourcePreconditions.set(deletion.id, hashText(stableValue(pkg)));
    }
    changes.sort(compareChanges);
    const repositorySourceHash = hashRepositoryInputs(repositoryPath);
    const preconditions = Object.fromEntries(changes.flatMap((change) => {
        return [
            [`source:${change.id}`, sourcePreconditions.get(change.id) ?? repositorySourceHash],
            [`target:${change.id}`, hashDeviceTopologyNode(change.targetPath)],
        ];
    }));
    const blocked = issues.some((issue) => issue.severity === 'decisionRequired' || issue.severity === 'error');
    return {
        schemaVersion: OPERATION_SCHEMA_VERSION,
        operation: 'deploy',
        status: 'planned',
        readyToApply: !blocked,
        operationId,
        preconditions,
        repositoryPath,
        changes,
        linkOutcomes,
        issues,
        nextActions: blocked
            ? ['Resolve every decisionRequired or error Issue, then regenerate the Deploy Plan.']
            : [],
    };
}
function planCanonicalSkillLayout(desired, context, useSymlinks, mutations, issues, definitions) {
    const projectionSurfaces = definitions.flatMap(({ adapter }) => adapter.skillSurfaces.map((surface) => ({
        ide: skillSurfaceIde(surface.id),
        root: surface.destinationRoot(context),
        supportsManagedLinks: surface.supportsManagedDirectoryLinks(context.platform),
    })));
    const managedLayout = planCanonicalSkillDeviceLayout({
        files: desired.map((file) => annotateSkillSurface(file, projectionSurfaces)),
        context,
        useManagedLinks: useSymlinks
            && projectionSurfaces.some((surface) => surface.supportsManagedLinks),
        projectionSurfaces,
    });
    for (const relative of managedLayout.conflicts) {
        issues.push({
            severity: 'error',
            code: 'deploy.skillsLayout.physicalTargetConflict',
            message: `Canonical Skill projections disagree about ${relative}.`,
        });
    }
    const projectionChanges = [];
    for (const projection of managedLayout.missingProjections) {
        const id = selectionId(projection.ide, 'skills', projection.targetPath);
        projectionChanges.push({
            id,
            owner: 'ide',
            ide: projection.ide,
            capability: 'skills',
            name: projection.packageName,
            targetPath: projection.targetPath,
            change: 'add',
            defaultSelected: true,
            group: 'standard',
            strategy: 'replace-entire-file',
            deploymentKind: 'managed-link-projection',
            dependsOnChangeIds: projection.materializationPaths.map((targetPath) => selectionId('canonical-store', 'skills', targetPath)),
            preview: {
                targetPath: projection.targetPath,
                kind: 'link',
                linkTarget: projection.physicalTargetPath,
            },
        });
        mutations.set(id, { linkTarget: projection.physicalTargetPath });
    }
    for (const migration of managedLayout.topologyMigrations) {
        const id = selectionId(migration.ide, 'skills', migration.targetPath);
        projectionChanges.push({
            id,
            owner: 'ide',
            ide: migration.ide,
            capability: 'skills',
            name: migration.packageName,
            targetPath: migration.targetPath,
            change: 'modify',
            defaultSelected: false,
            group: 'standard',
            strategy: 'replace-entire-file',
            deploymentKind: 'topology-migration',
            dependsOnChangeIds: migration.materializationPaths.map((targetPath) => selectionId('canonical-store', 'skills', targetPath)),
            preview: {
                targetPath: migration.targetPath,
                kind: 'link',
                linkTarget: migration.physicalTargetPath,
            },
        });
        mutations.set(id, { linkTarget: migration.physicalTargetPath });
        issues.push({
            severity: 'warning',
            code: 'deploy.skillsTopology.migrationCandidate',
            message: `Topology migration available: replace matching physical Skill copy ${migration.packageName} with a managed link.`,
            details: `${migration.targetPath} currently matches Canonical package content and can be replaced with a link to ${migration.physicalTargetPath}. Migration is destructive, never selected by default, and requires explicit interactive confirmation.`,
        });
    }
    for (const divergent of managedLayout.divergentPhysicalCopies) {
        issues.push({
            severity: 'warning',
            code: 'deploy.skillsTopology.divergentPhysicalCopy',
            message: `Divergent physical Skill copy preserved: ${divergent.packageName}.`,
            details: `${divergent.targetPath} differs from the Canonical package. Capture or otherwise resolve the package before replacing it with a managed link.`,
        });
    }
    const materialized = managedLayout.materializations.map(({ source, targetPath }) => {
        const { ide: _ide, ...withoutIde } = source;
        return {
            ...withoutIde,
            owner: 'canonical-store',
            targetPath,
            deploymentKind: 'physical-materialization',
        };
    });
    return {
        desired: [...managedLayout.filesOutsideLayout, ...materialized],
        desiredForLinkClassification: managedLayout.filesForLinkClassification,
        projectionChanges,
    };
}
function skillSurfaceIde(surfaceId) {
    if (surfaceId === 'claude-code'
        || surfaceId === 'codex'
        || surfaceId === 'gemini-cli'
        || surfaceId === 'antigravity') {
        return surfaceId;
    }
    throw new Error(`Unsupported Skill Surface id: ${surfaceId}`);
}
function annotateSkillSurface(file, surfaces) {
    if (file.capability !== 'skills' || file.owner !== 'ide')
        return file;
    const match = surfaces.find((surface) => isPathWithinRoot(surface.root, file.targetPath));
    return match ? { ...file, ide: match.ide } : file;
}
function isPathWithinRoot(root, candidate) {
    const relative = path.relative(path.resolve(root), path.resolve(candidate));
    return relative === ''
        || (relative !== '..'
            && !relative.startsWith(`..${path.sep}`)
            && !path.isAbsolute(relative));
}
function registerDeployPlan(plan, mutations) {
    freezeDeployPlan(plan);
    activeDeployPlans.set(plan, { operationId: plan.operationId, mutations });
}
export async function applyDeployPlan(context, plan, selection, options = {}) {
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
    const missingDependencies = plan.changes.flatMap((change) => selected.has(change.id)
        ? (change.dependsOnChangeIds ?? []).filter((dependencyId) => knownIds.has(dependencyId) && !selected.has(dependencyId))
        : []);
    if (missingDependencies.length > 0) {
        return failedDeployResult(plan.repositoryPath, {
            code: 'deploy.invalidSelection',
            message: 'A managed Skill projection cannot be selected without its pending Store materialization.',
            technicalDetails: `Missing selected dependencies: ${[...new Set(missingDependencies)].join(', ')}`,
            nextActions: ['Select every pending physical materialization required by the managed projection.'],
        });
    }
    const blocking = deployBlockingIssues(plan, selection, options);
    if (blocking.length > 0)
        return blockedDeployResult(plan, blocking);
    if (!plan.repositoryPath || resolveBoundRepository(context) !== plan.repositoryPath) {
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
            updateDeployState(context, plan.repositoryPath, selectedChanges, options.updateState);
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
            schemaVersion: OPERATION_SCHEMA_VERSION,
            operation: 'deploy',
            status: 'succeeded',
            repositoryPath: plan.repositoryPath,
            changes: [],
            issues: [],
            nextActions: [],
            data: { appliedChangeIds: [], writtenPaths: [], deletedPaths: [] },
            linkOutcomes: plan.linkOutcomes,
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
        applyPreparedDeployWrites(prepared, backupPath, options.writeFile ?? ((targetPath, content) => atomicWriteFile(targetPath, content)), options.removeFile ?? ((targetPath) => fs.rmSync(targetPath, { recursive: true, force: true })), options.restoreFile ?? ((targetPath, content) => atomicWriteFile(targetPath, content)), options.createSymbolicLink ?? ((target, linkPath) => fs.symlinkSync(target, linkPath, 'dir')), () => {
            finalizeDeployBackup(backupPath);
            updateDeployState(context, plan.repositoryPath, selectedChanges, options.updateState);
        });
        activeDeployPlans.delete(plan);
        return {
            schemaVersion: OPERATION_SCHEMA_VERSION,
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
                projectionPaths: prepared.filter((item) => item.change === 'link' || item.change === 'migrate-link').map((item) => item.targetPath),
                backupPath,
            },
            linkOutcomes: plan.linkOutcomes,
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
            || plan.changes.some((change) => change.change === 'delete' || change.deploymentKind === 'topology-migration');
        return unsafe ? [{
                severity: 'decisionRequired',
                code: 'deploy.nonInteractiveBlocked',
                message: 'Non-interactive Deploy cannot apply warnings, decisions, errors, deletions, or topology migrations.',
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
        && stableValue(left.linkOutcomes) === stableValue(right.linkOutcomes)
        && stableValue(left.issues.map((issue) => [issue.severity, issue.code]))
            === stableValue(right.issues.map((issue) => [issue.severity, issue.code]));
}
function deploySnapshotChange(change) {
    return {
        id: change.id,
        change: change.change,
        capability: change.capability,
        deploymentKind: change.deploymentKind,
        dependsOnChangeIds: change.dependsOnChangeIds,
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
        if (targetChanges.some((change) => change.deploymentKind === 'topology-migration')) {
            if (!mutation?.linkTarget) {
                throw new Error(`Missing active Deploy link mutation for ${targetChanges[0].id}.`);
            }
            return {
                targetPath,
                change: 'migrate-link',
                linkTarget: mutation.linkTarget,
            };
        }
        if (targetChanges.some((change) => change.deploymentKind === 'managed-link-projection')) {
            if (!mutation?.linkTarget) {
                throw new Error(`Missing active Deploy link mutation for ${targetChanges[0].id}.`);
            }
            return {
                targetPath,
                change: 'link',
                linkTarget: mutation.linkTarget,
            };
        }
        if (!mutation?.content)
            throw new Error(`Missing active Deploy mutation for ${targetChanges[0].id}.`);
        return {
            targetPath,
            change: 'write',
            content: composeSelectedContent(targetPath, targetChanges, mutation.content),
        };
    }).sort((left, right) => {
        const order = { write: 0, delete: 1, link: 2, 'migrate-link': 2 };
        return order[left.change] - order[right.change];
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
        ? parseStructuredObject(fs.readFileSync(targetPath, 'utf8'), format, targetPath)
        : {};
    const desired = parseStructuredObject(desiredContent.toString('utf8'), format, targetPath);
    const selectedCapabilities = new Set(changes.map((change) => change.capability));
    if (changes[0].owner !== 'ide') {
        throw new Error('Canonical Store content cannot use managed structured merge.');
    }
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
    return Buffer.from(stringifyStructuredObject(result, format));
}
function copyStructuredKey(source, target, key) {
    if (key in source)
        target[key] = source[key];
    else
        delete target[key];
}
function createDeployBackup(context, plan, changes, copyFile) {
    assertSelectedPreconditions(context, plan, changes);
    const backupRoot = path.join(path.dirname(getStateFilePath(context)), 'backups');
    fs.mkdirSync(backupRoot, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = fs.mkdtempSync(path.join(backupRoot, `${timestamp}-`));
    const filesPath = path.join(backupPath, 'files');
    fs.mkdirSync(filesPath);
    try {
        const files = changes.map((change, index) => {
            const expected = plan.preconditions[`target:${change.id}`];
            const layoutKind = change.deploymentKind;
            if (change.change === 'add') {
                if (deployPathExists(change.targetPath))
                    throw new StaleDeployPlanError('A selected add target appeared during backup.');
                return {
                    changeId: change.id,
                    action: change.change,
                    originalPath: change.targetPath,
                    layoutKind,
                };
            }
            const relativeBackupPath = path.join('files', `${index}-${path.basename(change.targetPath)}`);
            const copiedPath = path.join(backupPath, relativeBackupPath);
            const node = backupDeployNode(change.targetPath, copiedPath, copyFile);
            if (node.beforeHash === undefined
                || hashDeviceTopologyNode(change.targetPath) !== expected) {
                throw new StaleDeployPlanError('A selected target changed while its backup was being verified.');
            }
            if (node.nodeKind === 'file' && hashFile(copiedPath) !== node.beforeHash) {
                throw new StaleDeployPlanError('A selected target changed while its backup was being verified.');
            }
            if (node.nodeKind === 'directory'
                && hashDirectoryTree(copiedPath) !== hashDirectoryTree(change.targetPath)) {
                throw new StaleDeployPlanError('A selected target changed while its backup was being verified.');
            }
            return {
                changeId: change.id,
                action: change.change,
                originalPath: change.targetPath,
                backupPath: relativeBackupPath,
                beforeHash: node.beforeHash,
                nodeKind: node.nodeKind,
                layoutKind,
                ...(node.linkText !== undefined ? { linkText: node.linkText } : {}),
            };
        });
        const manifest = {
            createdAt: new Date().toISOString(),
            status: 'pending',
            files,
        };
        atomicWriteFile(path.join(backupPath, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
        return backupPath;
    }
    catch (error) {
        fs.rmSync(backupPath, { recursive: true, force: true });
        throw error;
    }
}
function assertSelectedPreconditions(context, plan, changes) {
    const repositoryHash = plan.repositoryPath ? hashRepositoryInputs(plan.repositoryPath) : undefined;
    const inventory = readState(context).managedInventory ?? {};
    for (const change of changes) {
        const targetHash = hashDeviceTopologyNode(change.targetPath);
        const sourceHash = change.change === 'delete' && inventory[change.targetPath] !== undefined
            ? hashText(stableValue(inventory[change.targetPath]))
            : repositoryHash;
        if (targetHash !== plan.preconditions[`target:${change.id}`]
            || sourceHash !== plan.preconditions[`source:${change.id}`]) {
            throw new StaleDeployPlanError('Deploy source or target state changed after the Plan was reviewed.');
        }
    }
}
function applyPreparedDeployWrites(writes, backupPath, writeFile, removeFile, restoreFile, createSymbolicLink, commit) {
    const attemptedPaths = new Set();
    const createdDirectories = new Set();
    try {
        for (const write of writes) {
            for (const directory of missingParentDirectories(write.targetPath)) {
                createdDirectories.add(directory);
            }
            if (write.change === 'delete') {
                attemptedPaths.add(write.targetPath);
                removeFile(write.targetPath);
            }
            else if (write.change === 'migrate-link') {
                attemptedPaths.add(write.targetPath);
                removeFile(write.targetPath);
                fs.mkdirSync(path.dirname(write.targetPath), { recursive: true });
                createSymbolicLink(write.linkTarget, write.targetPath);
                verifyManagedProjection(write.targetPath, write.linkTarget);
            }
            else if (write.change === 'link') {
                fs.mkdirSync(path.dirname(write.targetPath), { recursive: true });
                createSymbolicLink(write.linkTarget, write.targetPath);
                attemptedPaths.add(write.targetPath);
                verifyManagedProjection(write.targetPath, write.linkTarget);
            }
            else {
                attemptedPaths.add(write.targetPath);
                writeFile(write.targetPath, write.content);
                if (!fs.readFileSync(write.targetPath).equals(write.content)) {
                    throw new Error(`Deploy write verification failed for ${write.targetPath}.`);
                }
            }
        }
        commit();
    }
    catch (error) {
        const rollbackErrors = rollbackDeployWrites(backupPath, attemptedPaths, createdDirectories, removeFile, restoreFile);
        if (rollbackErrors.length > 0) {
            throw new DeployRollbackError(`${errorMessage(error)} Rollback was incomplete: ${rollbackErrors.join('; ')}`);
        }
        throw error;
    }
}
function rollbackDeployWrites(backupPath, attemptedPaths, createdDirectories, removeFile, restoreFile) {
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
            else {
                const sourcePath = path.join(backupPath, entry.backupPath);
                if (entry.nodeKind === 'directory') {
                    removeFile(entry.originalPath);
                    fs.cpSync(sourcePath, entry.originalPath, { recursive: true, verbatimSymlinks: true });
                }
                else if (entry.nodeKind === 'symlink') {
                    removeFile(entry.originalPath);
                    fs.symlinkSync(entry.linkText, entry.originalPath, 'dir');
                }
                else {
                    restoreFile(entry.originalPath, fs.readFileSync(sourcePath));
                }
            }
        }
        catch (error) {
            errors.push(`${entry.originalPath}: ${errorMessage(error)}`);
        }
    }
    for (const directory of [...createdDirectories].sort((left, right) => right.length - left.length)) {
        try {
            fs.rmdirSync(directory);
        }
        catch (error) {
            if (!isRecord(error) || !['ENOENT', 'ENOTEMPTY'].includes(String(error.code))) {
                errors.push(`${directory}: ${errorMessage(error)}`);
            }
        }
    }
    return errors;
}
function missingParentDirectories(targetPath) {
    const missing = [];
    let current = path.dirname(targetPath);
    while (!deployPathExists(current) && current !== path.dirname(current)) {
        missing.push(current);
        current = path.dirname(current);
    }
    return missing;
}
function finalizeDeployBackup(backupPath) {
    const manifest = readDeployBackupManifest(backupPath);
    for (const entry of manifest.files) {
        if (!deployPathExists(entry.originalPath))
            continue;
        const stat = fs.lstatSync(entry.originalPath);
        entry.afterHash = stat.isFile() && !stat.isSymbolicLink()
            ? hashFile(entry.originalPath)
            : hashDeviceTopologyNode(entry.originalPath);
    }
    manifest.status = 'complete';
    manifest.completedAt = new Date().toISOString();
    atomicWriteFile(path.join(backupPath, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
}
function backupDeployNode(targetPath, copiedPath, copyFile) {
    const stat = fs.lstatSync(targetPath);
    if (stat.isSymbolicLink()) {
        const linkText = fs.readlinkSync(targetPath);
        fs.symlinkSync(linkText, copiedPath, 'dir');
        return {
            beforeHash: hashDeviceTopologyNode(targetPath),
            nodeKind: 'symlink',
            linkText,
        };
    }
    if (stat.isDirectory()) {
        fs.cpSync(targetPath, copiedPath, { recursive: true, verbatimSymlinks: true });
        return {
            beforeHash: hashDirectoryTree(targetPath),
            nodeKind: 'directory',
        };
    }
    copyFile(targetPath, copiedPath);
    return {
        beforeHash: hashFile(targetPath),
        nodeKind: 'file',
    };
}
function hashDirectoryTree(root) {
    const hash = crypto.createHash('sha256');
    const visit = (directory) => {
        for (const entry of fs.readdirSync(directory, { withFileTypes: true })
            .sort((left, right) => left.name.localeCompare(right.name))) {
            const current = path.join(directory, entry.name);
            hash.update(`${path.relative(root, current)}\0`);
            if (entry.isSymbolicLink()) {
                hash.update(`symlink\0${fs.readlinkSync(current)}\0`);
                continue;
            }
            if (entry.isDirectory()) {
                hash.update('directory\0');
                visit(current);
                continue;
            }
            hash.update(fs.readFileSync(current));
        }
    };
    visit(root);
    return hash.digest('hex');
}
function markDeployBackupFailed(backupPath, error) {
    try {
        const manifest = readDeployBackupManifest(backupPath);
        manifest.status = 'failed';
        manifest.failedAt = new Date().toISOString();
        manifest.error = errorMessage(error);
        atomicWriteFile(path.join(backupPath, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    }
    catch { /* Preserve the primary Deploy failure. */ }
}
function readDeployBackupManifest(backupPath) {
    return JSON.parse(fs.readFileSync(path.join(backupPath, 'manifest.json'), 'utf8'));
}
function updateDeployState(context, repositoryPath, changes, updateState = writeState) {
    const state = readState(context);
    const baselineFiles = { ...(state.baselineSnapshot?.files ?? {}) };
    const managedInventory = { ...(state.managedInventory ?? {}) };
    const managedSkillLayout = {
        packages: { ...(state.managedSkillLayout?.packages ?? {}) },
        projections: { ...(state.managedSkillLayout?.projections ?? {}) },
    };
    const touchedPackages = new Set();
    for (const change of changes) {
        if (change.change === 'delete' || !deployPathExists(change.targetPath)) {
            delete baselineFiles[change.targetPath];
            delete managedInventory[change.targetPath];
            if (change.deploymentKind === 'managed-link-projection'
                || change.deploymentKind === 'topology-migration') {
                delete managedSkillLayout.projections[change.targetPath];
            }
            if (change.deploymentKind === 'physical-materialization') {
                const storePath = resolveSkillPackageStorePath(change.targetPath);
                touchedPackages.add(storePath);
                for (const inventoryPath of Object.keys(managedInventory)) {
                    if (isPathUnderRoot(inventoryPath, storePath))
                        delete managedInventory[inventoryPath];
                }
                for (const baselinePath of Object.keys(baselineFiles)) {
                    if (isPathUnderRoot(baselinePath, storePath))
                        delete baselineFiles[baselinePath];
                }
                if (!deployPathExists(storePath))
                    delete managedSkillLayout.packages[storePath];
            }
        }
        else {
            const hash = hashDeviceTopologyNode(change.targetPath);
            baselineFiles[change.targetPath] = hash;
            managedInventory[change.targetPath] = { source: repositoryPath, hash };
            if (change.deploymentKind === 'physical-materialization') {
                touchedPackages.add(resolveSkillPackageStorePath(change.targetPath));
            }
            if ((change.deploymentKind === 'managed-link-projection'
                || change.deploymentKind === 'topology-migration')
                && change.owner === 'ide'
                && change.preview.kind === 'link') {
                managedSkillLayout.projections[change.targetPath] = {
                    packageName: change.name,
                    projectionPath: change.targetPath,
                    ide: change.ide,
                    surface: change.ide,
                    expectedLinkTarget: change.preview.linkTarget,
                    topologyHash: hash,
                    source: repositoryPath,
                };
            }
        }
    }
    for (const storePath of touchedPackages) {
        if (!deployPathExists(storePath)) {
            delete managedSkillLayout.packages[storePath];
            continue;
        }
        managedSkillLayout.packages[storePath] = {
            packageName: canonicalSkillPackageName(storePath),
            storePath,
            contentHash: hashSkillPackageContent(storePath),
            source: repositoryPath,
        };
    }
    const lastDeploySelection = {};
    for (const change of changes) {
        if (change.owner === 'canonical-store')
            continue;
        const selectionIde = deploySelectionIde(change.ide);
        const capabilities = lastDeploySelection[selectionIde] ?? [];
        if (!capabilities.includes(change.capability))
            capabilities.push(change.capability);
        lastDeploySelection[selectionIde] = capabilities;
    }
    state.baselineSnapshot = { recordedAt: new Date().toISOString(), files: baselineFiles };
    state.managedInventory = managedInventory;
    if (Object.keys(managedSkillLayout.packages).length > 0
        || Object.keys(managedSkillLayout.projections).length > 0) {
        state.managedSkillLayout = managedSkillLayout;
    }
    else {
        delete state.managedSkillLayout;
    }
    state.lastDeploySelection = lastDeploySelection;
    state.lastOperation = { kind: 'deploy', time: new Date().toISOString(), success: true };
    updateState(context, state);
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
        schemaVersion: OPERATION_SCHEMA_VERSION,
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
        schemaVersion: OPERATION_SCHEMA_VERSION,
        operation: 'deploy',
        status: 'blocked',
        repositoryPath: plan.repositoryPath,
        changes: [],
        linkOutcomes: plan.linkOutcomes,
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
    for (const outcome of plan.linkOutcomes) {
        Object.freeze(outcome.packageNames);
        Object.freeze(outcome.linkPaths);
        if (outcome.resolvedPaths)
            Object.freeze(outcome.resolvedPaths);
        Object.freeze(outcome);
    }
    Object.freeze(plan.linkOutcomes);
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
    if (scanTextForSecrets(diff).length > 0) {
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
        const before = previous === undefined ? {} : parseStructuredObject(previous, format, targetPath);
        const after = parseStructuredObject(next, format, targetPath);
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
    codex: CODEX_MCP_PATH,
    'claude-code': CLAUDE_CODE_MCP_PATH,
    gemini: GEMINI_MCP_PATH,
};
function managedTopLevelKey(ide) {
    const managedPath = MCP_PATH_BY_IDE[ide];
    if (!managedPath)
        throw new Error(`${ide} does not have a managed structured path.`);
    return managedPath.slice(2);
}
function stableValue(value) {
    if (Array.isArray(value))
        return `[${value.map(stableValue).join(',')}]`;
    if (isRecord(value)) {
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
function canonicalTargetKey(target) {
    return target.owner === 'canonical-store' ? 'canonical-store' : target.ide;
}
function canonicalTarget(target) {
    return target.owner === 'canonical-store'
        ? { owner: 'canonical-store' }
        : { owner: 'ide', ide: target.ide };
}
function verifyManagedProjection(linkPath, expectedTarget) {
    const stat = fs.lstatSync(linkPath);
    if (!stat.isSymbolicLink()) {
        throw new Error(`Deploy link verification failed: ${linkPath} is not a symbolic link.`);
    }
    const rawTarget = fs.readlinkSync(linkPath);
    const resolvedRawTarget = path.resolve(path.dirname(linkPath), rawTarget);
    if (resolvedRawTarget !== path.resolve(expectedTarget)) {
        throw new Error(`Deploy link verification failed: ${linkPath} targets ${rawTarget}, expected ${expectedTarget}.`);
    }
    if (fs.realpathSync(linkPath) !== fs.realpathSync(expectedTarget)) {
        throw new Error(`Deploy link verification failed: ${linkPath} does not resolve to ${expectedTarget}.`);
    }
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
        || canonicalTargetKey(left).localeCompare(canonicalTargetKey(right))
        || capabilityOrder[left.capability] - capabilityOrder[right.capability]
        || left.targetPath.localeCompare(right.targetPath);
}
function ideName(targetId) {
    if (targetId === 'claudeCode')
        return 'claude-code';
    return targetId;
}
function targetIdForIde(ide) {
    if (ide === 'claude-code')
        return 'claudeCode';
    if (ide === 'gemini-cli' || ide === 'antigravity' || ide === 'gemini')
        return 'gemini';
    return ide;
}
function deploySelectionIde(ide) {
    if (ide === 'claude-code')
        return 'claude-code';
    if (ide === 'gemini' || ide === 'gemini-cli' || ide === 'antigravity')
        return 'gemini';
    return 'codex';
}
function inferDeployTarget(targetPath, context) {
    const resolved = path.resolve(targetPath);
    const roots = [
        [{ owner: 'ide', ide: 'codex' }, path.resolve(context.env.CODEX_HOME || path.join(context.homeDir, '.codex'))],
        [{ owner: 'canonical-store' }, path.resolve(context.homeDir, '.agents', 'skills')],
        [{ owner: 'ide', ide: 'claude-code' }, path.resolve(context.env.CLAUDE_CONFIG_DIR || path.join(context.homeDir, '.claude'))],
        [{ owner: 'ide', ide: 'claude-code' }, path.resolve(context.homeDir, '.claude.json')],
        [{ owner: 'ide', ide: 'gemini-cli' }, path.resolve(context.homeDir, '.gemini', 'skills')],
        [{ owner: 'ide', ide: 'antigravity' }, path.resolve(context.homeDir, '.gemini', 'config', 'skills')],
        [{ owner: 'ide', ide: 'gemini' }, path.resolve(context.homeDir, '.gemini')],
    ];
    return roots.find(([, root]) => resolved === root || resolved.startsWith(`${root}${path.sep}`))?.[0];
}
function isPathUnderRoot(candidate, root) {
    const resolvedCandidate = path.resolve(candidate);
    const resolvedRoot = path.resolve(root);
    if (resolvedCandidate === resolvedRoot)
        return true;
    const relative = path.relative(resolvedRoot, resolvedCandidate);
    return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}
function isPathUnderAnyRoot(candidate, roots) {
    return roots.some((root) => isPathUnderRoot(candidate, root));
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
            : isRecord(declaration) && typeof declaration[platformKey] === 'string'
                ? declaration[platformKey]
                : undefined;
        if (value !== undefined)
            definitions[name] = value;
    }
    return resolveVariableDefinitions(definitions, {
        ...context.variables,
        HOME: context.homeDir,
        MCV_REPO: repositoryPath,
    }, context.platform);
}
function toBuffer(value) {
    return Buffer.isBuffer(value) ? Buffer.from(value) : Buffer.from(value);
}
function isText(value) {
    return value.length === 0 || (isUtf8(value) && !value.includes(0));
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
