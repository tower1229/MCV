import { fact, instructionActions, paragraph, status } from '../presentation/builders.js';
export function renderProfileListDocument(report) {
    const details = [
        fact('Repository', report.repositoryPath ?? 'not bound', 'muted', 'path'),
        fact('Profiles Revision', report.profilesRevision, 'muted', 'id'),
        fact('Catalog Revision', report.catalogRevision, 'muted', 'id'),
        colonFact('Profiles', String(report.profiles.length), 'information'),
        ...report.profiles.map((profile) => paragraph([
            { text: `  ${profile.id}`, kind: 'id' },
            { text: `${profile.title ? ` · ${profile.title}` : ''} · ${profile.assetCount} assets` },
        ])),
        colonFact('Unassigned', `${report.unassignedCount} assets`, report.unassignedCount > 0 ? 'attention' : 'muted'),
    ];
    return {
        operation: 'profile', outcome: report.status, title: 'Profile List', summary: [],
        overflowSummary: [
            fact('Repository', report.repositoryPath ?? 'not bound', 'muted', 'path'),
            colonFact('Profiles', String(report.profiles.length), 'information'),
            colonFact('Unassigned', `${report.unassignedCount} assets`, report.unassignedCount > 0 ? 'attention' : 'muted'),
        ],
        details, nextActions: instructionActions(report.nextActions), detailPolicy: 'overflow',
    };
}
export function renderProfileShowDocument(report) {
    const { profile } = report;
    const details = [
        fact('Repository', report.repositoryPath ?? 'not bound', 'muted', 'path'),
        fact('Profiles Revision', report.profilesRevision, 'muted', 'id'),
        fact('Catalog Revision', report.catalogRevision, 'muted', 'id'),
        fact('Profile', profile.id, 'information', 'id'),
        ...(profile.title ? [colonFact('Title', profile.title, 'information')] : []),
        ...(profile.description ? [colonFact('Description', profile.description, 'information')] : []),
        colonFact('Assets', String(profile.assetCount), 'information'),
        ...(profile.assets.length ? [{ kind: 'list', items: profile.assets.map((text) => ({ text, kind: 'id' })) }] : []),
        colonFact('Unassigned', `${report.unassignedCount} assets`, report.unassignedCount > 0 ? 'attention' : 'muted'),
    ];
    return {
        operation: 'profile', outcome: report.status, title: 'Profile Details', summary: [],
        overflowSummary: [
            fact('Repository', report.repositoryPath ?? 'not bound', 'muted', 'path'),
            fact('Profile', `${profile.id}${profile.title ? ` · ${truncate(profile.title)}` : ''}`, 'information', 'id'),
            fact('Assets', String(profile.assetCount), 'information'),
            fact('Unassigned', `${report.unassignedCount} assets`, report.unassignedCount > 0 ? 'attention' : 'muted'),
        ],
        details, nextActions: instructionActions(report.nextActions), detailPolicy: 'overflow',
    };
}
export function renderProfileMutationDocument(report) {
    const details = profileMutationBlocks(report);
    return {
        operation: 'profile', outcome: report.status, title: 'Profile Result', summary: [],
        overflowSummary: details.slice(0, report.status === 'failed' ? 2 : 1),
        details, nextActions: instructionActions(report.nextActions), detailPolicy: 'overflow',
    };
}
function profileMutationBlocks(report) {
    if (report.status === 'failed') {
        return [
            status('danger', `Profile ${report.command} failed: ${report.error.message}`),
            ...(report.error.code ? [fact('Error', report.error.code, 'danger')] : []),
            ...(report.error.technicalDetails ? [{ kind: 'literal', text: report.error.technicalDetails }] : []),
        ];
    }
    const data = report.data;
    return [
        status('success', `Profile ${report.command} succeeded.`),
        fact('Profiles Revision', report.profilesRevision, 'muted', 'id'),
        fact('Catalog Revision', report.catalogRevision, 'muted', 'id'),
        ...(data?.created.length ? [fact('Created', data.created.join(', '), 'success', 'id')] : []),
        ...(data?.updated.length ? [fact('Updated', data.updated.join(', '), 'attention', 'id')] : []),
        ...(data?.deleted.length ? [fact('Deleted', data.deleted.join(', '), 'danger', 'id')] : []),
        ...(data?.profile ? [fact('Profile', `${data.profile.id} · ${data.profile.assetCount} assets`, 'information', 'id')] : []),
    ];
}
function truncate(value) {
    return value.length <= 120 ? value : `${value.slice(0, 117)}...`;
}
function colonFact(label, value, role) {
    return fact(label, value, role);
}
