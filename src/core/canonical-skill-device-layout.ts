import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import type { DeviceContext } from '../adapters/types.js';
import { findSymbolicLinkAncestor, hashFile } from '../utils/files.js';
import { isRecord } from '../utils/objects.js';

export type CanonicalSkillIde = 'codex' | 'claude-code' | 'gemini' | 'gemini-cli' | 'antigravity';
export type CanonicalSkillTarget =
  | { owner: 'canonical-store'; ide?: never }
  | { owner: 'ide'; ide: CanonicalSkillIde };

export type CanonicalSkillLayoutFile = {
  capability: 'rules' | 'skills' | 'mcp' | 'native';
  targetPath: string;
  content: string | Buffer;
} & CanonicalSkillTarget;

export interface CanonicalSkillMaterialization<T extends CanonicalSkillLayoutFile> {
  source: T;
  targetPath: string;
}

export interface CanonicalSkillProjection {
  owner: 'ide';
  ide: CanonicalSkillIde;
  packageName: string;
  targetPath: string;
  physicalTargetPath: string;
  materializationPaths: string[];
}

export interface CanonicalSkillProjectionSurface {
  ide: CanonicalSkillIde;
  root: string;
  supportsManagedLinks: boolean;
}

export interface CanonicalSkillDeviceLayout<T extends CanonicalSkillLayoutFile> {
  filesOutsideLayout: T[];
  materializations: CanonicalSkillMaterialization<T>[];
  filesForLinkClassification: CanonicalSkillLayoutFile[];
  missingProjections: CanonicalSkillProjection[];
  conflicts: string[];
}

export type CanonicalSkillLinkOutcome = {
  status: 'satisfied-via-link' | 'blocked';
  ownership: 'external' | 'managed';
  scope: 'skill-package' | 'shared-link-root';
  linkPath: string;
  linkPaths: string[];
  resolvedPath?: string;
  resolvedPaths?: string[];
  packageNames: string[];
  affectedFileCount: number;
  reason?: 'divergent' | 'dangling' | 'cycle' | 'physical-target-conflict' | 'unclassified';
} & CanonicalSkillTarget;

export interface CanonicalSkillLayoutIssue {
  severity: 'notice' | 'error';
  code: string;
  message: string;
  details?: string;
}

export function canonicalDeviceSkillStoreRoot(context: DeviceContext): string {
  return path.join(context.homeDir, '.agents', 'skills');
}

export function deployPathExists(targetPath: string): boolean {
  try {
    fs.lstatSync(targetPath);
    return true;
  } catch {
    return false;
  }
}

export function hashDeviceTopologyNode(targetPath: string): string {
  const hash = crypto.createHash('sha256');
  const resolved = path.resolve(targetPath);
  if (!deployPathExists(resolved)) {
    hash.update('<missing>\0');
    hash.update(relevantAncestorTopology(resolved));
    return hash.digest('hex');
  }
  const stat = fs.lstatSync(resolved);
  if (stat.isSymbolicLink()) {
    hash.update(relevantAncestorTopology(resolved));
    hash.update(`symlink\0${fs.readlinkSync(resolved)}\0`);
    try {
      const physical = fs.realpathSync(resolved);
      hash.update(`physical\0${physical}\0`);
      const physicalStat = fs.statSync(physical);
      hash.update(physicalStat.isDirectory() ? 'directory' : physicalStat.isFile() ? 'file' : 'other');
    } catch {
      hash.update('physical\0<unresolved>');
    }
    return hash.digest('hex');
  }
  if (stat.isDirectory()) {
    hash.update(`directory\0${resolved}`);
    return hash.digest('hex');
  }
  const contentHash = hashFile(resolved);
  if (!resolved.includes(`${path.sep}skills${path.sep}`)) return contentHash;
  hash.update(`content\0${contentHash}\0`);
  hash.update(relevantAncestorTopology(resolved));
  return hash.digest('hex');
}

