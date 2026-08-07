export interface Profile {
  title?: string;
  description?: string;
  assets: string[];
}

export interface ProfilesDocument {
  schemaVersion: 1;
  profiles: Record<string, Profile>;
}

export interface ProfileInventory {
  catalogRevision: string;
  profilesRevision: string;
  profiles: Record<string, Profile>;
  unassignedAssetIds: string[];
  catalogAssetIds: string[];
}

export interface ProfileMutationBase {
  expectedProfilesRevision: string;
  expectedCatalogRevision: string;
}

export interface CreateProfileInput extends ProfileMutationBase {
  id: string;
  title?: string;
  description?: string;
  assets?: string[];
}

export interface UpdateProfileInput extends ProfileMutationBase {
  id: string;
  title?: string;
  description?: string;
  assets?: string[];
  addAssets?: string[];
  removeAssets?: string[];
}

export interface DeleteProfileInput extends ProfileMutationBase {
  id: string;
}

export interface ReplaceProfilesInput extends ProfileMutationBase {
  profiles: Record<string, Profile>;
}

export interface ProfileAssetDiff {
  added: number;
  removed: number;
  total: number;
}

export interface ProfileMutationResult {
  status: 'updated' | 'conflict' | 'rejected';
  created: string[];
  updated: string[];
  deleted: string[];
  diff: Record<string, ProfileAssetDiff>;
  profilesRevision: string;
  catalogRevision: string;
  error?: {
    code: string;
    message: string;
  };
}

export const GLOBAL_PROFILE_ID = 'global';
export const PROFILES_SCHEMA_VERSION = 1 as const;
export const PROFILE_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
