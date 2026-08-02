import * as path from 'path';
import { deployPathExists, hashDeviceTopologyNode, } from '../core/canonical-skill-device-layout.js';
import { inspectManagedSkillDrift, isPathCoveredByManagedSkillLayout, resolveSkillPackageStorePath, } from '../core/managed-skill-layout.js';
import { readManifest, resolveBoundRepository, } from '../utils/repository.js';
import { readState } from '../utils/state.js';
import { createDeployPlan, } from './deploy.js';
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
        createDeployPlan(context),
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
        changes,
        linkOutcomes: deployPlan.linkOutcomes,
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
    const materializationPackages = new Set();
    const summary = { add: 0, modify: 0, delete: 0, total: 0 };
    for (const change of changes) {
        if (change.deploymentKind === 'physical-materialization') {
            const packagePath = resolveSkillPackageStorePath(change.targetPath);
            if (materializationPackages.has(packagePath))
                continue;
            materializationPackages.add(packagePath);
        }
        summary[change.change] += 1;
        summary.total += 1;
    }
    return summary;
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
