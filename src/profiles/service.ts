import { deriveAssetCatalog } from '../assets/catalog.js';
import { isValidAssetId } from '../assets/ids.js';
import {
  acquireOperationLock,
  OperationLockBusyError,
  releaseOperationLock,
  repositoryOperationLockResource,
  type OperationLockHandle,
} from '../utils/operation-lock.js';
import {
  GLOBAL_PROFILE_ID,
  PROFILE_ID_PATTERN,
  type ApplyProfileMutationsInput,
  type CreateProfileInput,
  type DeleteProfileInput,
  type Profile,
  type ProfileAssetDiff,
  type ProfileInventory,
  type ProfileMutationResult,
  type ReplaceProfilesInput,
  type UpdateProfileInput,
} from './contracts.js';
import {
  computeProfilesRevision,
  normalizeProfile,
  normalizeProfilesDocument,
  readProfilesDocument,
  writeProfilesDocument,
} from './store.js';

export interface ProfileService {
  inspect(): ProfileInventory;
  create(input: CreateProfileInput): ProfileMutationResult;
  update(input: UpdateProfileInput): ProfileMutationResult;
  delete(input: DeleteProfileInput): ProfileMutationResult;
  replaceAll(input: ReplaceProfilesInput): ProfileMutationResult;
  applyMutations(input: ApplyProfileMutationsInput): ProfileMutationResult;
}