export function planCanonicalSkillDeviceLayout<T extends CanonicalSkillLayoutFile>({
  files,
  context,
  useManagedLinks,
  projectionSurfaces = [],
}: {
  files: T[];
  context: DeviceContext;
  useManagedLinks: boolean;
  projectionSurfaces?: CanonicalSkillProjectionSurface[];
}): CanonicalSkillDeviceLayout<T> {
  if (!useManagedLinks) {
    return {
      filesOutsideLayout: files,
      materializations: [],
      filesForLinkClassification: files,
      missingProjections: [],
      conflicts: [],
    };
  }

  const storeRoot = canonicalDeviceSkillStoreRoot(context);
  const linkCapableSurfaces = projectionSurfaces.filter((surface) => surface.supportsManagedLinks);
  const linkCapableIde = new Set(linkCapableSurfaces.map((surface) => surface.ide));
  const copyOnlySkillFile = (file: T): boolean =>
    file.capability === 'skills'
    && file.owner === 'ide'
    && !linkCapableIde.has(file.ide)
    && !isStoreSkillPath(file.targetPath, storeRoot);
  const filesOutsideLayout = files.filter((file) =>
    file.capability !== 'skills' || copyOnlySkillFile(file));
  const materializationsByPath = new Map<string, CanonicalSkillMaterialization<T>>();
  const conflicts: string[] = [];
  for (const file of files.filter((candidate) =>
    candidate.capability === 'skills' && !copyOnlySkillFile(candidate))) {
    const relative = relativeSkillPath(file.targetPath);
    if (!relative) continue;
    const targetPath = path.join(storeRoot, relative);
    const existing = materializationsByPath.get(path.resolve(targetPath));
    if (existing && !toBuffer(existing.source.content).equals(toBuffer(file.content))) {
      conflicts.push(relative);
      continue;
    }
    materializationsByPath.set(path.resolve(targetPath), { source: file, targetPath });
  }

  const materializations = [...materializationsByPath.values()];
  const packageNames = [...new Set(materializations
    .map(({ targetPath }) => canonicalSkillPackageName(targetPath)))].sort();
  const missingProjections = linkCapableSurfaces.flatMap((surface) => {
    if (path.resolve(surface.root) === path.resolve(storeRoot)) return [];
    return packageNames.flatMap((packageName): CanonicalSkillProjection[] => {
      const targetPath = path.join(surface.root, packageName);
      if (fs.existsSync(targetPath) || findSymbolicLinkAncestor(targetPath)) return [];
      return [{
        owner: 'ide',
        ide: surface.ide,
        packageName,
        targetPath,
        physicalTargetPath: path.join(storeRoot, packageName),
        materializationPaths: materializations
          .map(({ targetPath: materializationPath }) => materializationPath)
          .filter((materializationPath) =>
            canonicalSkillPackageName(materializationPath) === packageName),
      }];
    });
  });
  const physicalFiles = materializations.map(({ source, targetPath }) =>
    canonicalStoreFile(source, targetPath));
  const linkClassificationIdeFiles = files.filter((file) =>
    file.capability === 'skills'
    && file.owner === 'ide'
    && linkCapableIde.has(file.ide));
  return {
    filesOutsideLayout,
    materializations,
    filesForLinkClassification: [
      ...filesOutsideLayout,
      ...physicalFiles,
      ...linkClassificationIdeFiles,
    ],
    missingProjections,
    conflicts,
  };
}

function isStoreSkillPath(targetPath: string, storeRoot: string): boolean {
  const relative = path.relative(path.resolve(storeRoot), path.resolve(targetPath));
  return relative === ''
    || (relative !== '..'
      && !relative.startsWith(`..${path.sep}`)
      && !path.isAbsolute(relative));
}

