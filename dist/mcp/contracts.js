import { z } from 'zod';
export const READ_ASSETS_MAX_RESPONSE_BYTES = 64 * 1024;
export const READ_ASSETS_MAX_CURSOR_BYTES = 8 * 1024;
export const AssetSummarySchema = z.object({
    id: z.string(),
    type: z.enum(['rule', 'skill', 'mcp', 'native']),
    displayName: z.string(),
    description: z.string().optional(),
    sizeBytes: z.number().int().nonnegative(),
    activation: z.enum(['always', 'on-demand', 'tool-surface', 'configuration']),
    profileIds: z.array(z.string()),
    unassigned: z.boolean(),
});
export const InspectInventoryInputSchema = z.object({
    cursor: z.string().optional(),
    limit: z.number().int().positive().max(200).optional(),
});
export const InspectInventoryOutputSchema = z.object({
    status: z.enum(['ok', 'error']),
    catalogRevision: z.string().optional(),
    profilesRevision: z.string().optional(),
    assets: z.array(AssetSummarySchema).optional(),
    nextCursor: z.string().optional(),
    error: z.object({
        code: z.string(),
        message: z.string(),
    }).optional(),
});
export const ReadAssetsInputSchema = z.object({
    assetIds: z.array(z.string()).min(1).max(50).optional(),
    includeFiles: z.boolean().optional(),
    cursor: z.string().optional(),
}).refine((input) => (input.assetIds === undefined) !== (input.cursor === undefined), { message: 'Provide exactly one of assetIds or cursor.' });
export const AssetFileContentSchema = z.object({
    path: z.string(),
    content: z.string(),
    encoding: z.literal('utf-8'),
    byteLength: z.number().int().nonnegative(),
});
export const AssetContentSchema = z.object({
    id: z.string(),
    type: z.enum(['rule', 'skill', 'mcp', 'native']),
    files: z.array(AssetFileContentSchema),
});
export const ReadAssetsOutputSchema = z.object({
    status: z.enum(['ok', 'error']),
    assets: z.array(AssetContentSchema).optional(),
    truncated: z.boolean().optional(),
    nextCursor: z.string().optional(),
    responseBytes: z.number().int().nonnegative().optional(),
    error: z.object({
        code: z.string(),
        message: z.string(),
    }).optional(),
});
export const ProfileUpsertMutationSchema = z.object({
    operation: z.literal('upsert'),
    id: z.string().min(1),
    title: z.string().optional(),
    description: z.string().optional(),
    assets: z.array(z.string()).optional(),
});
export const ProfileDeleteMutationSchema = z.object({
    operation: z.literal('delete'),
    id: z.string().min(1),
});
export const UpdateProfilesInputSchema = z.object({
    expectedCatalogRevision: z.string().min(1),
    expectedProfilesRevision: z.string().min(1),
    mutations: z.array(z.discriminatedUnion('operation', [
        ProfileUpsertMutationSchema,
        ProfileDeleteMutationSchema,
    ])).min(1),
});
export const ProfileAssetDiffSchema = z.object({
    added: z.number().int().nonnegative(),
    removed: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
});
export const UpdateProfilesOutputSchema = z.object({
    status: z.enum(['updated', 'error']),
    created: z.array(z.string()).optional(),
    updated: z.array(z.string()).optional(),
    deleted: z.array(z.string()).optional(),
    diff: z.record(z.string(), ProfileAssetDiffSchema).optional(),
    profilesRevision: z.string().optional(),
    catalogRevision: z.string().optional(),
    error: z.object({
        code: z.string(),
        message: z.string(),
    }).optional(),
});
export const DeployProfilesInputSchema = z.object({
    profiles: z.array(z.string().min(1)).min(1),
    scope: z.enum(['project', 'global']).optional(),
    targetDirectory: z.string().optional(),
    dryRun: z.boolean().optional(),
});
export const DeployIssueSchema = z.object({
    severity: z.enum(['notice', 'warning', 'decisionRequired', 'error']),
    code: z.string(),
    message: z.string(),
    confirmationId: z.string().optional(),
    decisionId: z.string().optional(),
});
export const DeployChangeSummarySchema = z.object({
    id: z.string(),
    change: z.string(),
    name: z.string(),
    targetPath: z.string(),
    defaultSelected: z.boolean(),
    deploymentKind: z.string().optional(),
});
export const DeployProfilesOutputSchema = z.object({
    status: z.enum(['ok', 'blocked', 'failed', 'error']),
    dryRun: z.boolean().optional(),
    scope: z.enum(['project', 'global']).optional(),
    targetRoot: z.string().optional(),
    operationId: z.string().optional(),
    profilesRevision: z.string().optional(),
    catalogRevision: z.string().optional(),
    changes: z.array(DeployChangeSummarySchema).optional(),
    issues: z.array(DeployIssueSchema).optional(),
    appliedChangeIds: z.array(z.string()).optional(),
    writtenPaths: z.array(z.string()).optional(),
    nextActions: z.array(z.string()).optional(),
    error: z.object({
        code: z.string(),
        message: z.string(),
    }).optional(),
});
