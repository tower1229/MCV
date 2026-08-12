import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import type { DeviceContext, IdeId, SkillSurfaceId } from '../adapters/types.js';
import { findSymbolicLinkAncestor, hashFile } from '../utils/files.js';
import { isRecord } from '../utils/objects.js';

export type CanonicalSkillIde = IdeId;
export type CanonicalSkillTarget =
  | { owner: 'canonical-store'; ide?: never; surface?: never }
  | { owner: 'ide'; ide: CanonicalSkillIde; surface?: SkillSurfaceId };

export type CanonicalSkillLayoutFile = {
  capability: 'instructions' | 'skills' | 'mcp' | 'native';
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
  surface: SkillSurfaceId;
  packageName: string;
  targetPath: string;
  physicalTargetPath: string;
  materializationPaths: string[];
}

export interface CanonicalSkillTopologyMigration extends CanonicalSkillProjection {
  kind: 'topology-migration';
}

export interface CanonicalSkillDivergentPhysicalCopy {
  owner: 'ide';
  ide: CanonicalSkillIde;
  surface: SkillSurfaceId;
  packageName: string;
  targetPath: string;
}

export interface CanonicalSkillUnownedStorePackage {
  packageName: string;
  storePath: string;
}

export interface CanonicalSkillExternalStorePackage {
  packageName: string;
  storePath: string;
}

export interface CanonicalSkillProjectionSurface {
  ide: CanonicalSkillIde;
  surface: SkillSurfaceId;
  root: string;
  supportsManagedLinks: boolean;
}

export interface CanonicalSkillDeviceLayout<T extends CanonicalSkillLayoutFile> {
  filesOutsideLayout: T[];
  materializations: CanonicalSkillMaterialization<T>[];
  filesForLinkClassification: CanonicalSkillLayoutFile[];
  missingProjections: CanonicalSkillProjection[];
  topologyMigrations: CanonicalSkillTopologyMigration[];
  divergentPhysicalCopies: CanonicalSkillDivergentPhysicalCopy[];
  unownedStorePackages: CanonicalSkillUnownedStorePackage[];
  externalStorePackages: CanonicalSkillExternalStorePackage[];
  conflicts: string[];
}

type CanonicalSkillLinkOutcomeBase = {
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
};

type CanonicalSkillLinkTarget =
  | { owner: 'canonical-store'; ide?: never; surface?: never }
  | { owner: 'ide'; ide: IdeId; surface: SkillSurfaceId };

type CanonicalSkillLinkOutcomeDetails = Omit<CanonicalSkillLinkOutcomeBase, 'status' | 'reason'>
  & CanonicalSkillLinkTarget;

export type CanonicalSkillLinkOutcome = CanonicalSkillLinkOutcomeBase
  & CanonicalSkillLinkTarget
  & { factId?: string };

export interface CanonicalSkillLinkFact {
  id: string;
  status: CanonicalSkillLinkOutcome['status'];
  severity: CanonicalSkillLayoutIssue['severity'];
  ownership: CanonicalSkillLinkOutcome['ownership'];
  scope: CanonicalSkillLinkOutcome['scope'];
  reason?: CanonicalSkillLinkOutcome['reason'];
  packageNames: string[];
  linkPaths: string[];
  resolvedPaths?: string[];
  surfaces: Array<{ ide: IdeId; surface: SkillSurfaceId }>;
  affectedFileCount: number;
}

interface CanonicalSkillLayoutIssueDetails {
  code: string;
  decisionId?: string;
  message: string;
  details?: string;
}