export function classifyCanonicalSkillLinks<T extends CanonicalSkillLayoutFile>(
  desired: T[],
  isManagedLink: (linkPath: string) => boolean,
): {
  outcomes: CanonicalSkillLinkOutcome[];
  issues: CanonicalSkillLayoutIssue[];
} {
  interface LinkedSkillFile {
    file: T;
    linkPath: string;
  }
  const linkedGroups = new Map<string, {
    scope: CanonicalSkillLinkOutcome['scope'];
    files: LinkedSkillFile[];
  }>();
  for (const file of desired) {
    if (file.capability !== 'skills') continue;
    const linkPath = findSymbolicLinkAncestor(file.targetPath);
    if (!linkPath) continue;
    const skillRoot = skillRootPath(file.targetPath);
    const withinSkillRoot = skillRoot !== undefined && isPathWithin(skillRoot, linkPath);
    const sharedRoot = withinSkillRoot && path.resolve(linkPath) === path.resolve(skillRoot);
    const groupingPath = sharedRoot
      ? linkPath
      : withinSkillRoot
        ? skillPackageRoot(file.targetPath)
        : linkPath;
    const scope = sharedRoot ? 'shared-link-root' as const : 'skill-package' as const;
    const key = `${canonicalSkillTargetKey(file)}\0${path.resolve(groupingPath)}`;
    const group = linkedGroups.get(key) ?? { scope, files: [] };
    group.files.push({ file, linkPath });
    linkedGroups.set(key, group);
  }

  const outcomes: CanonicalSkillLinkOutcome[] = [];
  const issues: CanonicalSkillLayoutIssue[] = [];
  const desiredByPath = new Map(desired
    .filter((file) => !findSymbolicLinkAncestor(file.targetPath))
    .map((file) => [path.resolve(file.targetPath), toBuffer(file.content)]));
  for (const { scope, files } of linkedGroups.values()) {
    const first = files[0].file;
    const linkPaths = [...new Set(files.map((entry) => entry.linkPath))].sort();
    const packageNames = [...new Set(files.map(({ file }) =>
      canonicalSkillPackageName(file.targetPath)))].sort();
    const managed = linkPaths.every(isManagedLink);
    const baseOutcome = {
      ownership: managed ? 'managed' as const : 'external' as const,
      scope,
      ...canonicalSkillTarget(first),
      linkPath: linkPaths[0],
      linkPaths,
      packageNames,
      affectedFileCount: files.length,
    };
    if (files.some(({ file, linkPath }) =>
      !isLinkWithinSkillRoot(file.targetPath, linkPath))) {
      outcomes.push({ ...baseOutcome, status: 'blocked', reason: 'unclassified' });
      issues.push(linkedSkillIssue(baseOutcome, canonicalSkillTarget(first), 'unclassified'));
      continue;
    }
    const resolvedByLink = new Map<string, string>();
    let resolutionFailure: NonNullable<CanonicalSkillLinkOutcome['reason']> | undefined;
    try {
      for (const linkPath of linkPaths) {
        resolvedByLink.set(linkPath, fs.realpathSync(linkPath));
      }
    } catch (error) {
      resolutionFailure = symbolicLinkFailureReason(error);
    }
    if (resolutionFailure) {
      outcomes.push({ ...baseOutcome, status: 'blocked', reason: resolutionFailure });
      issues.push(linkedSkillIssue(baseOutcome, canonicalSkillTarget(first), resolutionFailure));
      continue;
    }
    const resolvedPaths = [...new Set(resolvedByLink.values())].sort();
    const resolution = {
      ...(resolvedPaths.length === 1 ? { resolvedPath: resolvedPaths[0] } : {}),
      resolvedPaths,
    };
    let matches = true;
    try {
      matches = files.every(({ file }) =>
        fs.readFileSync(file.targetPath).equals(toBuffer(file.content)));
    } catch {
      matches = false;
    }
    const physicalTargetConflict = hasPhysicalTargetConflict(
      files,
      resolvedByLink,
      desiredByPath,
    );
    const followsEquivalentPhysicalTarget = linkedFilesMatchPhysicalDesired(
      files,
      resolvedByLink,
      desiredByPath,
    );
    if (!physicalTargetConflict && (matches || followsEquivalentPhysicalTarget)) {
      outcomes.push({ ...baseOutcome, ...resolution, status: 'satisfied-via-link' });
      issues.push({
        severity: 'notice',
        code: `deploy.skillsLinked.satisfied.${canonicalSkillTargetKey(first)}`,
        message: `Satisfied via link: ${packageSummary(packageNames)} (${files.length} affected file(s)).`,
        details: managed
          ? `${linkPaths.length} managed projection(s) resolve to ${resolvedPaths.join(', ')}.`
          : `${linkPaths.length} external link(s) resolve to ${resolvedPaths.join(', ')}; MCV will not take ownership or write through them.`,
      });
      continue;
    }
    const reason = physicalTargetConflict
      ? 'physical-target-conflict' as const
      : 'divergent' as const;
    outcomes.push({ ...baseOutcome, ...resolution, status: 'blocked', reason });
    issues.push(linkedSkillIssue(
      { ...baseOutcome, ...resolution },
      canonicalSkillTarget(first),
      reason,
    ));
  }
  return { outcomes, issues };
}

