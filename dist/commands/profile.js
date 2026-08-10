import { OPERATION_SCHEMA_VERSION, } from '../operations/contracts.js';
import { createProfileService, } from '../profiles/service.js';
import { resolveBoundRepository } from '../utils/repository.js';
import { renderJson } from '../renderers/json.js';
import { renderProfileListDocument, renderProfileMutationDocument, renderProfileShowDocument, } from '../renderers/profile.js';
import { presentHumanDocument } from '../cli/human-output.js';
export function listProfiles(context, options = {}) {
    try {
        const report = buildListReport(context);
        renderList(context, report, options);
        return report;
    }
    catch (error) {
        const failed = failedReport('list', context, error);
        renderFailed(context, failed, options);
        process.exitCode = 1;
        return failed;
    }
}
export function showProfile(context, profileId, options = {}) {
    try {
        const report = buildShowReport(context, profileId);
        renderShow(context, report, options);
        return report;
    }
    catch (error) {
        const failed = failedReport('show', context, error);
        renderFailed(context, failed, options);
        process.exitCode = 1;
        return failed;
    }
}
export function createProfile(context, profileId, options = {}) {
    const report = mutateProfile(context, 'create', (service, inventory) => service.create({
        id: profileId,
        title: options.title,
        description: options.description,
        assets: options.add,
        ...expectedRevisions(inventory, options.expectedRevision),
    }));
    renderMutation(context, report, options);
    if (report.status !== 'succeeded')
        process.exitCode = 1;
    return report;
}
export function editProfile(context, profileId, options = {}) {
    const report = mutateProfile(context, 'edit', (service, inventory) => service.update({
        id: profileId,
        title: options.title,
        description: options.description,
        addAssets: options.add,
        removeAssets: options.remove,
        ...expectedRevisions(inventory, options.expectedRevision),
    }));
    renderMutation(context, report, options);
    if (report.status !== 'succeeded')
        process.exitCode = 1;
    return report;
}
export function deleteProfile(context, profileId, options = {}) {
    const report = mutateProfile(context, 'delete', (service, inventory) => service.delete({
        id: profileId,
        ...expectedRevisions(inventory, options.expectedRevision),
    }));
    renderMutation(context, report, options);
    if (report.status !== 'succeeded')
        process.exitCode = 1;
    return report;
}
function buildListReport(context) {
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
function buildShowReport(context, profileId) {
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
function mutateProfile(context, command, run) {
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
    }
    catch (error) {
        return failedMutation(command, context, error);
    }
}
function mutationFailure(repositoryPath, command, result) {
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
function failedMutation(command, context, error) {
    const failed = failedReport(command, context, error);
    return {
        ...failed,
        command,
    };
}
function failedReport(command, context, error) {
    const repositoryPath = (() => {
        try {
            return resolveBoundRepository(context);
        }
        catch {
            return null;
        }
    })();
    const code = error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
        ? error.code
        : 'profile.failed';
    const message = error instanceof Error ? error.message : String(error);
    const mcvError = {
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
function expectedRevisions(inventory, expectedRevision) {
    return {
        expectedProfilesRevision: expectedRevision ?? inventory.profilesRevision,
        expectedCatalogRevision: inventory.catalogRevision,
    };
}
function summarizeProfiles(profiles) {
    return Object.entries(profiles).map(([id, profile]) => summarizeProfile(id, profile));
}
function summarizeProfile(id, profile) {
    const summary = {
        id,
        assetCount: profile.assets.length,
        assets: [...profile.assets],
    };
    if (profile.title !== undefined)
        summary.title = profile.title;
    if (profile.description !== undefined)
        summary.description = profile.description;
    return summary;
}
function toMcvError(result) {
    const code = result.error?.code ?? 'profile.failed';
    const message = result.error?.message ?? 'Profile mutation failed.';
    const nextActions = [];
    if (code === 'profile.revisionConflict') {
        nextActions.push('Re-run `mcv profile list --json` and pass the current `--expected-revision`.');
    }
    else if (code === 'profile.globalRequired') {
        nextActions.push('The built-in global Profile cannot be deleted. Create a new Profile, then delete the old one if you need a different ID.');
    }
    else if (code === 'profile.invalidId') {
        nextActions.push('Use a Profile ID with lowercase letters, digits, and hyphens (1-64 characters). Profile IDs cannot be renamed; create a new Profile then delete the old one.');
    }
    else if (code === 'profile.unknownAsset' || code === 'profile.invalidAssetId') {
        nextActions.push('Run `mcv profile list --json` and choose Asset IDs from the Catalog or Unassigned set.');
    }
    else if (code === 'profile.notFound') {
        nextActions.push('Run `mcv profile list` to see available Profiles.');
    }
    else if (code === 'profile.alreadyExists') {
        nextActions.push('Choose a different Profile ID, or edit the existing Profile.');
    }
    return { code, message, nextActions };
}
function immutableIdGuidance(command) {
    if (command === 'create') {
        return ['Profile IDs are immutable; to change an ID, create a new Profile then delete the old one.'];
    }
    return [];
}
function renderList(context, report, options) {
    if (options.json) {
        console.log(renderJson(report));
        return;
    }
    presentHumanDocument(context, renderProfileListDocument(report), { verbose: options.verbose });
}
function renderShow(context, report, options) {
    if (options.json) {
        console.log(renderJson(report));
        return;
    }
    presentHumanDocument(context, renderProfileShowDocument(report), { verbose: options.verbose });
}
function renderMutation(context, report, options) {
    if (options.json) {
        console.log(renderJson(report));
        return;
    }
    presentHumanDocument(context, renderProfileMutationDocument(report), { verbose: options.verbose });
}
function renderFailed(context, report, options) {
    if (options.json) {
        console.log(renderJson(report));
        return;
    }
    presentHumanDocument(context, renderProfileMutationDocument(report), { verbose: options.verbose });
}
