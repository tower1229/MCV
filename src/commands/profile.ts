import type { DeviceContext } from '../adapters/types.js';
import {
  OPERATION_SCHEMA_VERSION,
  type McvError,
  type Report,
  type Result,
} from '../operations/contracts.js';
import {
  createProfileService,
  type ProfileService,
} from '../profiles/service.js';
import type {
  Profile,
  ProfileInventory,
  ProfileMutationResult,
} from '../profiles/contracts.js';
import { resolveBoundRepository } from '../utils/repository.js';
import { presentJson } from '../renderers/json.js';
import {
  renderProfileListDocument,
  renderProfileMutationDocument,
  renderProfileShowDocument,
} from '../renderers/profile.js';
import { presentDocument } from '../presentation/output.js';

export type ProfileCommandName = 'list' | 'show' | 'create' | 'edit' | 'delete';

export interface ProfileSummary {
  id: string;
  title?: string;
  description?: string;
  assetCount: number;
  assets: string[];
}

export interface ProfileListReport extends Omit<Report, 'changes' | 'issues' | 'nextActions' | 'ready'> {
  operation: 'profile';
  command: 'list';
  status: 'reported';
  ready: true;
  profilesRevision: string;
  catalogRevision: string;
  profiles: ProfileSummary[];
  unassignedCount: number;
  unassignedAssetIds: string[];
  changes: [];
  issues: [];
  nextActions: string[];
}

export interface ProfileShowReport extends Omit<Report, 'changes' | 'issues' | 'nextActions' | 'ready'> {
  operation: 'profile';
  command: 'show';
  status: 'reported';
  ready: true;
  profilesRevision: string;
  catalogRevision: string;
  profile: ProfileSummary;
  unassignedCount: number;
  unassignedAssetIds: string[];
  changes: [];
  issues: [];
  nextActions: string[];
}

export interface ProfileMutationData {
  created: string[];
  updated: string[];
  deleted: string[];
  diff: ProfileMutationResult['diff'];
  profilesRevision: string;
  catalogRevision: string;
  profile?: ProfileSummary;
}

export type ProfileMutationReport = Result<ProfileMutationData> & {
  operation: 'profile';
  command: 'create' | 'edit' | 'delete';
  profilesRevision: string;
  catalogRevision: string;
};

export interface ProfileFailedReport {
  schemaVersion: typeof OPERATION_SCHEMA_VERSION;
  operation: 'profile';
  command: ProfileCommandName;
  status: 'failed';
  ready: false;
  repositoryPath: string | null;
  profilesRevision: string;
  catalogRevision: string;
  changes: [];
  issues: Array<{ code: string; severity: 'error'; message: string }>;
  nextActions: string[];
  error: McvError;
}

export interface ProfileOutputOptions {
  json?: boolean;
  verbose?: boolean;
}

export interface ProfileCreateOptions extends ProfileOutputOptions {
  title?: string;
  description?: string;
  add?: string[];
  expectedRevision?: string;
}

export interface ProfileEditOptions extends ProfileOutputOptions {
  title?: string;
  description?: string;
  add?: string[];
  remove?: string[];
  expectedRevision?: string;
}

export interface ProfileDeleteOptions extends ProfileOutputOptions {
  expectedRevision?: string;
}

export function listProfiles(
  context: DeviceContext,
  options: ProfileOutputOptions = {},
): ProfileListReport | ProfileFailedReport {
  try {
    const report = buildListReport(context);
    renderList(context, report, options);
    return report;
  } catch (error) {
    const failed = failedReport('list', context, error);
    renderFailed(context, failed, options);
    process.exitCode = 1;
    return failed;
  }
}

export function showProfile(
  context: DeviceContext,
  profileId: string,
  options: ProfileOutputOptions = {},
): ProfileShowReport | ProfileFailedReport {
  try {
    const report = buildShowReport(context, profileId);
    renderShow(context, report, options);
    return report;
  } catch (error) {
    const failed = failedReport('show', context, error);
    renderFailed(context, failed, options);
    process.exitCode = 1;
    return failed;
  }
}

export function createProfile(
  context: DeviceContext,
  profileId: string,
  options: ProfileCreateOptions = {},
): ProfileMutationReport {
  const report = mutateProfile(context, 'create', (service, inventory) =>
    service.create({
      id: profileId,
      title: options.title,
      description: options.description,
      assets: options.add,
      ...expectedRevisions(inventory, options.expectedRevision),
    }));
  renderMutation(context, report, options);
  if (report.status !== 'succeeded') process.exitCode = 1;
  return report;
}

