import { deriveAssetCatalog } from '../assets/catalog.js';
import { computeProfilesRevision, readProfilesDocument } from './store.js';
export function resolveProfiles(repositoryPath, profileIds, scope) {
    const catalog = deriveAssetCatalog(repositoryPath);
    const document = readProfilesDocument(repositoryPath);
    const profilesRevision = computeProfilesRevision(document);
    const catalogById = new Map(catalog.assets.map((asset) => [asset.id, asset]));
    const issues = [];
    const selected = new Set();
    const skippedUnsupported = [];
    for (const profileId of profileIds) {
        const profile = document.profiles[profileId];
        if (!profile) {
            return {
                status: 'failed',
                issues: [],
                error: {
                    code: 'deploy.profileNotFound',
                    message: `Profile ${profileId} does not exist.`,
                    nextActions: ['Pass an existing Profile ID, or create it with mcv profile create.'],
                },
            };
        }
        for (const assetId of profile.assets) {
            const asset = catalogById.get(assetId);
            if (!asset) {
                return {
                    status: 'failed',
                    issues: [],
                    error: {
                        code: 'deploy.missingAsset',
                        message: `Profile ${profileId} references missing Asset ${assetId}.`,
                        nextActions: [
                            'Remove the missing Asset from the Profile, or restore it in the Repository, then regenerate the Deploy Plan.',
                        ],
                    },
                };
            }
            if (!asset.supportedScopes.includes(scope)) {
                skippedUnsupported.push(assetId);
                continue;
            }
            selected.add(assetId);
        }
    }
    if (skippedUnsupported.length > 0) {
        const uniqueSkipped = [...new Set(skippedUnsupported)].sort((left, right) => left.localeCompare(right));
        issues.push({
            severity: 'notice',
            code: 'deploy.scopeUnsupported',
            message: `${uniqueSkipped.length} Asset(s) do not support ${scope} scope and were skipped: ${uniqueSkipped.join(', ')}.`,
        });
    }
    const assetIds = [...selected].sort((left, right) => left.localeCompare(right));
    if (assetIds.length === 0) {
        issues.push({
            severity: 'notice',
            code: 'deploy.emptySelection',
            message: `No Assets remain after resolving Profiles for ${scope} scope; Deploy Plan will be empty.`,
        });
    }
    return {
        status: 'resolved',
        selection: {
            profileIds: [...profileIds],
            profilesRevision,
            catalogRevision: catalog.revision,
            assetIds,
        },
        issues,
    };
}
