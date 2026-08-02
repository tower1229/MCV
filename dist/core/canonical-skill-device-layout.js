import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { findSymbolicLinkAncestor, hashFile } from '../utils/files.js';
import { isRecord } from '../utils/objects.js';
export function canonicalDeviceSkillStoreRoot(context) {
    return path.join(context.homeDir, '.agents', 'skills');
}
export function deployPathExists(targetPath) {
    try {
        fs.lstatSync(targetPath);
        return true;
    }
    catch {
        return false;
    }
}
export function hashDeviceTopologyNode(targetPath) {
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
        }
        catch {
            hash.update('physical\0<unresolved>');
        }
        return hash.digest('hex');
    }
    if (stat.isDirectory()) {
        hash.update(`directory\0${resolved}`);
        return hash.digest('hex');
    }
    const contentHash = hashFile(resolved);
    if (!resolved.includes(`${path.sep}skills${path.sep}`))
        return contentHash;
    hash.update(`content\0${contentHash}\0`);
    hash.update(relevantAncestorTopology(resolved));
    return hash.digest('hex');
}
export function planCanonicalSkillDeviceLayout({ files, context, useManagedLinks, projectionSurfaces = [], managedStorePaths = new Set(), }) {
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
    const copyOnlySkillFile = (file) => file.capability === 'skills'
        && file.owner === 'ide'
        && (file.surface === undefined || !linkCapableSurfaceIds.has(file.surface))
        && !isStoreSkillPath(file.targetPath, storeRoot);
    const filesOutsideLayout = files.filter((file) => file.capability !== 'skills' || copyOnlySkillFile(file));
    const materializationsByPath = new Map();
    const conflicts = [];
    for (const file of files.filter((candidate) => candidate.capability === 'skills' && !copyOnlySkillFile(candidate))) {
        const relative = relativeSkillPath(file.targetPath);
        if (!relative)
            continue;
        const targetPath = path.join(storeRoot, relative);
        const existing = materializationsByPath.get(path.resolve(targetPath));
        if (existing && !toBuffer(existing.source.content).equals(toBuffer(file.content))) {
            conflicts.push(relative);
            continue;
        }
        materializationsByPath.set(path.resolve(targetPath), { source: file, targetPath });
    }
    const candidateMaterializations = [...materializationsByPath.values()];
    const unownedStorePackages = [];
    const externalMatchingPackages = new Set();
    const externalStorePackages = [];
    const candidatePackageNames = [...new Set(candidateMaterializations
            .map(({ targetPath }) => canonicalSkillPackageName(targetPath)))].sort();
    for (const packageName of candidatePackageNames) {
        const storePath = path.join(storeRoot, packageName);
        if (!deployPathExists(storePath) || managedStorePaths.has(path.resolve(storePath)))
            continue;
        const packageMaterializations = candidateMaterializations.filter((entry) => canonicalSkillPackageName(entry.targetPath) === packageName);
        if (physicalSkillPackageMatchesCanonical(storePath, packageMaterializations, storeRoot, packageName) === 'match') {
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
    const packageNames = candidatePackageNames.filter((packageName) => !blockedPackageNames.has(packageName));
    const missingProjections = [];
    const topologyMigrations = [];
    const divergentPhysicalCopies = [];
    for (const surface of linkCapableSurfaces) {
        if (path.resolve(surface.root) === path.resolve(storeRoot))
            continue;
        for (const packageName of packageNames) {
            const targetPath = path.join(surface.root, packageName);
            const physicalTargetPath = path.join(storeRoot, packageName);
            const materializationPaths = materializations
                .map(({ targetPath: materializationPath }) => materializationPath)
                .filter((materializationPath) => canonicalSkillPackageName(materializationPath) === packageName);
            const projection = {
                owner: 'ide',
                ide: surface.ide,
                surface: surface.surface,
                packageName,
                targetPath,
                physicalTargetPath,
                materializationPaths,
            };
            if (findSymbolicLinkAncestor(targetPath))
                continue;
            const existingKind = physicalSkillPackageKind(targetPath);
            if (existingKind === 'missing') {
                missingProjections.push(projection);
                continue;
            }
            if (existingKind === 'symlink')
                continue;
            const packageMatch = physicalSkillPackageMatchesCanonical(targetPath, materializations.filter((entry) => canonicalSkillPackageName(entry.targetPath) === packageName), storeRoot, packageName);
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
    const physicalFiles = materializations.map(({ source, targetPath }) => canonicalStoreFile(source, targetPath));
    const linkClassificationIdeFiles = files.filter((file) => file.capability === 'skills'
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
function physicalSkillPackageKind(targetPath) {
    if (!deployPathExists(targetPath))
        return 'missing';
    return fs.lstatSync(targetPath).isSymbolicLink() ? 'symlink' : 'physical';
}
function physicalSkillPackageMatchesCanonical(packagePath, packageMaterializations, storeRoot, packageName) {
    let stats;
    try {
        stats = fs.statSync(packagePath);
    }
    catch {
        return 'divergent';
    }
    if (!stats.isDirectory())
        return 'divergent';
    const desiredByRelative = new Map();
    for (const { source, targetPath } of packageMaterializations) {
        const relative = path.relative(path.join(storeRoot, packageName), targetPath);
        if (!relative || relative.startsWith('..') || path.isAbsolute(relative))
            continue;
        desiredByRelative.set(relative, toBuffer(source.content));
    }
    if (desiredByRelative.size === 0)
        return 'divergent';
    const onDisk = new Map();
    const onDiskDirectories = new Set();
    try {
        for (const entry of listPhysicalPackageEntries(packagePath)) {
            if (entry.kind === 'symlink')
                return 'divergent';
            if (entry.kind === 'directory') {
                if (entry.relative !== '')
                    onDiskDirectories.add(entry.relative);
                continue;
            }
            onDisk.set(entry.relative, fs.readFileSync(entry.path));
        }
    }
    catch {
        return 'divergent';
    }
    const desiredDirectories = new Set();
    for (const relative of desiredByRelative.keys()) {
        let current = path.dirname(relative);
        while (current !== '.' && current !== '') {
            desiredDirectories.add(current);
            current = path.dirname(current);
        }
    }
    if (onDisk.size !== desiredByRelative.size)
        return 'divergent';
    if (onDiskDirectories.size !== desiredDirectories.size)
        return 'divergent';
    for (const relative of desiredDirectories) {
        if (!onDiskDirectories.has(relative))
            return 'divergent';
    }
    for (const [relative, content] of desiredByRelative) {
        const diskContent = onDisk.get(relative);
        if (!diskContent || !diskContent.equals(content))
            return 'divergent';
    }
    return 'match';
}
function listPhysicalPackageEntries(directory, relative = '') {
    const entries = fs.readdirSync(directory, { withFileTypes: true });
    return entries.flatMap((entry) => {
        const target = path.join(directory, entry.name);
        const entryRelative = relative ? path.join(relative, entry.name) : entry.name;
        if (entry.isSymbolicLink()) {
            return [{ kind: 'symlink', path: target, relative: entryRelative }];
        }
        if (entry.isDirectory()) {
            return [
                { kind: 'directory', path: target, relative: entryRelative },
                ...listPhysicalPackageEntries(target, entryRelative),
            ];
        }
        return entry.isFile()
            ? [{ kind: 'file', path: target, relative: entryRelative }]
            : [];
    });
}
function isStoreSkillPath(targetPath, storeRoot) {
    const relative = path.relative(path.resolve(storeRoot), path.resolve(targetPath));
    return relative === ''
        || (relative !== '..'
            && !relative.startsWith(`..${path.sep}`)
            && !path.isAbsolute(relative));
}
export function classifyCanonicalSkillLinks(desired, isManagedLink) {
    const linkedGroups = new Map();
    for (const file of desired) {
        if (file.capability !== 'skills')
            continue;
        const linkPath = findSymbolicLinkAncestor(file.targetPath);
        if (!linkPath)
            continue;
        const skillRoot = skillRootPath(file.targetPath);
        const withinSkillRoot = skillRoot !== undefined && isPathWithinRoot(skillRoot, linkPath);
        const sharedRoot = withinSkillRoot && path.resolve(linkPath) === path.resolve(skillRoot);
        const groupingPath = sharedRoot
            ? linkPath
            : withinSkillRoot
                ? skillPackageRoot(file.targetPath)
                : linkPath;
        const scope = sharedRoot ? 'shared-link-root' : 'skill-package';
        const key = `${canonicalSkillTargetKey(file)}\0${path.resolve(groupingPath)}`;
        const group = linkedGroups.get(key) ?? { scope, files: [] };
        group.files.push({ file, linkPath });
        linkedGroups.set(key, group);
    }
    const outcomes = [];
    const issues = [];
    const desiredByPath = new Map(desired
        .filter((file) => !findSymbolicLinkAncestor(file.targetPath))
        .map((file) => [path.resolve(file.targetPath), toBuffer(file.content)]));
    for (const { scope, files } of linkedGroups.values()) {
        const first = files[0].file;
        const linkPaths = [...new Set(files.map((entry) => entry.linkPath))].sort();
        const packageNames = [...new Set(files.map(({ file }) => canonicalSkillPackageName(file.targetPath)))].sort();
        const managed = linkPaths.every(isManagedLink);
        const baseOutcome = {
            ownership: managed ? 'managed' : 'external',
            scope,
            ...canonicalSkillLinkTarget(first),
            linkPath: linkPaths[0],
            linkPaths,
            packageNames,
            affectedFileCount: files.length,
        };
        if (files.some(({ file, linkPath }) => !isLinkWithinSkillRoot(file.targetPath, linkPath))) {
            outcomes.push({ ...baseOutcome, status: 'blocked', reason: 'unclassified' });
            issues.push(linkedSkillIssue(baseOutcome, canonicalSkillTarget(first), 'unclassified'));
            continue;
        }
        const resolvedByLink = new Map();
        let resolutionFailure;
        try {
            for (const linkPath of linkPaths) {
                resolvedByLink.set(linkPath, fs.realpathSync(linkPath));
            }
        }
        catch (error) {
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
            matches = files.every(({ file }) => fs.readFileSync(file.targetPath).equals(toBuffer(file.content)));
        }
        catch {
            matches = false;
        }
        const physicalTargetConflict = hasPhysicalTargetConflict(files, resolvedByLink, desiredByPath);
        const followsEquivalentPhysicalTarget = linkedFilesMatchPhysicalDesired(files, resolvedByLink, desiredByPath);
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
            ? 'physical-target-conflict'
            : 'divergent';
        outcomes.push({ ...baseOutcome, ...resolution, status: 'blocked', reason });
        issues.push(linkedSkillIssue({ ...baseOutcome, ...resolution }, canonicalSkillTarget(first), reason));
    }
    return { outcomes, issues };
}
function relativeSkillPath(targetPath) {
    const root = skillRootPath(targetPath);
    if (!root)
        return undefined;
    const relative = path.relative(root, path.resolve(targetPath));
    return relative && !relative.startsWith('..') ? relative : undefined;
}
export function canonicalSkillPackageName(targetPath) {
    const segments = path.resolve(targetPath).split(path.sep);
    const skillsIndex = segments.lastIndexOf('skills');
    return skillsIndex >= 0 && segments[skillsIndex + 1]
        ? segments[skillsIndex + 1]
        : path.basename(path.dirname(targetPath));
}
function toBuffer(value) {
    return Buffer.isBuffer(value) ? value : Buffer.from(value);
}
function canonicalStoreFile(source, targetPath) {
    const { ide: _ide, surface: _surface, ...withoutTarget } = source;
    return {
        ...withoutTarget,
        owner: 'canonical-store',
        targetPath,
    };
}
function canonicalSkillTarget(value) {
    return value.owner === 'canonical-store'
        ? { owner: 'canonical-store' }
        : { owner: 'ide', ide: value.ide, ...(value.surface ? { surface: value.surface } : {}) };
}
function canonicalSkillLinkTarget(value) {
    if (value.owner === 'canonical-store')
        return { owner: 'canonical-store' };
    if (!value.surface)
        throw new Error(`Skill link outcome for ${value.ide} is missing its Surface.`);
    return { owner: 'ide', ide: value.ide, surface: value.surface };
}
export function canonicalSkillTargetKey(value) {
    return value.owner === 'canonical-store'
        ? 'canonical-store'
        : value.surface
            ? `${value.ide}:${value.surface}`
            : value.ide;
}
function skillRootPath(targetPath) {
    const resolvedTarget = path.resolve(targetPath);
    const marker = `${path.sep}skills${path.sep}`;
    const markerIndex = resolvedTarget.lastIndexOf(marker);
    return markerIndex < 0
        ? undefined
        : resolvedTarget.slice(0, markerIndex + marker.length - 1);
}
function skillPackageRoot(targetPath) {
    const skillRoot = skillRootPath(targetPath);
    return skillRoot
        ? path.join(skillRoot, canonicalSkillPackageName(targetPath))
        : path.dirname(targetPath);
}
function isLinkWithinSkillRoot(targetPath, linkPath) {
    const skillRoot = skillRootPath(targetPath);
    return skillRoot !== undefined && isPathWithinRoot(skillRoot, linkPath);
}
export function isPathWithinRoot(root, candidate) {
    const relative = path.relative(path.resolve(root), path.resolve(candidate));
    return relative === ''
        || (relative !== '..'
            && !relative.startsWith(`..${path.sep}`)
            && !path.isAbsolute(relative));
}
function symbolicLinkFailureReason(error) {
    if (isRecord(error) && error.code === 'ELOOP')
        return 'cycle';
    if (isRecord(error) && error.code === 'ENOENT')
        return 'dangling';
    return 'unclassified';
}
function hasPhysicalTargetConflict(linkedFiles, resolvedByLink, desiredByPath) {
    for (const [linkPath, resolvedPath] of resolvedByLink) {
        try {
            if (!fs.statSync(resolvedPath).isDirectory()
                && linkedFiles.some(({ file, linkPath: fileLinkPath }) => fileLinkPath === linkPath && path.relative(linkPath, file.targetPath) !== '')) {
                return true;
            }
        }
        catch {
            return true;
        }
    }
    return linkedFiles.some(({ file, linkPath }) => {
        const resolvedPath = resolvedByLink.get(linkPath);
        if (!resolvedPath)
            return true;
        const physicalPath = path.resolve(resolvedPath, path.relative(linkPath, file.targetPath));
        const directDesired = desiredByPath.get(physicalPath);
        return directDesired !== undefined && !directDesired.equals(toBuffer(file.content));
    });
}
function linkedFilesMatchPhysicalDesired(linkedFiles, resolvedByLink, desiredByPath) {
    return linkedFiles.every(({ file, linkPath }) => {
        const resolvedPath = resolvedByLink.get(linkPath);
        if (!resolvedPath)
            return false;
        const physicalPath = path.resolve(resolvedPath, path.relative(linkPath, file.targetPath));
        return desiredByPath.get(physicalPath)?.equals(toBuffer(file.content)) === true;
    });
}
function linkedSkillIssue(outcome, target, reason) {
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
function linkedSkillReason(reason) {
    switch (reason) {
        case 'divergent': return 'linked content differs from the desired Canonical packages';
        case 'dangling': return 'the link target is missing';
        case 'cycle': return 'the link contains a cycle';
        case 'physical-target-conflict': return 'the link conflicts with a physical Deploy target';
        case 'unclassified': return 'the link target could not be classified safely';
    }
}
function packageSummary(packageNames) {
    return packageNames.length === 1
        ? `Skill package ${packageNames[0]}`
        : `${packageNames.length} Skill packages`;
}
function relevantAncestorTopology(targetPath) {
    const resolved = path.resolve(targetPath);
    const root = path.parse(resolved).root;
    const segments = resolved.slice(root.length).split(path.sep);
    const layoutIndex = segments.findIndex((segment) => ['.agents', '.claude', '.codex', '.gemini'].includes(segment));
    if (layoutIndex < 0) {
        const linkAncestor = findSymbolicLinkAncestor(resolved);
        return linkAncestor
            ? `link-ancestor\0${linkAncestor}\0${fs.readlinkSync(linkAncestor)}`
            : 'no-layout-ancestor';
    }
    const values = [];
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
            }
            catch { /* Keep unresolved topology explicit. */ }
            values.push(`${ancestor}\0symlink\0${fs.readlinkSync(ancestor)}\0${physical}`);
        }
        else {
            values.push(`${ancestor}\0${stat.isDirectory() ? 'directory' : 'other'}\0${stat.dev}\0${stat.ino}`);
        }
    }
    return values.join('\0');
}
