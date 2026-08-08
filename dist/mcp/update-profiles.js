import { createProfileService } from '../profiles/service.js';
export function updateProfiles(repositoryPath, input) {
    try {
        const result = createProfileService(repositoryPath).applyMutations({
            expectedCatalogRevision: input.expectedCatalogRevision,
            expectedProfilesRevision: input.expectedProfilesRevision,
            mutations: input.mutations,
        });
        if (result.status !== 'updated') {
            return {
                status: 'error',
                ...(result.profilesRevision ? { profilesRevision: result.profilesRevision } : {}),
                ...(result.catalogRevision ? { catalogRevision: result.catalogRevision } : {}),
                error: result.error ?? {
                    code: 'profile.mutationFailed',
                    message: 'Profile mutation was rejected.',
                },
            };
        }
        return {
            status: 'updated',
            created: result.created,
            updated: result.updated,
            deleted: result.deleted,
            diff: result.diff,
            profilesRevision: result.profilesRevision,
            catalogRevision: result.catalogRevision,
        };
    }
    catch (error) {
        return {
            status: 'error',
            error: {
                code: 'mcp.updateFailed',
                message: error instanceof Error ? error.message : String(error),
            },
        };
    }
}
