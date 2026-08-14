import { inspectRepository } from '../../operations/repository.js';
import { readProfilesDocument } from '../../profiles/store.js';
export function createMenuSnapshot(context) {
    const repository = inspectRepository(context);
    if (!repository.valid || !repository.repositoryPath) {
        const notBound = repository.repositoryPath === null
            && repository.issues.some((issue) => issue.code === 'repository.notBound');
        return {
            repository: notBound
                ? { status: 'unbound' }
                : {
                    status: 'blocked',
                    ...(repository.repositoryPath ? { path: repository.repositoryPath } : {}),
                    message: repository.issues[0]?.message ?? 'Repository inspection failed.',
                },
            profiles: [],
        };
    }
    if (!repository.repositoryId || repository.repositorySchemaVersion == null) {
        return {
            repository: {
                status: 'blocked',
                path: repository.repositoryPath,
                message: 'Repository identity is incomplete.',
            },
            profiles: [],
        };
    }
    try {
        return {
            repository: {
                status: 'valid',
                path: repository.repositoryPath,
                id: repository.repositoryId,
                schemaVersion: repository.repositorySchemaVersion,
            },
            profiles: menuProfiles(repository.repositoryPath),
        };
    }
    catch (error) {
        return {
            repository: {
                status: 'blocked',
                path: repository.repositoryPath,
                message: error instanceof Error ? error.message : String(error),
            },
            profiles: [],
        };
    }
}
function menuProfiles(repositoryPath) {
    return Object.entries(readProfilesDocument(repositoryPath).profiles).map(([id, profile]) => ({
        id,
        ...(profile.title ? { title: profile.title } : {}),
        assetCount: profile.assets.length,
    }));
}