export type CanonicalSkillLayoutIssue = CanonicalSkillLayoutIssueDetails & (
  | { severity: 'warning'; confirmationId: string }
  | { severity: 'notice' | 'decisionRequired' | 'error'; confirmationId?: never }
);

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
  managedStorePaths = new Set<string>(),
}: {
  files: T[];
  context: DeviceContext;
  useManagedLinks: boolean;
  projectionSurfaces?: CanonicalSkillProjectionSurface[];
  managedStorePaths?: ReadonlySet<string>;
}): CanonicalSkillDeviceLayout<T> {
  if (!useManagedLinks) {
    return {
      filesOutsideLayout: files,
      materializations: [],
      filesForLinkClassification: files,
      missingProjections: [],
      topologyMigrations: [],
      divergentPhysicalCopies: [],
      unownedStorePackages: [],
      externalStorePackages: [],
      conflicts: [],
    };
  }

  const storeRoot = canonicalDeviceSkillStoreRoot(context);
  const linkCapableSurfaces = projectionSurfaces.filter((surface) => surface.supportsManagedLinks);
  const linkCapableSurfaceIds = new Set(linkCapableSurfaces.map((surface) => surface.surface));
  const copyOnlySkillFile = (file: T): boolean =>
    file.capability === 'skills'
    && file.owner === 'ide'
    && (file.surface === undefined || !linkCapableSurfaceIds.has(file.surface))
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

  const candidateMaterializations = [...materializationsByPath.values()];
  const unownedStorePackages: CanonicalSkillUnownedStorePackage[] = [];
  const externalMatchingPackages = new Set<string>();
  const externalStorePackages: CanonicalSkillExternalStorePackage[] = [];
  const candidatePackageNames = [...new Set(candidateMaterializations
    .map(({ targetPath }) => canonicalSkillPackageName(targetPath)))].sort();
  for (const packageName of candidatePackageNames) {
    const storePath = path.join(storeRoot, packageName);
    if (!deployPathExists(storePath) || managedStorePaths.has(path.resolve(storePath))) continue;
    const packageMaterializations = candidateMaterializations.filter((entry) =>
      canonicalSkillPackageName(entry.targetPath) === packageName);
    if (physicalSkillPackageMatchesCanonical(
      storePath,
      packageMaterializations,
      storeRoot,
      packageName,
    ) === 'match') {
      externalMatchingPackages.add(packageName);
      externalStorePackages.push({ packageName, storePath });
      continue;
    }
    unownedStorePackages.push({ packageName, storePath });
  }
  const blockedPackageNames = new Set(unownedStorePackages.map((entry) => entry.packageName));
  const materializations = candidateMaterializations.filter(({ targetPath }) => {
    const packageName = canonicalSkillPackageName(targetPath);
    return !blockedPackageNames.has(packageName) && !externalMatchingPackages.has(packageName);
  });
  const packageNames = candidatePackageNames.filter((packageName) =>
    !blockedPackageNames.has(packageName));
  const missingProjections: CanonicalSkillProjection[] = [];
  const topologyMigrations: CanonicalSkillTopologyMigration[] = [];
  const divergentPhysicalCopies: CanonicalSkillDivergentPhysicalCopy[] = [];
  for (const surface of linkCapableSurfaces) {
    if (path.resolve(surface.root) === path.resolve(storeRoot)) continue;
    for (const packageName of packageNames) {
      const targetPath = path.join(surface.root, packageName);
      const physicalTargetPath = path.join(storeRoot, packageName);
      const materializationPaths = materializations
        .map(({ targetPath: materializationPath }) => materializationPath)
        .filter((materializationPath) =>
          canonicalSkillPackageName(materializationPath) === packageName);
      const projection = {
        owner: 'ide' as const,
        ide: surface.ide,
        surface: surface.surface,
        packageName,
        targetPath,
        physicalTargetPath,
        materializationPaths,
      };
      if (findSymbolicLinkAncestor(targetPath)) continue;
      const existingKind = physicalSkillPackageKind(targetPath);
      if (existingKind === 'missing') {
        missingProjections.push(projection);
        continue;
      }
      if (existingKind === 'symlink') continue;
      const packageMatch = physicalSkillPackageMatchesCanonical(
        targetPath,
        materializations.filter((entry) =>
          canonicalSkillPackageName(entry.targetPath) === packageName),
        storeRoot,
        packageName,
      );
      if (packageMatch === 'match') {
        topologyMigrations.push({ ...projection, kind: 'topology-migration' });
        continue;
      }
      divergentPhysicalCopies.push({
        owner: 'ide',
        ide: surface.ide,
        surface: surface.surface,
        packageName,
        targetPath,
      });
    }
  }
  const physicalFiles = materializations.map(({ source, targetPath }) =>
    canonicalStoreFile(source, targetPath));
  const linkClassificationIdeFiles = files.filter((file) =>
    file.capability === 'skills'
    && file.owner === 'ide'
    && file.surface !== undefined
    && linkCapableSurfaceIds.has(file.surface));
  return {
    filesOutsideLayout,
    materializations,
    filesForLinkClassification: [
      ...filesOutsideLayout,
      ...physicalFiles,
      ...linkClassificationIdeFiles,
    ],
    missingProjections,
    topologyMigrations,
    divergentPhysicalCopies,
    unownedStorePackages,
    externalStorePackages,
    conflicts,
  };
}

