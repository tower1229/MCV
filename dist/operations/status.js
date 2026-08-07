import * as path from 'path';
import { deployPathExists, hashDeviceTopologyNode, } from '../core/canonical-skill-device-layout.js';
import { inspectManagedSkillDrift, isPathCoveredByManagedSkillLayout, } from '../core/managed-skill-layout.js';
import { readManifest, resolveBoundRepository, } from '../utils/repository.js';
import { readState } from '../utils/state.js';
import { createGlobalDeployPlan, } from './deploy-request-helpers.js';
import { OPERATION_SCHEMA_VERSION, } from './contracts.js';
import { inspectEnvironment, } from './environment.js';
import { inspectRepository, } from './repository.js';
export async function inspectStatus(context) {
    const state = readState(context);
    const repositoryPath = resolveBoundRepository(context);
    const manifest = readManifest(repositoryPath);
    if (state.defaultRepositoryId && state.defaultRepositoryId !== manifest.repositoryId) {
        throw new Error('Bound repository ID does not match local state. Run `mcv bind <path>` again.');
    }
    const [deployPlan, environmentReport] = await Promise.all([
        createGlobalDeployPlan(context),
        inspectEnvironment(context, repositoryPath),
    ]);
    const repositoryReport = inspectRepository(context, repositoryPath);
    const changes = deployPlan.changes;
    return {
        schemaVersion: OPERATION_SCHEMA_VERSION,
        operation: 'status',
        status: 'reported',
        ready: deployPlan.status !== 'failed' && deployPlan.readyToApply,
        repositoryPath,
        repository: {
            path: repositoryPath,
            id: repositoryReport.repositoryId ?? manifest.repositoryId,
            schemaVersion: repositoryReport.repositorySchemaVersion ?? manifest.schemaVersion,
            ...(repositoryReport.git ? { git: repositoryReport.git } : {}),
        },
        linkOutcomes: deployPlan.linkOutcomes,
        linkFacts: deployPlan.linkFacts,
        pendingDeployment: summarizePendingDeployment(changes),
        postDeployLocalState: summarizePostDeployLocalState(state),
        environment: {
            missingVariables: environmentReport.missingVariables,
            ideSupport: summarizeIdeSupport(environmentReport, manifest),
        },
        lastOperation: state.lastOperation ?? null,
        issues: deployPlan.issues,
        nextActions: deployPlan.nextActions,
    };
}
function summarizePendingDeployment(changes) {
    const summary = {
        add: 0,
        modify: 0,
        delete: 0,
        total: 0,
        recommended: 0,
        optional: 0,
        advancedCleanupExcluded: 0,
    };
    const standardChanges = new Map();
    const cleanupChanges = new Set();
    for (const change of changes) {
        const packageKey = change.capability === 'skills'
            ? change.owner === 'canonical-store'
                ? undefined
                : [change.ide, change.surface, change.name].join(':')
            : change.id;
        if (change.group === 'advanced') {
            cleanupChanges.add(packageKey ?? change.id);
            continue;
        }
        if (!packageKey)
            continue;
        if (change.capability === 'skills') {
            const current = standardChanges.get(packageKey);
            standardChanges.set(packageKey, {
                change: mergePendingChange(current?.change, change.change),
                defaultSelected: current?.defaultSelected === true || change.defaultSelected,
            });
            continue;
        }
        standardChanges.set(packageKey, {
            change: change.change,
            defaultSelected: change.defaultSelected,
        });
    }
    for (const { change, defaultSelected } of standardChanges.values()) {
        summary[change] += 1;
        summary.total += 1;
        if (defaultSelected)
            summary.recommended += 1;
        else
            summary.optional += 1;
    }
    summary.advancedCleanupExcluded = cleanupChanges.size;
    return summary;
}
function mergePendingChange(current, next) {
    if (current === 'modify' || next === 'modify')
        return 'modify';
    if (current === 'add' || next === 'add')
        return 'add';
    return 'delete';
}
function summarizePostDeployLocalState(state) {
    const baselineFiles = state.baselineSnapshot?.files ?? {};
    const { contentDrifts, topologyDrifts, coveredPaths, } = inspectManagedSkillDrift(state.managedSkillLayout);
    const files = Object.entries(baselineFiles)
        .filter(([filePath]) => !isPathCoveredByManagedSkillLayout(filePath, coveredPaths))
        .map(([filePath, expectedHash]) => {
        if (!deployPathExists(filePath))
            return { path: filePath, state: 'missing' };
        return {
            path: filePath,
            state: hashDeviceTopologyNode(filePath) === expectedHash ? 'unchanged' : 'drift',
        };
    });
    const ordinaryDrift = files.filter((file) => file.state === 'drift').length;
    const missing = files.filter((file) => file.state === 'missing').length;
    const driftedPackagePaths = new Set([
        ...contentDrifts.map((entry) => path.resolve(entry.storePath)),
        ...topologyDrifts
            .filter((entry) => entry.kind === 'canonical-skill-package')
            .map((entry) => path.resolve(entry.storePath)),
    ]);
    const driftedProjectionPaths = new Set(topologyDrifts
        .filter((entry) => entry.kind === 'skill-projection')
        .map((entry) => path.resolve(entry.projectionPath)));
    const unchanged = files.filter((file) => file.state === 'unchanged').length
        + (state.managedSkillLayout
            ? Object.values(state.managedSkillLayout.packages)
                .filter((pkg) => !driftedPackagePaths.has(path.resolve(pkg.storePath))).length
                + Object.values(state.managedSkillLayout.projections)
                    .filter((projection) => !driftedProjectionPaths.has(path.resolve(projection.projectionPath))).length
            : 0);
    const contentDrift = contentDrifts.length;
    const topologyDrift = topologyDrifts.length;
    const drift = ordinaryDrift + contentDrift + topologyDrift;
    return {
        unchanged,
        drift,
        contentDrift,
        topologyDrift,
        missing,
        total: unchanged + drift + missing,
        files,
        contentDrifts,
        topologyDrifts,
    };
}
function summarizeIdeSupport(environmentReport, manifest) {
    return environmentReport.environments.map((environment) => {
        const targetId = manifestTargetId(environment.id);
        return {
            id: environment.id,
            name: environment.name,
            enabled: manifest.targets[targetId]?.enabled === true,
            detected: environment.detected,
            surfaces: environment.configDirectories.map((surface) => ({
                id: surface.id,
                path: surface.path,
                detected: surface.exists,
            })),
        };
    });
}
function manifestTargetId(environmentId) {
    switch (environmentId) {
        case 'codex': return 'codex';
        case 'claude-code': return 'claudeCode';
        case 'gemini': return 'gemini';
    }
}
