import { displaySkillSurface } from '../core/skill-surfaces.js';
import { diffLines, fact, status } from '../presentation/builders.js';
export function renderDeployChangeDetailBlocks(changes) {
    const blocks = [];
    for (const [group, groupedChanges] of groupDeployChanges(changes)) {
        blocks.push({ kind: 'section', title: group, blocks: groupedChanges.map(changeBlock) });
    }
    return blocks;
}
export function groupDeployChanges(changes) {
    const groups = new Map();
    for (const change of changes) {
        const label = `${displayDeployTarget(change)} / ${displayCapability(change.capability)}`;
        groups.set(label, [...(groups.get(label) ?? []), change]);
    }
    return groups;
}
export function changeBlock(change) {
    const destructive = change.change === 'delete' || change.deploymentKind === 'topology-migration';
    const role = destructive ? 'danger' : 'attention';
    const strategy = change.strategy === 'replace-entire-file' ? 'replace entire file' : 'managed merge';
    const blocks = [
        status(role, `${change.change}: ${change.name}`),
        fact('ID', change.id, 'muted', 'id'),
        fact('Deployment', deploymentLabel(change.deploymentKind), destructive ? 'danger' : 'information'),
        fact('Strategy', strategy, 'muted'),
        { kind: 'list', items: [{ text: 'Selected for Deploy', selected: change.defaultSelected }] },
    ];
    const preview = change.preview;
    if (preview.kind === 'link') {
        blocks.push(fact('Link', `${preview.targetPath} -> ${preview.linkTarget}`, 'muted', 'path'));
    }
    else if (preview.kind === 'package') {
        blocks.push({ kind: 'section', title: preview.targetPath, titleKind: 'path', blocks: [status('attention', 'Replace linked package node')] });
        for (const file of preview.files) {
            blocks.push(file.kind === 'binary'
                ? fact('Binary', `${file.targetPath} · ${file.bytes} bytes · sha256 ${file.sha256}`, 'muted', 'path')
                : { kind: 'section', title: file.targetPath, titleKind: 'path', blocks: [{ kind: 'diff', lines: diffLines(file.diff) }] });
        }
    }
    else if (preview.kind === 'binary') {
        blocks.push(fact('Binary', `${change.targetPath} · ${preview.bytes} bytes · sha256 ${preview.sha256}`, 'muted', 'path'));
    }
    else {
        blocks.push({ kind: 'section', title: change.targetPath, titleKind: 'path', blocks: [{ kind: 'diff', lines: diffLines(preview.diff) }] });
    }
    return { kind: 'section', title: change.name, blocks };
}
function deploymentLabel(kind) {
    switch (kind) {
        case 'physical-materialization': return 'Physical materialization';
        case 'managed-link-projection': return 'Managed-link projection';
        case 'topology-migration': return 'Topology migration';
        case 'copy-projection': return 'Copy projection';
        case 'project-skill-package': return 'Project Skill package';
        case 'external-link-replacement': return 'External link replacement';
        default: return 'Ordinary file';
    }
}
function displayIde(ide) {
    if (ide === 'claude-code')
        return 'Claude Code';
    return ide.charAt(0).toUpperCase() + ide.slice(1);
}
function displayDeployTarget(target) {
    return target.owner === 'canonical-store' ? displaySkillSurface('canonical-store')
        : target.surface ? displaySkillSurface(target.surface) : displayIde(target.ide);
}
function displayCapability(capability) {
    if (capability === 'instructions')
        return 'IDE Instructions';
    if (capability === 'skills')
        return 'Skills';
    if (capability === 'mcp')
        return 'MCP';
    return 'IDE-native Configuration';
}