function physicalSkillPackageKind(
  targetPath: string,
): 'missing' | 'symlink' | 'physical' {
  if (!deployPathExists(targetPath)) return 'missing';
  return fs.lstatSync(targetPath).isSymbolicLink() ? 'symlink' : 'physical';
}

function physicalSkillPackageMatchesCanonical<T extends CanonicalSkillLayoutFile>(
  packagePath: string,
  packageMaterializations: CanonicalSkillMaterialization<T>[],
  storeRoot: string,
  packageName: string,
): 'match' | 'divergent' {
  let stats: fs.Stats;
  try {
    stats = fs.statSync(packagePath);
  } catch {
    return 'divergent';
  }
  if (!stats.isDirectory()) return 'divergent';

  const desiredByRelative = new Map<string, Buffer>();
  for (const { source, targetPath } of packageMaterializations) {
    const relative = path.relative(path.join(storeRoot, packageName), targetPath);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) continue;
    desiredByRelative.set(relative, toBuffer(source.content));
  }
  if (desiredByRelative.size === 0) return 'divergent';

  const onDisk = new Map<string, Buffer>();
  const onDiskDirectories = new Set<string>();
  try {
    for (const entry of listPhysicalPackageEntries(packagePath)) {
      if (entry.kind === 'symlink') return 'divergent';
      if (entry.kind === 'directory') {
        if (entry.relative !== '') onDiskDirectories.add(entry.relative);
        continue;
      }
      onDisk.set(entry.relative, fs.readFileSync(entry.path));
    }
  } catch {
    return 'divergent';
  }
  const desiredDirectories = new Set<string>();
  for (const relative of desiredByRelative.keys()) {
    let current = path.dirname(relative);
    while (current !== '.' && current !== '') {
      desiredDirectories.add(current);
      current = path.dirname(current);
    }
  }
  if (onDisk.size !== desiredByRelative.size) return 'divergent';
  if (onDiskDirectories.size !== desiredDirectories.size) return 'divergent';
  for (const relative of desiredDirectories) {
    if (!onDiskDirectories.has(relative)) return 'divergent';
  }
  for (const [relative, content] of desiredByRelative) {
    const diskContent = onDisk.get(relative);
    if (!diskContent || !diskContent.equals(content)) return 'divergent';
  }
  return 'match';
}

