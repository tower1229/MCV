import { readFileSync } from 'fs';
import { McpServer } from '@modelcontextprotocol/server';
import { DeployProfilesInputSchema, DeployProfilesOutputSchema, InspectInventoryInputSchema, InspectInventoryOutputSchema, ReadAssetsInputSchema, ReadAssetsOutputSchema, UpdateProfilesInputSchema, UpdateProfilesOutputSchema, } from './contracts.js';
import { inspectInventory } from './inventory.js';
import { PROFILE_CLASSIFICATION_GUIDE, PROFILE_CLASSIFICATION_URI, } from './profile-classification.js';
import { readAssets } from './read-assets.js';
import { toolResult } from './tool-result.js';
import { updateProfiles } from './update-profiles.js';
export const MCP_PROTOCOL_VERSION = '2026-07-28';
export const MCP_SERVER_INSTRUCTIONS = [
    'MCV manages Profiles and Assets for the bound Repository over MCP.',
    'Call inspect_inventory for summaries, then read_assets only for Assets you need.',
    'Use update_profiles for one atomic batch of upsert/delete mutations with expected revisions.',
    'Use deploy_profiles to plan or apply; project scope requires targetDirectory and never uses process cwd.',
    'read_assets returns faithful plaintext content; do not assume values are masked.',
    'For Profile assignment rules, read mcv://guides/profile-classification on demand.',
].join(' ');
const packageVersion = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version;
export function createMcvMcpServer(repositoryPath, context) {
    const server = new McpServer({
        name: 'mcv',
        version: packageVersion,
    }, {
        instructions: MCP_SERVER_INSTRUCTIONS,
        supportedProtocolVersions: [MCP_PROTOCOL_VERSION],
        capabilities: {
            tools: {},
            resources: {},
        },
    });
    server.registerTool('inspect_inventory', {
        title: 'Inspect inventory',
        description: 'Return Asset summaries (description, size, activation, owning Profiles) plus Catalog and Profiles Revisions. Supports cursor/limit pagination. Does not return full file bodies.',
        inputSchema: InspectInventoryInputSchema,
        outputSchema: InspectInventoryOutputSchema,
        annotations: {
            readOnlyHint: true,
            openWorldHint: false,
        },
    }, async (args) => toolResult('inspect_inventory', inspectInventory(repositoryPath, args)));
    server.registerTool('read_assets', {
        title: 'Read assets',
        description: 'Return faithful Asset content for the selected Asset IDs. Responses are size-capped; use nextCursor to continue. Plaintext values are unmasked.',
        inputSchema: ReadAssetsInputSchema,
        outputSchema: ReadAssetsOutputSchema,
        annotations: {
            readOnlyHint: true,
            openWorldHint: false,
        },
    }, async (args) => toolResult('read_assets', readAssets(repositoryPath, args)));
    server.registerTool('update_profiles', {
        title: 'Update profiles',
        description: 'Atomically apply a validated batch of Profile upsert/delete mutations. Requires expectedCatalogRevision and expectedProfilesRevision. Deleting global fails; deleting a Profile removes only the set, not Assets.',
        inputSchema: UpdateProfilesInputSchema,
        outputSchema: UpdateProfilesOutputSchema,
        annotations: {
            readOnlyHint: false,
            destructiveHint: true,
            idempotentHint: true,
        },
    }, async (args) => toolResult('update_profiles', updateProfiles(repositoryPath, args)));
    server.registerTool('deploy_profiles', {
        title: 'Deploy profiles',
        description: 'Plan and optionally apply Deploy for the named Profiles. Scope defaults to project and then requires absolute targetDirectory (never process cwd). Global ignores targetDirectory. dryRun returns the Plan only; otherwise safe Plans apply in one call. Blocking warnings, decisions, deletions, and topology changes return structured Issues.',
        inputSchema: DeployProfilesInputSchema,
        outputSchema: DeployProfilesOutputSchema,
        annotations: {
            readOnlyHint: false,
            destructiveHint: true,
            openWorldHint: false,
        },
    }, async (args) => {
        const { deployProfiles } = await import('./deploy-profiles.js');
        return toolResult('deploy_profiles', await deployProfiles(repositoryPath, context, args));
    });
    server.registerResource('profile-classification', PROFILE_CLASSIFICATION_URI, {
        title: 'Profile classification guidelines',
        description: 'On-demand guidelines for assigning Assets to global, ordinary Profiles, or Unassigned.',
        mimeType: 'text/markdown',
    }, async (uri) => ({
        contents: [
            {
                uri: typeof uri === 'string' ? uri : uri.href,
                mimeType: 'text/markdown',
                text: PROFILE_CLASSIFICATION_GUIDE,
            },
        ],
    }));
    return server;
}