function relativeSkillPath(targetPath: string): string | undefined {
  const root = skillRootPath(targetPath);
  if (!root) return undefined;
  const relative = path.relative(root, path.resolve(targetPath));
  return relative && !relative.startsWith('..') ? relative : undefined;
}

export function canonicalSkillPackageName(targetPath: string): string {
  const segments = path.resolve(targetPath).split(path.sep);
  const skillsIndex = segments.lastIndexOf('skills');
  return skillsIndex >= 0 && segments[skillsIndex + 1]
    ? segments[skillsIndex + 1]
    : path.basename(path.dirname(targetPath));
}

function toBuffer(value: string | Buffer): Buffer {
  return Buffer.isBuffer(value) ? value : Buffer.from(value);
}

function canonicalStoreFile<T extends CanonicalSkillLayoutFile>(
  source: T,
  targetPath: string,
): CanonicalSkillLayoutFile {
  const { ide: _ide, ...withoutIde } = source;
  return {
    ...withoutIde,
    owner: 'canonical-store',
    targetPath,
  };
}

function canonicalSkillTarget(
  value: CanonicalSkillTarget,
): CanonicalSkillTarget {
  return value.owner === 'canonical-store'
    ? { owner: 'canonical-store' }
    : { owner: 'ide', ide: value.ide };
}

function canonicalSkillTargetKey(value: CanonicalSkillTarget): string {
  return value.owner === 'canonical-store' ? 'canonical-store' : value.ide;
}

function skillRootPath(targetPath: string): string | undefined {
  const resolvedTarget = path.resolve(targetPath);
  const marker = `${path.sep}skills${path.sep}`;
  const markerIndex = resolvedTarget.lastIndexOf(marker);
  return markerIndex < 0
    ? undefined
    : resolvedTarget.slice(0, markerIndex + marker.length - 1);
}

function skillPackageRoot(targetPath: string): string {
  const skillRoot = skillRootPath(targetPath);
  return skillRoot
    ? path.join(skillRoot, canonicalSkillPackageName(targetPath))
    : path.dirname(targetPath);
}

function isLinkWithinSkillRoot(targetPath: string, linkPath: string): boolean {
  const skillRoot = skillRootPath(targetPath);
  return skillRoot !== undefined && isPathWithin(skillRoot, linkPath);
}

function isPathWithin(root: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === ''
    || (relative !== '..'
      && !relative.startsWith(`..${path.sep}`)
      && !path.isAbsolute(relative));
}

function symbolicLinkFailureReason(
  error: unknown,
): 'dangling' | 'cycle' | 'unclassified' {
  if (isRecord(error) && error.code === 'ELOOP') return 'cycle';
  if (isRecord(error) && error.code === 'ENOENT') return 'dangling';
  return 'unclassified';
}

function hasPhysicalTargetConflict<T extends CanonicalSkillLayoutFile>(
  linkedFiles: Array<{ file: T; linkPath: string }>,
  resolvedByLink: Map<string, string>,
  desiredByPath: Map<string, Buffer>,
): boolean {
  for (const [linkPath, resolvedPath] of resolvedByLink) {
    try {
      if (!fs.statSync(resolvedPath).isDirectory()
        && linkedFiles.some(({ file, linkPath: fileLinkPath }) =>
          fileLinkPath === linkPath && path.relative(linkPath, file.targetPath) !== '')) {
        return true;
      }
    } catch {
      return true;
    }
  }
  return linkedFiles.some(({ file, linkPath }) => {
    const resolvedPath = resolvedByLink.get(linkPath);
    if (!resolvedPath) return true;
    const physicalPath = path.resolve(resolvedPath, path.relative(linkPath, file.targetPath));
    const directDesired = desiredByPath.get(physicalPath);
    return directDesired !== undefined && !directDesired.equals(toBuffer(file.content));
  });
}