function listPhysicalPackageEntries(
  directory: string,
  relative = '',
): Array<{ kind: 'file' | 'directory' | 'symlink'; path: string; relative: string }> {
  const entries = fs.readdirSync(directory, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const target = path.join(directory, entry.name);
    const entryRelative = relative ? path.join(relative, entry.name) : entry.name;
    if (entry.isSymbolicLink()) {
      return [{ kind: 'symlink' as const, path: target, relative: entryRelative }];
    }
    if (entry.isDirectory()) {
      return [
        { kind: 'directory' as const, path: target, relative: entryRelative },
        ...listPhysicalPackageEntries(target, entryRelative),
      ];
    }
    return entry.isFile()
      ? [{ kind: 'file' as const, path: target, relative: entryRelative }]
      : [];
  });
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
  facts: CanonicalSkillLinkFact[];
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
    const withinSkillRoot = skillRoot !== undefined && isPathWithinRoot(skillRoot, linkPath);
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
  const desiredByPath = new Map(desired
    .filter((file) => !findSymbolicLinkAncestor(file.targetPath))
    .map((file) => [path.resolve(file.targetPath), toBuffer(file.content)]));
  for (const { scope, files } of linkedGroups.values()) {
    const first = files[0].file;
    const linkPaths = [...new Set(files.map((entry) => entry.linkPath))].sort();
    const packageNames = [...new Set(files.map(({ file }) =>
      canonicalSkillPackageName(file.targetPath)))].sort();
    const managed = linkPaths.every(isManagedLink);
    const baseOutcome: CanonicalSkillLinkOutcomeDetails = {
      ownership: managed ? 'managed' as const : 'external' as const,
      scope,
      ...canonicalSkillLinkTarget(first),
      linkPath: linkPaths[0],
      linkPaths,
      packageNames,
      affectedFileCount: files.length,
    };
    if (files.some(({ file, linkPath }) =>
      !isLinkWithinSkillRoot(file.targetPath, linkPath))) {
      outcomes.push({ ...baseOutcome, status: 'blocked', reason: 'unclassified' });
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
      continue;
    }
    const reason = physicalTargetConflict
      ? 'physical-target-conflict' as const
      : 'divergent' as const;
    outcomes.push({ ...baseOutcome, ...resolution, status: 'blocked', reason });
  }
  const facts = buildCanonicalSkillLinkFacts(outcomes);
  return { outcomes, facts, issues: facts.map(linkedSkillFactIssue) };
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
  const { ide: _ide, surface: _surface, ...withoutTarget } = source;
  return {
    ...withoutTarget,
    owner: 'canonical-store',
    targetPath,
  };
}

function canonicalSkillTarget(
  value: CanonicalSkillTarget,
): CanonicalSkillTarget {
  return value.owner === 'canonical-store'
    ? { owner: 'canonical-store' }
    : { owner: 'ide', ide: value.ide, ...(value.surface ? { surface: value.surface } : {}) };
}

function canonicalSkillLinkTarget(
  value: CanonicalSkillTarget,
): CanonicalSkillLinkTarget {
  if (value.owner === 'canonical-store') return { owner: 'canonical-store' };
  if (!value.surface) throw new Error(`Skill link outcome for ${value.ide} is missing its Surface.`);
  return { owner: 'ide', ide: value.ide, surface: value.surface };
}

export function canonicalSkillTargetKey(value: CanonicalSkillTarget): string {
  return value.owner === 'canonical-store'
    ? 'canonical-store'
    : value.surface
      ? `${value.ide}:${value.surface}`
      : value.ide;
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
  return skillRoot !== undefined && isPathWithinRoot(skillRoot, linkPath);
}