export function createProfileService(repositoryPath: string): ProfileService {
  return {
    inspect(): ProfileInventory {
      const catalog = deriveAssetCatalog(repositoryPath);
      const document = readProfilesDocument(repositoryPath);
      const catalogAssetIds = catalog.assets.map((asset) => asset.id);
      const catalogSet = new Set(catalogAssetIds);
      const referenced = new Set<string>();
      for (const profile of Object.values(document.profiles)) {
        for (const assetId of profile.assets) referenced.add(assetId);
      }
      return {
        catalogRevision: catalog.revision,
        profilesRevision: computeProfilesRevision(document),
        profiles: structuredClone(document.profiles),
        catalogAssetIds,
        unassignedAssetIds: catalogAssetIds.filter((id) => !referenced.has(id)),
      };
    },

    create(input: CreateProfileInput): ProfileMutationResult {
      return mutate(repositoryPath, input, (document) => {
        if (!PROFILE_ID_PATTERN.test(input.id) || input.id.length > 64) {
          return reject('profile.invalidId', `Invalid Profile ID: ${input.id}`);
        }
        if (input.id === GLOBAL_PROFILE_ID || input.id in document.profiles) {
          return reject('profile.alreadyExists', `Profile ${input.id} already exists.`);
        }
        document.profiles[input.id] = normalizeProfile({
          title: input.title,
          description: input.description,
          assets: input.assets ?? [],
        });
        return {
          created: [input.id],
          updated: [],
          deleted: [],
          beforeAssets: {},
        };
      });
    },

    update(input: UpdateProfileInput): ProfileMutationResult {
      return mutate(repositoryPath, input, (document) => {
        const existing = document.profiles[input.id];
        if (!existing) {
          return reject('profile.notFound', `Profile ${input.id} does not exist.`);
        }
        const before = new Set(existing.assets);
        let assets = [...existing.assets];
        if (input.assets) assets = [...input.assets];
        if (input.addAssets) assets.push(...input.addAssets);
        if (input.removeAssets) {
          const remove = new Set(input.removeAssets);
          assets = assets.filter((id) => !remove.has(id));
        }
        const next: Profile = {
          assets,
        };
        if (input.title !== undefined) next.title = input.title;
        else if (existing.title !== undefined) next.title = existing.title;
        if (input.description !== undefined) next.description = input.description;
        else if (existing.description !== undefined) next.description = existing.description;
        document.profiles[input.id] = normalizeProfile(next);
        return {
          created: [],
          updated: [input.id],
          deleted: [],
          beforeAssets: { [input.id]: before },
        };
      });
    },

    delete(input: DeleteProfileInput): ProfileMutationResult {
      return mutate(repositoryPath, input, (document) => {
        if (input.id === GLOBAL_PROFILE_ID) {
          return reject('profile.globalRequired', 'The built-in global Profile cannot be deleted.');
        }
        const existing = document.profiles[input.id];
        if (!existing) {
          return reject('profile.notFound', `Profile ${input.id} does not exist.`);
        }
        const before = new Set(existing.assets);
        delete document.profiles[input.id];
        return {
          created: [],
          updated: [],
          deleted: [input.id],
          beforeAssets: { [input.id]: before },
        };
      });
    },

    replaceAll(input: ReplaceProfilesInput): ProfileMutationResult {
      return mutate(repositoryPath, input, (document) => {
        if (!(GLOBAL_PROFILE_ID in input.profiles)) {
          return reject('profile.globalRequired', 'The built-in global Profile must remain present.');
        }
        const beforeAssets: Record<string, Set<string>> = {};
        for (const [id, profile] of Object.entries(document.profiles)) {
          beforeAssets[id] = new Set(profile.assets);
        }
        const created: string[] = [];
        const updated: string[] = [];
        const deleted: string[] = [];
        for (const id of Object.keys(document.profiles)) {
          if (!(id in input.profiles)) deleted.push(id);
        }
        if (deleted.includes(GLOBAL_PROFILE_ID)) {
          return reject('profile.globalRequired', 'The built-in global Profile cannot be deleted.');
        }
        for (const id of Object.keys(input.profiles)) {
          if (!PROFILE_ID_PATTERN.test(id) || id.length > 64) {
            return reject('profile.invalidId', `Invalid Profile ID: ${id}`);
          }
          if (id in document.profiles) updated.push(id);
          else created.push(id);
        }
        document.profiles = Object.fromEntries(
          Object.entries(input.profiles).map(([id, profile]) => [id, normalizeProfile(profile)]),
        );
        return { created, updated, deleted, beforeAssets };
      });
    },

    applyMutations(input: ApplyProfileMutationsInput): ProfileMutationResult {
      return mutate(repositoryPath, input, (document) => {
        if (!Array.isArray(input.mutations) || input.mutations.length === 0) {
          return reject('profile.emptyMutations', 'At least one Profile mutation is required.');
        }

        const beforeAssets: Record<string, Set<string>> = {};
        for (const [id, profile] of Object.entries(document.profiles)) {
          beforeAssets[id] = new Set(profile.assets);
        }
        const created: string[] = [];
        const updated: string[] = [];
        const deleted: string[] = [];

        for (const mutation of input.mutations) {
          if (mutation.operation === 'delete') {
            if (mutation.id === GLOBAL_PROFILE_ID) {
              return reject('profile.globalRequired', 'The built-in global Profile cannot be deleted.');
            }
            const existing = document.profiles[mutation.id];
            if (!existing) {
              return reject('profile.notFound', `Profile ${mutation.id} does not exist.`);
            }
            if (!(mutation.id in beforeAssets)) {
              beforeAssets[mutation.id] = new Set(existing.assets);
            }
            delete document.profiles[mutation.id];
            if (!deleted.includes(mutation.id)) deleted.push(mutation.id);
            const createdIndex = created.indexOf(mutation.id);
            if (createdIndex >= 0) created.splice(createdIndex, 1);
            const updatedIndex = updated.indexOf(mutation.id);
            if (updatedIndex >= 0) updated.splice(updatedIndex, 1);
            continue;
          }

          if (!PROFILE_ID_PATTERN.test(mutation.id) || mutation.id.length > 64) {
            return reject('profile.invalidId', `Invalid Profile ID: ${mutation.id}`);
          }
          const existing = document.profiles[mutation.id];
          if (!existing) {
            document.profiles[mutation.id] = normalizeProfile({
              title: mutation.title,
              description: mutation.description,
              assets: mutation.assets ?? [],
            });
            const deletedIndex = deleted.indexOf(mutation.id);
            if (deletedIndex >= 0) deleted.splice(deletedIndex, 1);
            const updatedIndex = updated.indexOf(mutation.id);
            if (updatedIndex >= 0) updated.splice(updatedIndex, 1);
            if (!created.includes(mutation.id)) created.push(mutation.id);
            continue;
          }

          if (!(mutation.id in beforeAssets)) {
            beforeAssets[mutation.id] = new Set(existing.assets);
          }
          const next: Profile = {
            assets: mutation.assets !== undefined ? [...mutation.assets] : [...existing.assets],
          };
          if (mutation.title !== undefined) next.title = mutation.title;
          else if (existing.title !== undefined) next.title = existing.title;
          if (mutation.description !== undefined) next.description = mutation.description;
          else if (existing.description !== undefined) next.description = existing.description;
          document.profiles[mutation.id] = normalizeProfile(next);
          if (!created.includes(mutation.id) && !updated.includes(mutation.id)) {
            updated.push(mutation.id);
          }
        }

        return { created, updated, deleted, beforeAssets };
      });
    },
  };
}

type MutationPrep =
  | {
      created: string[];
      updated: string[];
      deleted: string[];
      beforeAssets: Record<string, Set<string>>;
    }
  | ProfileMutationResult;

