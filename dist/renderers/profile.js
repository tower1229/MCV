import { withoutNextActions } from './human-document.js';
export function renderProfileListDocument(report) {
    return {
        operation: 'profile',
        title: 'Profile List',
        summary: [],
        overflowSummary: [
            `Repository: ${report.repositoryPath}`,
            `Profiles: ${report.profiles.length}`,
            `Unassigned: ${report.unassignedCount} assets`,
        ],
        details: withoutNextActions(renderProfileListPlain(report)),
        nextActions: report.nextActions,
        detailPolicy: 'overflow',
    };
}
export function renderProfileShowDocument(report) {
    const title = report.profile.title ? ` · ${truncate(report.profile.title)}` : '';
    return {
        operation: 'profile',
        title: 'Profile Details',
        summary: [],
        overflowSummary: [
            `Repository: ${report.repositoryPath}`,
            `Profile: ${report.profile.id}${title}`,
            `Assets: ${report.profile.assetCount}`,
            `Unassigned: ${report.unassignedCount} assets`,
        ],
        details: withoutNextActions(renderProfileShowPlain(report)),
        nextActions: report.nextActions,
        detailPolicy: 'overflow',
    };
}
export function renderProfileListPlain(report) {
    const lines = [
        `Repository: ${report.repositoryPath}`,
        `Profiles Revision: ${report.profilesRevision}`,
        `Catalog Revision: ${report.catalogRevision}`,
        `Profiles: ${report.profiles.length}`,
    ];
    for (const profile of report.profiles) {
        const title = profile.title ? ` · ${profile.title}` : '';
        lines.push(`  ${profile.id}${title} · ${profile.assetCount} assets`);
    }
    lines.push(`Unassigned: ${report.unassignedCount} assets`);
    for (const action of report.nextActions)
        lines.push(`Next: ${action}`);
    return lines;
}
export function renderProfileShowPlain(report) {
    const { profile } = report;
    const lines = [
        `Repository: ${report.repositoryPath}`,
        `Profiles Revision: ${report.profilesRevision}`,
        `Catalog Revision: ${report.catalogRevision}`,
        `Profile: ${profile.id}`,
    ];
    if (profile.title)
        lines.push(`Title: ${profile.title}`);
    if (profile.description)
        lines.push(`Description: ${profile.description}`);
    lines.push(`Assets: ${profile.assetCount}`);
    for (const assetId of profile.assets)
        lines.push(`  ${assetId}`);
    lines.push(`Unassigned: ${report.unassignedCount} assets`);
    return lines;
}
export function renderProfileMutationPlain(report) {
    if (report.status === 'failed') {
        const lines = [
            `Profile ${report.command} failed: ${report.error.message}`,
        ];
        if (report.error.code)
            lines.push(`Error: ${report.error.code}`);
        if (report.error.technicalDetails)
            lines.push(`Details: ${report.error.technicalDetails}`);
        for (const action of report.nextActions)
            lines.push(`Next: ${action}`);
        return lines;
    }
    const lines = [
        `Profile ${report.command} succeeded.`,
        `Profiles Revision: ${report.profilesRevision}`,
        `Catalog Revision: ${report.catalogRevision}`,
    ];
    const data = report.data;
    if (data?.created.length)
        lines.push(`Created: ${data.created.join(', ')}`);
    if (data?.updated.length)
        lines.push(`Updated: ${data.updated.join(', ')}`);
    if (data?.deleted.length)
        lines.push(`Deleted: ${data.deleted.join(', ')}`);
    if (data?.profile) {
        lines.push(`Profile: ${data.profile.id} · ${data.profile.assetCount} assets`);
    }
    for (const action of report.nextActions)
        lines.push(`Next: ${action}`);
    return lines;
}
export function renderProfileMutationDocument(report) {
    const full = renderProfileMutationPlain(report);
    const overflowSummary = report.status === 'failed'
        ? [
            `Profile ${report.command} failed: ${report.error.message}`,
            `Error: ${report.error.code}`,
        ]
        : [`Profile ${report.command} succeeded.`];
    return {
        operation: 'profile',
        title: 'Profile Result',
        summary: [],
        overflowSummary,
        details: withoutNextActions(full),
        nextActions: report.nextActions,
        detailPolicy: 'overflow',
    };
}
function truncate(value) {
    return value.length <= 120 ? value : `${value.slice(0, 117)}...`;
}