export function isPathWithinRoot(root: string, candidate: string): boolean {
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

function buildCanonicalSkillLinkFacts(
  outcomes: CanonicalSkillLinkOutcome[],
): CanonicalSkillLinkFact[] {
  const groups = new Map<string, CanonicalSkillLinkOutcome[]>();
  for (const outcome of outcomes) {
    const key = [
      outcome.ownership,
      outcome.owner,
      outcome.status,
      outcome.reason,
      outcome.scope,
      [...outcome.packageNames].sort().join(','),
      [...(outcome.resolvedPaths ?? outcome.linkPaths)].sort().join(','),
    ].join(':');
    groups.set(key, [...(groups.get(key) ?? []), outcome]);
  }
  return [...groups.entries()].map(([key, matching]) => {
    const linkPaths = [...new Set(matching.flatMap((entry) => entry.linkPaths))].sort();
    const resolvedPaths = [...new Set(matching.flatMap((entry) => entry.resolvedPaths ?? []))]
      .sort();
    const first = matching[0];
    const id = `skill-link-fact-${crypto.createHash('sha256').update(key).digest('hex').slice(0, 16)}`;
    for (const outcome of matching) outcome.factId = id;
    return {
      id,
      status: first.status,
      severity: linkFactSeverity(first),
      ownership: first.ownership,
      scope: first.scope,
      ...(first.reason ? { reason: first.reason } : {}),
      packageNames: [...new Set(matching.flatMap((entry) => entry.packageNames))].sort(),
      linkPaths,
      ...(resolvedPaths.length > 0
        ? { resolvedPaths }
        : {}),
      surfaces: [...new Map(matching.flatMap((entry) => entry.owner === 'ide'
        ? [[`${entry.ide}:${entry.surface}`, { ide: entry.ide, surface: entry.surface }] as const]
        : [])).values()],
      affectedFileCount: first.status === 'blocked'
        ? Math.max(...matching.map((entry) => entry.affectedFileCount))
        : matching.reduce((total, entry) => total + entry.affectedFileCount, 0),
    };
  });
}

function linkFactSeverity(
  fact: CanonicalSkillLinkOutcome,
): CanonicalSkillLayoutIssue['severity'] {
  if (fact.status === 'satisfied-via-link') return 'notice';
  if (fact.reason === 'divergent'
    && fact.owner === 'ide'
    && fact.ownership === 'external') {
    return fact.scope === 'skill-package' ? 'decisionRequired' : 'warning';
  }
  return 'error';
}

function linkedSkillFactIssue(fact: CanonicalSkillLinkFact): CanonicalSkillLayoutIssue {
  if (fact.status === 'satisfied-via-link') {
    return {
      severity: 'notice',
      code: 'deploy.skillsLinked.satisfied',
      message: `Satisfied via link: ${packageSummary(fact.packageNames)} (${fact.affectedFileCount} affected file(s)).`,
      details: `${fact.linkPaths.length} ${fact.ownership} link(s) resolve to ${(fact.resolvedPaths ?? []).join(', ')}.`,
    };
  }
  const context = [
    `Packages: ${packageSummary(fact.packageNames)}.`,
    `Links: ${fact.linkPaths.join(', ')}.`,
    ...(fact.resolvedPaths ? [`Resolved targets: ${fact.resolvedPaths.join(', ')}.`] : []),
  ];
  if (fact.severity === 'warning') {
    return {
      severity: 'warning',
      code: `deploy.skillsLinked.${fact.reason ?? 'blocked'}`,
      confirmationId: fact.id,
      message: `External shared Skill root differs from the Repository and will be preserved (${fact.affectedFileCount} affected file(s)).`,
      details: [...context,
        'Preserve this shared root to continue; split it into per-package links outside MCV before replacing individual packages.',
      ].join(' '),
    };
  }
  if (fact.severity === 'decisionRequired') {
    return {
      severity: 'decisionRequired',
      code: `deploy.skillsLinked.${fact.reason ?? 'blocked'}`,
      decisionId: fact.id,
      message: `External Skill package differs from the Repository and needs a Preserve or Replace decision (${fact.affectedFileCount} affected file(s)).`,
      details: [...context,
        'Preserve leaves the external link and target unchanged; Replace removes only the link node before creating the Repository projection.',
      ].join(' '),
    };
  }
  return {
    severity: 'error',
    code: `deploy.skillsLinked.${fact.reason ?? 'blocked'}`,
    message: `Linked Skills are blocked: ${linkedSkillReason(fact.reason ?? 'unclassified')} (${fact.affectedFileCount} affected file(s)).`,
    details: [...context,
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
