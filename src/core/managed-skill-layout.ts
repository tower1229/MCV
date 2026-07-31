import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import type { CanonicalSkillIde } from './canonical-skill-device-layout.js';
import {
  canonicalSkillPackageName,
  deployPathExists,
  hashDeviceTopologyNode,
} from './canonical-skill-device-layout.js';

export interface ManagedSkillPackageRecord {
  packageName: string;
  storePath: string;
  contentHash: string;
  source: string;
}

export interface ManagedSkillProjectionRecord {
  packageName: string;
  projectionPath: string;
  ide: CanonicalSkillIde;
  surface: string;
  expectedLinkTarget: string;
  topologyHash: string;
  source: string;
}

export interface ManagedSkillLayout {
  packages: Record<string, ManagedSkillPackageRecord>;
  projections: Record<string, ManagedSkillProjectionRecord>;
}

export type TopologyDriftReason = 'replaced' | 'retargeted' | 'missing' | 'external';

export interface ContentDriftEntry {
  kind: 'canonical-skill-package';
  packageName: string;
  storePath: string;
  state: 'drift';
}

export interface TopologyDriftEntry {
  kind: 'skill-projection';
  packageName: string;
  projectionPath: string;
  ide: CanonicalSkillIde;
  surface: string;
  reason: TopologyDriftReason;
}

export function hashSkillPackageContent(packageDirectory: string): string {
  const hash = crypto.createHash('sha256');
  const files: Array<{ relativePath: string; content: Buffer }> = [];
  walkSkillPackageFiles(packageDirectory, packageDirectory, files);
  for (const file of files.sort((left, right) => left.relativePath.localeCompare(right.relativePath))) {
    hash.update(file.relativePath.replace(/\\/g, '/'));
    hash.update(file.content);
  }
  return hash.digest('hex');
}

export function resolveSkillPackageStorePath(filePath: string): string {
  const resolved = path.resolve(filePath);
  const segments = resolved.split(path.sep);
  const skillsIndex = segments.lastIndexOf('skills');
  if (skillsIndex < 0 || !segments[skillsIndex + 1]) return path.dirname(resolved);
  return segments.slice(0, skillsIndex + 2).join(path.sep) || path.sep;
}

export function classifyManagedProjectionTopology(
  projection: ManagedSkillProjectionRecord,
): 'in-sync' | TopologyDriftReason {
  if (!deployPathExists(projection.projectionPath)) return 'missing';
  const stat = fs.lstatSync(projection.projectionPath);
  if (!stat.isSymbolicLink()) return 'replaced';
  let resolved: string;
  try {
    resolved = fs.realpathSync(projection.projectionPath);
  } catch {
    return 'missing';
  }
  let expected: string;
  try {
    expected = fs.realpathSync(projection.expectedLinkTarget);
  } catch {
    expected = path.resolve(projection.expectedLinkTarget);
  }
  if (path.resolve(resolved) === path.resolve(expected)) {
    if (hashDeviceTopologyNode(projection.projectionPath) === projection.topologyHash) {
      return 'in-sync';
    }
    return 'retargeted';
  }
  const expectedStoreRoot = path.resolve(path.dirname(projection.expectedLinkTarget));
  const resolvedParent = path.resolve(path.dirname(resolved));
  if (resolvedParent !== expectedStoreRoot) return 'external';
  return 'retargeted';
}

export function inspectManagedSkillDrift(layout: ManagedSkillLayout | undefined): {
  contentDrifts: ContentDriftEntry[];
  topologyDrifts: TopologyDriftEntry[];
  coveredPaths: Set<string>;
} {
  const contentDrifts: ContentDriftEntry[] = [];
  const topologyDrifts: TopologyDriftEntry[] = [];
  const coveredPaths = new Set<string>();
  if (!layout) return { contentDrifts, topologyDrifts, coveredPaths };

  for (const pkg of Object.values(layout.packages)) {
    coverPathTree(pkg.storePath, coveredPaths);
    if (!deployPathExists(pkg.storePath)) continue;
    if (hashSkillPackageContent(pkg.storePath) === pkg.contentHash) continue;
    contentDrifts.push({
      kind: 'canonical-skill-package',
      packageName: pkg.packageName,
      storePath: pkg.storePath,
      state: 'drift',
    });
  }

  for (const projection of Object.values(layout.projections)) {
    coveredPaths.add(path.resolve(projection.projectionPath));
    const reason = classifyManagedProjectionTopology(projection);
    if (reason === 'in-sync') continue;
    topologyDrifts.push({
      kind: 'skill-projection',
      packageName: projection.packageName,
      projectionPath: projection.projectionPath,
      ide: projection.ide,
      surface: projection.surface,
      reason,
    });
  }

  return { contentDrifts, topologyDrifts, coveredPaths };
}

export function isPathCoveredByManagedSkillLayout(
  targetPath: string,
  coveredPaths: Set<string>,
): boolean {
  const resolved = path.resolve(targetPath);
  if (coveredPaths.has(resolved)) return true;
  for (const covered of coveredPaths) {
    const relative = path.relative(covered, resolved);
    if (relative === ''
      || (relative !== '..'
        && !relative.startsWith(`..${path.sep}`)
        && !path.isAbsolute(relative))) {
      return true;
    }
  }
  return false;
}

function coverPathTree(root: string, coveredPaths: Set<string>): void {
  const resolved = path.resolve(root);
  coveredPaths.add(resolved);
  if (!deployPathExists(resolved)) return;
  const stat = fs.lstatSync(resolved);
  if (stat.isSymbolicLink() || !stat.isDirectory()) return;
  for (const entry of fs.readdirSync(resolved, { withFileTypes: true })) {
    coverPathTree(path.join(resolved, entry.name), coveredPaths);
  }
}

function walkSkillPackageFiles(
  root: string,
  directory: string,
  files: Array<{ relativePath: string; content: Buffer }>,
): void {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const current = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      walkSkillPackageFiles(root, current, files);
      continue;
    }
    if (!entry.isFile()) continue;
    files.push({
      relativePath: path.relative(root, current),
      content: fs.readFileSync(current),
    });
  }
}