export function editProfile(
  context: DeviceContext,
  profileId: string,
  options: ProfileEditOptions = {},
): ProfileMutationReport {
  const report = mutateProfile(context, 'edit', (service, inventory) =>
    service.update({
      id: profileId,
      title: options.title,
      description: options.description,
      addAssets: options.add,
      removeAssets: options.remove,
      ...expectedRevisions(inventory, options.expectedRevision),
    }));
  renderMutation(context, report, options);
  if (report.status !== 'succeeded') process.exitCode = 1;
  return report;
}

export function deleteProfile(
  context: DeviceContext,
  profileId: string,
  options: ProfileDeleteOptions = {},
): ProfileMutationReport {
  const report = mutateProfile(context, 'delete', (service, inventory) =>
    service.delete({
      id: profileId,
      ...expectedRevisions(inventory, options.expectedRevision),
    }));
  renderMutation(context, report, options);
  if (report.status !== 'succeeded') process.exitCode = 1;
  return report;
}

function buildListReport(context: DeviceContext): ProfileListReport {
  const repositoryPath = resolveBoundRepository(context);
  const inventory = createProfileService(repositoryPath).inspect();
  return {
    schemaVersion: OPERATION_SCHEMA_VERSION,
    operation: 'profile',
    command: 'list',
    status: 'reported',
    ready: true,
    repositoryPath,
    profilesRevision: inventory.profilesRevision,
    catalogRevision: inventory.catalogRevision,
    profiles: summarizeProfiles(inventory.profiles),
    unassignedCount: inventory.unassignedAssetIds.length,
    unassignedAssetIds: [...inventory.unassignedAssetIds],
    changes: [],
    issues: [],
    nextActions: inventory.unassignedAssetIds.length > 0
      ? ['Classify Unassigned Assets with `mcv profile edit <id> --add ...` or create a Profile.']
      : [],
  };
}

function buildShowReport(context: DeviceContext, profileId: string): ProfileShowReport {
  const repositoryPath = resolveBoundRepository(context);
  const inventory = createProfileService(repositoryPath).inspect();
  const profile = inventory.profiles[profileId];
  if (!profile) {
    throw Object.assign(new Error(`Profile ${profileId} does not exist.`), {
      code: 'profile.notFound',
    });
  }
  return {
    schemaVersion: OPERATION_SCHEMA_VERSION,
    operation: 'profile',
    command: 'show',
    status: 'reported',
    ready: true,
    repositoryPath,
    profilesRevision: inventory.profilesRevision,
    catalogRevision: inventory.catalogRevision,
    profile: summarizeProfile(profileId, profile),
    unassignedCount: inventory.unassignedAssetIds.length,
    unassignedAssetIds: [...inventory.unassignedAssetIds],
    changes: [],
    issues: [],
    nextActions: [],
  };
}

function mutateProfile(
  context: DeviceContext,
  command: 'create' | 'edit' | 'delete',
  run: (service: ProfileService, inventory: ProfileInventory) => ProfileMutationResult,
): ProfileMutationReport {
  try {
    const repositoryPath = resolveBoundRepository(context);
    const service = createProfileService(repositoryPath);
    const inventory = service.inspect();
    const result = run(service, inventory);
    if (result.status !== 'updated') {
      return mutationFailure(repositoryPath, command, result);
    }
    const next = service.inspect();
    const changedId = result.created[0] ?? result.updated[0];
    return {
      schemaVersion: OPERATION_SCHEMA_VERSION,
      operation: 'profile',
      command,
      status: 'succeeded',
      repositoryPath,
      profilesRevision: result.profilesRevision,
      catalogRevision: result.catalogRevision,
      changes: [],
      issues: [],
      nextActions: immutableIdGuidance(command),
      data: {
        created: result.created,
        updated: result.updated,
        deleted: result.deleted,
        diff: result.diff,
        profilesRevision: result.profilesRevision,
        catalogRevision: result.catalogRevision,
        profile: changedId && next.profiles[changedId]
          ? summarizeProfile(changedId, next.profiles[changedId])
          : undefined,
      },
    };
  } catch (error) {
    return failedMutation(command, context, error);
  }
}

function mutationFailure(
  repositoryPath: string,
  command: 'create' | 'edit' | 'delete',
  result: ProfileMutationResult,
): ProfileMutationReport {
  const error = toMcvError(result);
  return {
    schemaVersion: OPERATION_SCHEMA_VERSION,
    operation: 'profile',
    command,
    status: 'failed',
    repositoryPath,
    profilesRevision: result.profilesRevision,
    catalogRevision: result.catalogRevision,
    changes: [],
    issues: [{
      code: error.code,
      severity: 'error',
      message: error.message,
    }],
    nextActions: error.nextActions,
    error,
  };
}

