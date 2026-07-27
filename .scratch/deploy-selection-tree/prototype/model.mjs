// PROTOTYPE ONLY.
// Question: Does an IDE/capability/package/file tree plus a focus-following
// viewport make a real, large Deploy Plan understandable in a short terminal?

const ideOrder = ['codex', 'claude-code', 'gemini'];
const capabilityOrder = ['rules', 'skills', 'mcp', 'native'];

export function buildDeployTree(plan, homeDir) {
  const standard = buildCapabilityNodes(
    plan.changes.filter((change) => change.group === 'standard'),
    'standard',
    homeDir,
  );
  const advancedChildren = buildCapabilityNodes(
    plan.changes.filter((change) => change.group === 'advanced'),
    'advanced',
    homeDir,
  );
  return [
    ...standard,
    {
      id: 'advanced',
      kind: 'advanced',
      label: 'Advanced Cleanup',
      changeIds: collectChangeIds(advancedChildren),
      children: advancedChildren,
    },
  ];
}

export function createPrototypeState(tree, plan) {
  return {
    focusId: tree[0]?.id ?? 'advanced',
    expandedIds: new Set(),
    selectedIds: new Set(
      plan.changes
        .filter((change) => change.group === 'standard' && change.defaultSelected)
        .map((change) => change.id),
    ),
  };
}

export function reducePrototypeState(tree, state, action) {
  const rows = flattenVisibleTree(tree, state.expandedIds);
  const focusIndex = Math.max(
    rows.findIndex(({ node }) => node.id === state.focusId),
    0,
  );
  const focused = rows[focusIndex]?.node;

  if (action.type === 'move') {
    return focusAt(rows, state, clamp(focusIndex + action.delta, 0, rows.length - 1));
  }
  if (action.type === 'page') {
    return focusAt(
      rows,
      state,
      clamp(focusIndex + action.delta * Math.max(action.pageSize, 1), 0, rows.length - 1),
    );
  }
  if (action.type === 'home') return focusAt(rows, state, 0);
  if (action.type === 'end') return focusAt(rows, state, rows.length - 1);
  if (action.type === 'expand') {
    if (!focused?.children?.length) return state;
    if (!state.expandedIds.has(focused.id)) {
      return {
        ...state,
        expandedIds: withId(state.expandedIds, focused.id),
      };
    }
    const expandedRows = flattenVisibleTree(tree, state.expandedIds);
    const child = expandedRows.find((row) => row.parentId === focused.id);
    return child ? { ...state, focusId: child.node.id } : state;
  }
  if (action.type === 'collapse') {
    if (!focused) return state;
    if (state.expandedIds.has(focused.id)) {
      return {
        ...state,
        expandedIds: withoutId(state.expandedIds, focused.id),
      };
    }
    const row = rows[focusIndex];
    return row?.parentId ? { ...state, focusId: row.parentId } : state;
  }
  if (action.type === 'toggle') {
    if (!focused) return state;
    const allSelected = focused.changeIds.every((id) => state.selectedIds.has(id));
    const selectedIds = new Set(state.selectedIds);
    for (const id of focused.changeIds) {
      if (allSelected) selectedIds.delete(id);
      else selectedIds.add(id);
    }
    return { ...state, selectedIds };
  }
  if (action.type === 'advanced') {
    return {
      ...state,
      focusId: 'advanced',
      expandedIds: state.expandedIds.has('advanced')
        ? withoutId(state.expandedIds, 'advanced')
        : withId(state.expandedIds, 'advanced'),
    };
  }
  return state;
}

export function flattenVisibleTree(tree, expandedIds) {
  const rows = [];
  const visit = (nodes, depth, parentId) => {
    for (const node of nodes) {
      rows.push({ node, depth, parentId });
      if (node.children?.length && expandedIds.has(node.id)) {
        visit(node.children, depth + 1, node.id);
      }
    }
  };
  visit(tree, 0, undefined);
  return rows;
}

export function viewportForFocus(rows, focusId, budget) {
  const capacity = Math.max(budget - 2, 1);
  const focusIndex = Math.max(
    rows.findIndex(({ node }) => node.id === focusId),
    0,
  );
  const start = clamp(
    focusIndex - Math.floor(capacity / 2),
    0,
    Math.max(rows.length - capacity, 0),
  );
  const end = Math.min(start + capacity, rows.length);
  return {
    rows: rows.slice(start, end),
    start,
    end,
    above: start,
    below: rows.length - end,
    total: rows.length,
  };
}