function linkedFilesMatchPhysicalDesired<T extends CanonicalSkillLayoutFile>(
  linkedFiles: Array<{ file: T; linkPath: string }>,
  resolvedByLink: Map<string, string>,
  desiredByPath: Map<string, Buffer>,
): boolean {
  return linkedFiles.every(({ file, linkPath }) => {
    const resolvedPath = resolvedByLink.get(linkPath);
    if (!resolvedPath) return false;
    const physicalPath = path.resolve(resolvedPath, path.relative(linkPath, file.targetPath));
    return desiredByPath.get(physicalPath)?.equals(toBuffer(file.content)) === true;
  });
}

function linkedSkillIssue(
  outcome: Omit<CanonicalSkillLinkOutcome, 'status' | 'reason'>,
  target: CanonicalSkillTarget,
  reason: NonNullable<CanonicalSkillLinkOutcome['reason']>,
): CanonicalSkillLayoutIssue {
  return {
    severity: 'error',
    code: `deploy.skillsLinked.blocked.${canonicalSkillTargetKey(target)}`,
    message: `Linked external Skills are blocked: ${linkedSkillReason(reason)} (${outcome.affectedFileCount} affected file(s)).`,
    details: [
      `Packages: ${packageSummary(outcome.packageNames)}.`,
      `Links: ${outcome.linkPaths.join(', ')}.`,
      ...(outcome.resolvedPaths
        ? [`Resolved targets: ${outcome.resolvedPaths.join(', ')}.`]
        : []),
      'MCV will not write through, replace, or manage cleanup beneath this link.',
    ].join(' '),
  };
}

function linkedSkillReason(
  reason: NonNullable<CanonicalSkillLinkOutcome['reason']>,
): string {
  switch (reason) {
    case 'divergent': return 'linked content differs from the desired Canonical packages';
    case 'dangling': return 'the link target is missing';
    case 'cycle': return 'the link contains a cycle';
    case 'physical-target-conflict': return 'the link conflicts with a physical Deploy target';
    case 'unclassified': return 'the link target could not be classified safely';
  }
}

function packageSummary(packageNames: string[]): string {
  return packageNames.length === 1
    ? `Skill package ${packageNames[0]}`
    : `${packageNames.length} Skill packages`;
}

function relevantAncestorTopology(targetPath: string): string {
  const resolved = path.resolve(targetPath);
  const root = path.parse(resolved).root;
  const segments = resolved.slice(root.length).split(path.sep);
  const layoutIndex = segments.findIndex((segment) =>
    ['.agents', '.claude', '.codex', '.gemini'].includes(segment));
  if (layoutIndex < 0) {
    const linkAncestor = findSymbolicLinkAncestor(resolved);
    return linkAncestor
      ? `link-ancestor\0${linkAncestor}\0${fs.readlinkSync(linkAncestor)}`
      : 'no-layout-ancestor';
  }
  const values: string[] = [];
  for (let index = layoutIndex; index < segments.length - 1; index += 1) {
    const ancestor = path.join(root, ...segments.slice(0, index + 1));
    if (!deployPathExists(ancestor)) {
      values.push(`${ancestor}\0missing`);
      continue;
    }
    const stat = fs.lstatSync(ancestor);
    if (stat.isSymbolicLink()) {
      let physical = '<unresolved>';
      try {
        physical = fs.realpathSync(ancestor);
      } catch { /* Keep unresolved topology explicit. */ }
      values.push(`${ancestor}\0symlink\0${fs.readlinkSync(ancestor)}\0${physical}`);
    } else {
      values.push(`${ancestor}\0${stat.isDirectory() ? 'directory' : 'other'}\0${stat.dev}\0${stat.ino}`);
    }
  }
  return values.join('\0');
}
