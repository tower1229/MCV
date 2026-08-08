import { validateProjectTargetRoot } from '../core/project-target.js';
import { applyDeployPlan, buildDeployRequest, createDeployPlan, } from '../operations/deploy.js';
export async function deployProfiles(repositoryPath, context, input) {
    try {
        const scope = input.scope ?? 'project';
        let targetRoot;
        if (scope === 'global') {
            targetRoot = context.homeDir;
        }
        else {
            if (typeof input.targetDirectory !== 'string' || input.targetDirectory.trim().length === 0) {
                return {
                    status: 'error',
                    error: {
                        code: 'deploy.targetRequired',
                        message: 'deploy_profiles project scope requires an explicit absolute targetDirectory; the MCP server process cwd is never used.',
                    },
                };
            }
            const validated = validateProjectTargetRoot(input.targetDirectory, context, {
                boundRepositoryPath: repositoryPath,
            });
            if (!validated.ok) {
                return {
                    status: 'error',
                    error: {
                        code: validated.error.code,
                        message: validated.error.message,
                    },
                };
            }
            targetRoot = validated.targetRoot;
        }
        const built = buildDeployRequest(repositoryPath, {
            profileIds: input.profiles,
            scope,
            targetRoot,
        });
        if ('error' in built) {
            return {
                status: 'failed',
                scope,
                targetRoot,
                issues: built.issues,
                nextActions: built.error.nextActions,
                error: {
                    code: built.error.code,
                    message: built.error.message,
                },
            };
        }
        const plan = await createDeployPlan(context, built.request);
        const dryRun = input.dryRun === true;
        if (dryRun) {
            return summarizePlan(plan, true);
        }
        if (plan.status === 'failed') {
            return summarizePlan(plan, false);
        }
        const selectedIds = plan.changes
            .filter((change) => change.defaultSelected)
            .map((change) => change.id);
        const result = await applyDeployPlan(context, plan, { changeIds: selectedIds, confirmedIssueIds: [] }, { nonInteractive: true });
        return summarizeResult(plan, result);
    }
    catch (error) {
        return {
            status: 'error',
            error: {
                code: 'mcp.deployFailed',
                message: error instanceof Error ? error.message : String(error),
            },
        };
    }
}
function summarizePlan(plan, dryRun) {
    if (plan.status === 'failed') {
        return {
            status: 'failed',
            dryRun,
            scope: plan.scope,
            targetRoot: plan.targetRoot,
            operationId: plan.operationId,
            profilesRevision: plan.profilesRevision,
            catalogRevision: plan.catalogRevision,
            changes: plan.changes.map(summarizeChange),
            issues: plan.issues.map(summarizeIssue),
            nextActions: plan.nextActions,
            error: plan.error
                ? { code: plan.error.code, message: plan.error.message }
                : undefined,
        };
    }
    return {
        status: 'ok',
        dryRun,
        scope: plan.scope,
        targetRoot: plan.targetRoot,
        operationId: plan.operationId,
        profilesRevision: plan.profilesRevision,
        catalogRevision: plan.catalogRevision,
        changes: plan.changes.map(summarizeChange),
        issues: plan.issues.map(summarizeIssue),
        nextActions: plan.nextActions,
    };
}
function summarizeResult(plan, result) {
    if (result.status === 'blocked') {
        return {
            status: 'blocked',
            dryRun: false,
            scope: plan.scope,
            targetRoot: plan.targetRoot,
            operationId: plan.operationId,
            profilesRevision: plan.profilesRevision,
            catalogRevision: plan.catalogRevision,
            changes: plan.changes.map(summarizeChange),
            issues: result.issues.map(summarizeIssue),
            nextActions: result.nextActions,
            error: {
                code: 'deploy.nonInteractiveBlocked',
                message: 'Deploy was blocked by warnings, decisions, deletions, or topology changes.',
            },
        };
    }
    if (result.status !== 'succeeded') {
        return {
            status: 'failed',
            dryRun: false,
            scope: plan.scope,
            targetRoot: plan.targetRoot,
            operationId: plan.operationId,
            profilesRevision: plan.profilesRevision,
            catalogRevision: plan.catalogRevision,
            changes: plan.changes.map(summarizeChange),
            issues: result.issues.map(summarizeIssue),
            nextActions: result.nextActions,
            error: result.error
                ? { code: result.error.code, message: result.error.message }
                : { code: 'deploy.failed', message: 'Deploy apply failed.' },
        };
    }
    return {
        status: 'ok',
        dryRun: false,
        scope: plan.scope,
        targetRoot: plan.targetRoot,
        operationId: plan.operationId,
        profilesRevision: plan.profilesRevision,
        catalogRevision: plan.catalogRevision,
        changes: plan.changes.map(summarizeChange),
        issues: result.issues.map(summarizeIssue),
        appliedChangeIds: result.data?.appliedChangeIds ?? [],
        writtenPaths: result.data?.writtenPaths ?? [],
        nextActions: result.nextActions,
    };
}
function summarizeChange(change) {
    return {
        id: change.id,
        change: change.change,
        name: change.name,
        targetPath: change.targetPath,
        defaultSelected: change.defaultSelected,
        ...(change.deploymentKind !== undefined
            ? { deploymentKind: change.deploymentKind }
            : {}),
    };
}
function summarizeIssue(issue) {
    return {
        severity: issue.severity,
        code: issue.code,
        message: issue.message,
        ...(issue.confirmationId !== undefined
            ? { confirmationId: issue.confirmationId }
            : {}),
        ...(issue.decisionId !== undefined ? { decisionId: issue.decisionId } : {}),
    };
}
