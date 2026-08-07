export function deployContextFieldsFromRequest(request) {
    return {
        scope: request.scope,
        targetRoot: request.targetRoot,
        profileIds: [...request.profileIds],
        profilesRevision: request.selection.profilesRevision,
        catalogRevision: request.selection.catalogRevision,
        assetIds: [...request.selection.assetIds],
    };
}
