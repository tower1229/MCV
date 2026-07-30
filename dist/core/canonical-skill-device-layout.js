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
export function planCanonicalSkillDeviceLayout({ files, context, useManagedLinks, claudeSkillRoot, }) {
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
    const filesOutsideLayout = files.filter((file) => file.capability !== 'skills' || (file.owner === 'ide' && file.ide === 'gemini'));
    const materializationsByPath = new Map();
    const conflicts = [];
    for (const file of files.filter((candidate) => candidate.capability === 'skills'
        && !(candidate.owner === 'ide' && candidate.ide === 'gemini'))) {
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
    const materializations = [...materializationsByPath.values()];
    const packageNames = [...new Set(materializations
            .map(({ targetPath }) => canonicalSkillPackageName(targetPath)))].sort();
    const activeClaudeSkillRoot = claudeSkillRoot;
    const missingProjections = activeClaudeSkillRoot
        ? packageNames.flatMap((packageName) => {
            const targetPath = path.join(activeClaudeSkillRoot, packageName);
            if (fs.existsSync(targetPath) || findSymbolicLinkAncestor(targetPath))
                return [];
            return [{
                    owner: 'ide',
                    ide: 'claude-code',
                    packageName,
                    targetPath,
                    physicalTargetPath: path.join(storeRoot, packageName),
                    materializationPaths: materializations
                        .map(({ targetPath: materializationPath }) => materializationPath)
                        .filter((materializationPath) => canonicalSkillPackageName(materializationPath) === packageName),
                }];
        })
        : [];
    const physicalFiles = materializations.map(({ source, targetPath }) => canonicalStoreFile(source, targetPath));
    return {
        filesOutsideLayout,
        materializations,
        filesForLinkClassification: [
            ...filesOutsideLayout,
            ...physicalFiles,
            ...files.filter((file) => file.capability === 'skills' && file.owner === 'ide' && file.ide === 'claude-code'),
        ],
        missingProjections,
        conflicts,
    };
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
        const withinSkillRoot = skillRoot !== undefined && isPathWithin(skillRoot, linkPath);
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
            ...canonicalSkillTarget(first),
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
    const { ide: _ide, ...withoutIde } = source;
    return {
        ...withoutIde,
        owner: 'canonical-store',
        targetPath,
    };
}
function canonicalSkillTarget(value) {
    return value.owner === 'canonical-store'
        ? { owner: 'canonical-store' }
        : { owner: 'ide', ide: value.ide };
}
function canonicalSkillTargetKey(value) {
    return value.owner === 'canonical-store' ? 'canonical-store' : value.ide;
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
    return skillRoot !== undefined && isPathWithin(skillRoot, linkPath);
}
function isPathWithin(root, candidate) {
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
