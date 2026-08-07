import type {
  ProfileFailedReport,
  ProfileListReport,
  ProfileMutationReport,
  ProfileShowReport,
} from '../commands/profile.js';

export function renderProfileListPlain(report: ProfileListReport): string[] {
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
  for (const action of report.nextActions) lines.push(`Next: ${action}`);
  return lines;
}

export function renderProfileShowPlain(report: ProfileShowReport): string[] {
  const { profile } = report;
  const lines = [
    `Repository: ${report.repositoryPath}`,
    `Profiles Revision: ${report.profilesRevision}`,
    `Catalog Revision: ${report.catalogRevision}`,
    `Profile: ${profile.id}`,
  ];
  if (profile.title) lines.push(`Title: ${profile.title}`);
  if (profile.description) lines.push(`Description: ${profile.description}`);
  lines.push(`Assets: ${profile.assetCount}`);
  for (const assetId of profile.assets) lines.push(`  ${assetId}`);
  lines.push(`Unassigned: ${report.unassignedCount} assets`);
  return lines;
}

export function renderProfileMutationPlain(
  report: ProfileMutationReport | ProfileFailedReport,
): string[] {
  if (report.status === 'failed') {
    const lines = [
      `Profile ${report.command} failed: ${report.error.message}`,
    ];
    if (report.error.code) lines.push(`Error: ${report.error.code}`);
    for (const action of report.nextActions) lines.push(`Next: ${action}`);
    return lines;
  }

  const lines = [
    `Profile ${report.command} succeeded.`,
    `Profiles Revision: ${report.profilesRevision}`,
    `Catalog Revision: ${report.catalogRevision}`,
  ];
  const data = report.data;
  if (data?.created.length) lines.push(`Created: ${data.created.join(', ')}`);
  if (data?.updated.length) lines.push(`Updated: ${data.updated.join(', ')}`);
  if (data?.deleted.length) lines.push(`Deleted: ${data.deleted.join(', ')}`);
  if (data?.profile) {
    lines.push(`Profile: ${data.profile.id} · ${data.profile.assetCount} assets`);
  }
  for (const action of report.nextActions) lines.push(`Next: ${action}`);
  return lines;
}