function mutate(
  repositoryPath: string,
  input: { expectedProfilesRevision: string; expectedCatalogRevision: string },
  prepare: (document: ReturnType<typeof readProfilesDocument>) => MutationPrep,
): ProfileMutationResult {
  let lock: OperationLockHandle;
  try {
    lock = acquireOperationLock(repositoryOperationLockResource(repositoryPath));
  } catch (error) {
    if (!(error instanceof OperationLockBusyError)) throw error;
    return {
      status: 'conflict',
      created: [],
      updated: [],
      deleted: [],
      diff: {},
      profilesRevision: input.expectedProfilesRevision,
      catalogRevision: input.expectedCatalogRevision,
      error: {
        code: 'profile.repositoryBusy',
        message: 'Another MCV process is modifying this Repository; inspect it again and retry.',
      },
    };
  }
  try {
    return mutateWhileLocked(repositoryPath, input, prepare);
  } finally {
    releaseOperationLock(lock);
  }
}

function mutateWhileLocked(
  repositoryPath: string,
  input: { expectedProfilesRevision: string; expectedCatalogRevision: string },
  prepare: (document: ReturnType<typeof readProfilesDocument>) => MutationPrep,
): ProfileMutationResult {
  const catalog = deriveAssetCatalog(repositoryPath);
  const document = normalizeProfilesDocument(readProfilesDocument(repositoryPath));
  const profilesRevision = computeProfilesRevision(document);
  if (
    input.expectedProfilesRevision !== profilesRevision
    || input.expectedCatalogRevision !== catalog.revision
  ) {
    return {
      status: 'conflict',
      created: [],
      updated: [],
      deleted: [],
      diff: {},
      profilesRevision,
      catalogRevision: catalog.revision,
      error: {
        code: 'profile.revisionConflict',
        message: 'expected Profiles or Catalog Revision does not match the Repository.',
      },
    };
  }

  const working = structuredClone(document);
  const prepared = prepare(working);
  if ('status' in prepared) {
    return {
      ...prepared,
      profilesRevision,
      catalogRevision: catalog.revision,
    };
  }

  const catalogIds = new Set(catalog.assets.map((asset) => asset.id));
  for (const [profileId, profile] of Object.entries(working.profiles)) {
    for (const assetId of profile.assets) {
      if (!isValidAssetId(assetId)) {
        return rejectResult(
          profilesRevision,
          catalog.revision,
          'profile.invalidAssetId',
          `Profile ${profileId} references invalid Asset ID ${assetId}.`,
        );
      }
      if (!catalogIds.has(assetId)) {
        return rejectResult(
          profilesRevision,
          catalog.revision,
          'profile.unknownAsset',
          `Profile ${profileId} references unknown Asset ${assetId}.`,
        );
      }
    }
  }
  if (!(GLOBAL_PROFILE_ID in working.profiles)) {
    return rejectResult(
      profilesRevision,
      catalog.revision,
      'profile.globalRequired',
      'The built-in global Profile must remain present.',
    );
  }

  const normalized = normalizeProfilesDocument(working);
  const nextRevision = writeProfilesDocument(repositoryPath, normalized);
  const diff = buildDiff(prepared.beforeAssets, normalized.profiles, prepared.deleted);
  return {
    status: 'updated',
    created: prepared.created,
    updated: prepared.updated,
    deleted: prepared.deleted,
    diff,
    profilesRevision: nextRevision,
    catalogRevision: catalog.revision,
  };
}

function buildDiff(
  beforeAssets: Record<string, Set<string>>,
  afterProfiles: Record<string, Profile>,
  deleted: string[],
): Record<string, ProfileAssetDiff> {
  const diff: Record<string, ProfileAssetDiff> = {};
  for (const [id, profile] of Object.entries(afterProfiles)) {
    const before = beforeAssets[id] ?? new Set<string>();
    const after = new Set(profile.assets);
    let added = 0;
    let removed = 0;
    for (const assetId of after) if (!before.has(assetId)) added += 1;
    for (const assetId of before) if (!after.has(assetId)) removed += 1;
    diff[id] = { added, removed, total: after.size };
  }
  for (const id of deleted) {
    const before = beforeAssets[id] ?? new Set<string>();
    diff[id] = { added: 0, removed: before.size, total: 0 };
  }
  return diff;
}

function reject(code: string, message: string): ProfileMutationResult {
  return {
    status: 'rejected',
    created: [],
    updated: [],
    deleted: [],
    diff: {},
    profilesRevision: '',
    catalogRevision: '',
    error: { code, message },
  };
}

function rejectResult(
  profilesRevision: string,
  catalogRevision: string,
  code: string,
  message: string,
): ProfileMutationResult {
  return {
    status: 'rejected',
    created: [],
    updated: [],
    deleted: [],
    diff: {},
    profilesRevision,
    catalogRevision,
    error: { code, message },
  };
}
