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
exports.inspectStatus = inspectStatus;
const fs = __importStar(require("fs"));
const files_1 = require("../utils/files");
const repository_1 = require("../utils/repository");
const state_1 = require("../utils/state");
const deploy_1 = require("./deploy");
const contracts_1 = require("./contracts");
const environment_1 = require("./environment");
const repository_2 = require("./repository");
async function inspectStatus(context) {
    const state = (0, state_1.readState)(context);
    const repositoryPath = (0, repository_1.resolveBoundRepository)(context);
    const manifest = (0, repository_1.readManifest)(repositoryPath);
    if (state.defaultRepositoryId && state.defaultRepositoryId !== manifest.repositoryId) {
        throw new Error('Bound repository ID does not match local state. Run `mcv bind <path>` again.');
    }
    const [deployPlan, environmentReport] = await Promise.all([
        (0, deploy_1.createDeployPlan)(context),
        (0, environment_1.inspectEnvironment)(context, repositoryPath),
    ]);
    const repositoryReport = (0, repository_2.inspectRepository)(context, repositoryPath);
    const changes = deployPlan.changes;
    return {
        schemaVersion: contracts_1.OPERATION_SCHEMA_VERSION,
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
        pendingDeployment: summarizePendingDeployment(changes),
        postDeployLocalState: summarizePostDeployLocalState(state.baselineSnapshot?.files ?? {}),
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
    const summary = { add: 0, modify: 0, delete: 0, total: changes.length };
    for (const change of changes)
        summary[change.change] += 1;
    return summary;
}
function summarizePostDeployLocalState(baselineFiles) {
    const files = Object.entries(baselineFiles).map(([filePath, expectedHash]) => {
        if (!fs.existsSync(filePath))
            return { path: filePath, state: 'missing' };
        return {
            path: filePath,
            state: (0, files_1.hashFile)(filePath) === expectedHash ? 'unchanged' : 'drift',
        };
    });
    return {
        unchanged: files.filter((file) => file.state === 'unchanged').length,
        drift: files.filter((file) => file.state === 'drift').length,
        missing: files.filter((file) => file.state === 'missing').length,
        total: files.length,
        files,
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