export function selectionMarker(node, selectedIds) {
  const selected = node.changeIds.filter((id) => selectedIds.has(id)).length;
  if (selected === 0) return '[ ]';
  if (selected === node.changeIds.length) return '[x]';
  return '[-]';
}

export function focusedNode(tree, state) {
  return flattenVisibleTree(tree, state.expandedIds)
    .find(({ node }) => node.id === state.focusId)?.node;
}

function buildCapabilityNodes(changes, group, homeDir) {
  const buckets = new Map();
  for (const change of changes) {
    const key = `${change.ide}/${change.capability}`;
    const bucket = buckets.get(key) ?? [];
    bucket.push(change);
    buckets.set(key, bucket);
  }
  return [...buckets.entries()]
    .sort(([left], [right]) => compareCapabilityKeys(left, right))
    .map(([key, bucket]) => {
      const [ide, capability] = key.split('/');
      const children = capability === 'skills'
        ? buildSkillPackages(bucket, group, homeDir)
        : bucket.map((change) => fileNode(change, group, homeDir));
      return {
        id: `capability:${group}:${key}`,
        kind: 'capability',
        label: `${displayIde(ide)} / ${displayCapability(capability)}`,
        changeIds: bucket.map((change) => change.id),
        children,
      };
    });
}

function buildSkillPackages(changes, group, homeDir) {
  const buckets = new Map();
  for (const change of changes) {
    const bucket = buckets.get(change.name) ?? [];
    bucket.push(change);
    buckets.set(change.name, bucket);
  }
  return [...buckets.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, bucket]) => ({
      id: `package:${group}:${bucket[0].ide}:${name}`,
      kind: 'package',
      label: name,
      changeIds: bucket.map((change) => change.id),
      children: bucket
        .map((change) => fileNode(change, group, homeDir))
        .sort((left, right) => left.label.localeCompare(right.label)),
    }));
}

function fileNode(change, group, homeDir) {
  return {
    id: `file:${group}:${change.id}`,
    kind: 'file',
    label: `[${change.change}] ${relativeDisplayPath(change, homeDir)}`,
    changeIds: [change.id],
    children: [],
    targetPath: change.targetPath,
    strategy: change.strategy,
  };
}

function relativeDisplayPath(change, homeDir) {
  const normalized = change.targetPath.replaceAll('\\', '/');
  if (change.capability === 'skills') {
    const marker = `/skills/${change.name}/`;
    const index = normalized.lastIndexOf(marker);
    if (index >= 0) return normalized.slice(index + marker.length);
  }
  const normalizedHome = homeDir.replaceAll('\\', '/').replace(/\/$/, '');
  if (normalized.startsWith(`${normalizedHome}/`)) {
    return `~/${normalized.slice(normalizedHome.length + 1)}`;
  }
  return normalized;
}

function collectChangeIds(nodes) {
  return nodes.flatMap((node) => node.changeIds);
}

function compareCapabilityKeys(left, right) {
  const [leftIde, leftCapability] = left.split('/');
  const [rightIde, rightCapability] = right.split('/');
  const ideDelta = ideOrder.indexOf(leftIde) - ideOrder.indexOf(rightIde);
  if (ideDelta !== 0) return ideDelta;
  return capabilityOrder.indexOf(leftCapability)
    - capabilityOrder.indexOf(rightCapability);
}

function displayIde(ide) {
  if (ide === 'claude-code') return 'Claude Code';
  return ide.charAt(0).toUpperCase() + ide.slice(1);
}

function displayCapability(capability) {
  return {
    rules: 'Shared Rules',
    skills: 'Skills',
    mcp: 'MCP',
    native: 'IDE Configuration',
  }[capability] ?? capability;
}

function focusAt(rows, state, index) {
  const target = rows[index]?.node;
  return target ? { ...state, focusId: target.id } : state;
}

function withId(values, id) {
  const result = new Set(values);
  result.add(id);
  return result;
}

function withoutId(values, id) {
  const result = new Set(values);
  result.delete(id);
  return result;
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(value, maximum));
}
