const ideOrder = ['codex', 'claude-code', 'gemini'];
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
        const key = `${change.ide}/${change.capability}`;
        const items = groups.get(key) ?? [];
        items.push(change);
        groups.set(key, items);
    }
    return [...groups.entries()]
        .sort(([left], [right]) => compareGroupKeys(left, right))
        .map(([key, items]) => {
        const [ide, capability] = key.split('/');
        return {
            id: `capability:${group}:${key}`,
            kind: 'capability',
            label: `${displayIde(ide)} / ${displayCapability(capability)}`,
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
        id: `package:${group}:${items[0].ide}:${name}`,
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
    const [leftIde, leftCapability] = left.split('/');
    const [rightIde, rightCapability] = right.split('/');
    const ideDelta = ideOrder.indexOf(leftIde) - ideOrder.indexOf(rightIde);
    if (ideDelta !== 0)
        return ideDelta;
    return capabilityOrder.indexOf(leftCapability)
        - capabilityOrder.indexOf(rightCapability);
}
function displayIde(ide) {
    if (ide === 'claude-code')
        return 'Claude Code';
    return ide.charAt(0).toUpperCase() + ide.slice(1);
}
function displayCapability(capability) {
    return {
        rules: 'Shared Rules',
        skills: 'Skills',
        mcp: 'MCP',
        native: 'IDE Configuration',
    }[capability];
}
