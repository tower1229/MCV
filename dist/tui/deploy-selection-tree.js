import { displaySkillSurface, isSkillSurfaceId } from '../core/skill-surfaces.js';
const targetOrder = [
    'canonical-store',
    'codex',
    'claude-code',
    'gemini',
    'gemini-cli',
    'antigravity',
];
const capabilityOrder = [
    'rules',
    'skills',
    'mcp',
    'native',
];
export function buildDeploySelectionTree(plan) {
    const standard = buildCapabilityNodes(plan.changes.filter((change) => change.group === 'standard'), 'standard');
    const advancedChanges = plan.changes.filter((change) => change.group === 'advanced');
    return advancedChanges.length === 0
        ? standard
        : [...standard, {
                id: 'advanced',
                kind: 'advanced',
                label: 'Advanced Cleanup',
                changeIds: advancedChanges.map((change) => change.id),
                children: buildCapabilityNodes(advancedChanges, 'advanced'),
            }];
}
export function flattenDeploySelectionTree(tree, expandedNodeIds) {
    const expanded = new Set(expandedNodeIds);
    const visible = [];
    const visit = (nodes, depth, parentId) => {
        for (const node of nodes) {
            visible.push({ node, depth, parentId });
            if (node.children.length > 0 && expanded.has(node.id)) {
                visit(node.children, depth + 1, node.id);
            }
        }
    };
    visit(tree, 0);
    return visible;
}
function buildCapabilityNodes(changes, group) {
    const groups = new Map();
    for (const change of changes) {
        const key = `${targetKey(change)}/${change.capability}`;
        const items = groups.get(key) ?? [];
        items.push(change);
        groups.set(key, items);
    }
    return [...groups.entries()]
        .sort(([left], [right]) => compareGroupKeys(left, right))
        .map(([key, items]) => {
        const [target, capability] = key.split('/');
        return {
            id: `capability:${group}:${key}`,
            kind: 'capability',
            label: `${displayTarget(target)} / ${displayCapability(capability)}`,
            changeIds: items.map((change) => change.id),
            children: capability === 'skills'
                ? buildSkillPackageNodes(items, group)
                : items.map((change) => buildFileNode(change, group)),
        };
    });
}
function buildSkillPackageNodes(changes, group) {
    const packages = new Map();
    for (const change of changes) {
        const items = packages.get(change.name) ?? [];
        items.push(change);
        packages.set(change.name, items);
    }
    return [...packages.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([name, items]) => ({
        id: `package:${group}:${targetKey(items[0])}:${name}`,
        kind: 'package',
        label: name,
        changeIds: items.map((change) => change.id),
        children: items
            .map((change) => buildFileNode(change, group))
            .sort((left, right) => left.label.localeCompare(right.label, undefined, { numeric: true })),
    }));
}
function buildFileNode(change, group) {
    return {
        id: `file:${group}:${change.id}`,
        kind: 'file',
        label: `[${change.change}] ${displayFilePath(change)}`,
        changeIds: [change.id],
        children: [],
        change,
    };
}
function displayFilePath(change) {
    const normalized = change.targetPath.replaceAll('\\', '/');
    if (change.capability === 'skills') {
        const marker = `/skills/${change.name}/`;
        const markerIndex = normalized.lastIndexOf(marker);
        if (markerIndex >= 0) {
            return normalized.slice(markerIndex + marker.length);
        }
    }
    return normalized;
}
function compareGroupKeys(left, right) {
    const [leftTarget, leftCapability] = left.split('/');
    const [rightTarget, rightCapability] = right.split('/');
    const targetDelta = targetOrder.indexOf(leftTarget) - targetOrder.indexOf(rightTarget);
    if (targetDelta !== 0)
        return targetDelta;
    return capabilityOrder.indexOf(leftCapability)
        - capabilityOrder.indexOf(rightCapability);
}
function targetKey(change) {
    return change.owner === 'canonical-store' ? 'canonical-store' : change.surface ?? change.ide;
}
function displayTarget(target) {
    if (target === 'canonical-store' || isSkillSurfaceId(target))
        return displaySkillSurface(target);
    return target.charAt(0).toUpperCase() + target.slice(1);
}
function displayCapability(capability) {
    return {
        rules: 'Shared Rules',
        skills: 'Skills',
        mcp: 'MCP',
        native: 'IDE Configuration',
    }[capability];
}
