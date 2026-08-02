import type {
  DeployChange,
  DeployPlan,
} from '../operations/deploy.js';
import type { IdeId, SkillSurfaceId } from '../adapters/types.js';
import { displaySkillSurface, isSkillSurfaceId } from '../core/skill-surfaces.js';

type DeployTargetKey = 'canonical-store' | IdeId | SkillSurfaceId;

export interface DeploySelectionNode {
  id: string;
  kind: 'capability' | 'package' | 'file' | 'advanced';
  label: string;
  changeIds: string[];
  children: DeploySelectionNode[];
  change?: DeployChange;
}

export interface VisibleDeploySelectionNode {
  node: DeploySelectionNode;
  depth: number;
  parentId?: string;
}

const targetOrder = [
  'canonical-store',
  'codex',
  'claude-code',
  'gemini',
  'gemini-cli',
  'antigravity',
] as const;
const capabilityOrder: DeployChange['capability'][] = [
  'rules',
  'skills',
  'mcp',
  'native',
];

export function buildDeploySelectionTree(
  plan: DeployPlan,
): DeploySelectionNode[] {
  const standard = buildCapabilityNodes(
    plan.changes.filter((change) => change.group === 'standard'),
    'standard',
  );
  const advancedChanges = plan.changes.filter(
    (change) => change.group === 'advanced',
  );
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

export function flattenDeploySelectionTree(
  tree: DeploySelectionNode[],
  expandedNodeIds: string[],
): VisibleDeploySelectionNode[] {
  const expanded = new Set(expandedNodeIds);
  const visible: VisibleDeploySelectionNode[] = [];
  const visit = (
    nodes: DeploySelectionNode[],
    depth: number,
    parentId?: string,
  ): void => {
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

function buildCapabilityNodes(
  changes: DeployChange[],
  group: DeployChange['group'],
): DeploySelectionNode[] {
  const groups = new Map<string, DeployChange[]>();
  for (const change of changes) {
    const key = `${targetKey(change)}/${change.capability}`;
    const items = groups.get(key) ?? [];
    items.push(change);
    groups.set(key, items);
  }
  return [...groups.entries()]
    .sort(([left], [right]) => compareGroupKeys(left, right))
    .map(([key, items]): DeploySelectionNode => {
      const [target, capability] = key.split('/') as [
        DeployTargetKey,
        DeployChange['capability'],
      ];
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

function buildSkillPackageNodes(
  changes: DeployChange[],
  group: DeployChange['group'],
): DeploySelectionNode[] {
  const packages = new Map<string, DeployChange[]>();
  for (const change of changes) {
    const items = packages.get(change.name) ?? [];
    items.push(change);
    packages.set(change.name, items);
  }
  return [...packages.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, items]): DeploySelectionNode => ({
      id: `package:${group}:${targetKey(items[0])}:${name}`,
      kind: 'package',
      label: name,
      changeIds: items.map((change) => change.id),
      children: items
        .map((change) => buildFileNode(change, group))
        .sort((left, right) =>
          left.label.localeCompare(right.label, undefined, { numeric: true })),
    }));
}

function buildFileNode(
  change: DeployChange,
  group: DeployChange['group'],
): DeploySelectionNode {
  return {
    id: `file:${group}:${change.id}`,
    kind: 'file',
    label: `[${change.change}] ${displayFilePath(change)}`,
    changeIds: [change.id],
    children: [],
    change,
  };
}

function displayFilePath(change: DeployChange): string {
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

function compareGroupKeys(left: string, right: string): number {
  const [leftTarget, leftCapability] = left.split('/') as [
    DeployTargetKey,
    DeployChange['capability'],
  ];
  const [rightTarget, rightCapability] = right.split('/') as [
    DeployTargetKey,
    DeployChange['capability'],
  ];
  const targetDelta = targetOrder.indexOf(leftTarget) - targetOrder.indexOf(rightTarget);
  if (targetDelta !== 0) return targetDelta;
  return capabilityOrder.indexOf(leftCapability)
    - capabilityOrder.indexOf(rightCapability);
}

function targetKey(change: DeployChange): DeployTargetKey {
  return change.owner === 'canonical-store' ? 'canonical-store' : change.surface ?? change.ide;
}

function displayTarget(target: DeployTargetKey): string {
  if (target === 'canonical-store' || isSkillSurfaceId(target)) return displaySkillSurface(target);
  return target.charAt(0).toUpperCase() + target.slice(1);
}

function displayCapability(
  capability: DeployChange['capability'],
): string {
  return {
    rules: 'Shared Rules',
    skills: 'Skills',
    mcp: 'MCP',
    native: 'IDE Configuration',
  }[capability];
}
