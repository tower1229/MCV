import { z } from 'zod';
export const READ_ASSETS_MAX_RESPONSE_BYTES = 64 * 1024;
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
});
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