function failedMutation(
  command: 'create' | 'edit' | 'delete',
  context: DeviceContext,
  error: unknown,
): ProfileMutationReport {
  const failed = failedReport(command, context, error);
  return {
    ...failed,
    command,
  };
}

function failedReport(
  command: ProfileCommandName,
  context: DeviceContext,
  error: unknown,
): ProfileFailedReport {
  const repositoryPath = (() => {
    try {
      return resolveBoundRepository(context);
    } catch {
      return null;
    }
  })();
  const code = error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
    ? error.code
    : 'profile.failed';
  const message = error instanceof Error ? error.message : String(error);
  const mcvError: McvError = {
    code,
    message,
    nextActions: code === 'profile.notFound'
      ? ['Run `mcv profile list` to see available Profiles.']
      : [],
  };
  return {
    schemaVersion: OPERATION_SCHEMA_VERSION,
    operation: 'profile',
    command,
    status: 'failed',
    ready: false,
    repositoryPath,
    profilesRevision: '',
    catalogRevision: '',
    changes: [],
    issues: [{ code, severity: 'error', message }],
    nextActions: mcvError.nextActions,
    error: mcvError,
  };
}

function expectedRevisions(
  inventory: ProfileInventory,
  expectedRevision?: string,
): { expectedProfilesRevision: string; expectedCatalogRevision: string } {
  return {
    expectedProfilesRevision: expectedRevision ?? inventory.profilesRevision,
    expectedCatalogRevision: inventory.catalogRevision,
  };
}

function summarizeProfiles(profiles: Record<string, Profile>): ProfileSummary[] {
  return Object.entries(profiles).map(([id, profile]) => summarizeProfile(id, profile));
}

function summarizeProfile(id: string, profile: Profile): ProfileSummary {
  const summary: ProfileSummary = {
    id,
    assetCount: profile.assets.length,
    assets: [...profile.assets],
  };
  if (profile.title !== undefined) summary.title = profile.title;
  if (profile.description !== undefined) summary.description = profile.description;
  return summary;
}

function toMcvError(result: ProfileMutationResult): McvError {
  const code = result.error?.code ?? 'profile.failed';
  const message = result.error?.message ?? 'Profile mutation failed.';
  const nextActions: string[] = [];
  if (code === 'profile.revisionConflict') {
    nextActions.push('Re-run `mcv profile list --json` and pass the current `--expected-revision`.');
  } else if (code === 'profile.globalRequired') {
    nextActions.push('The built-in global Profile cannot be deleted. Create a new Profile, then delete the old one if you need a different ID.');
  } else if (code === 'profile.invalidId') {
    nextActions.push('Use a Profile ID with lowercase letters, digits, and hyphens (1-64 characters). Profile IDs cannot be renamed; create a new Profile then delete the old one.');
  } else if (code === 'profile.unknownAsset' || code === 'profile.invalidAssetId') {
    nextActions.push('Run `mcv profile list --json` and choose Asset IDs from the Catalog or Unassigned set.');
  } else if (code === 'profile.notFound') {
    nextActions.push('Run `mcv profile list` to see available Profiles.');
  } else if (code === 'profile.alreadyExists') {
    nextActions.push('Choose a different Profile ID, or edit the existing Profile.');
  }
  return { code, message, nextActions };
}

function immutableIdGuidance(command: 'create' | 'edit' | 'delete'): string[] {
  if (command === 'create') {
    return ['Profile IDs are immutable; to change an ID, create a new Profile then delete the old one.'];
  }
  return [];
}

function renderList(
  context: DeviceContext,
  report: ProfileListReport,
  options: ProfileOutputOptions,
): void {
  if (options.json) {
    presentJson(report);
    return;
  }
  presentDocument(context, renderProfileListDocument(report), { verbose: options.verbose });
}

function renderShow(
  context: DeviceContext,
  report: ProfileShowReport,
  options: ProfileOutputOptions,
): void {
  if (options.json) {
    presentJson(report);
    return;
  }
  presentDocument(context, renderProfileShowDocument(report), { verbose: options.verbose });
}

function renderMutation(
  context: DeviceContext,
  report: ProfileMutationReport,
  options: ProfileOutputOptions,
): void {
  if (options.json) {
    presentJson(report);
    return;
  }
  presentDocument(context, renderProfileMutationDocument(report), { verbose: options.verbose });
}

function renderFailed(
  context: DeviceContext,
  report: ProfileFailedReport,
  options: ProfileOutputOptions,
): void {
  if (options.json) {
    presentJson(report);
    return;
  }
  presentDocument(context, renderProfileMutationDocument(report), { verbose: options.verbose });
}
