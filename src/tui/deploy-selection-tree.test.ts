import { describe, expect, it } from 'vitest';
import type { DeployPlan } from '../operations/deploy.js';
import {
  buildDeploySelectionTree,
  flattenDeploySelectionTree,
} from './deploy-selection-tree.js';

describe('Deploy selection tree', () => {
  it('groups Skill files by capability and package without changing leaf IDs', () => {
    const plan = skillPlan();
    const tree = buildDeploySelectionTree(plan);
    const capability = tree[0];
    const packageNode = capability.children[0];

    expect(capability).toMatchObject({
      kind: 'capability',
      label: 'Codex / Skills',
      changeIds: ['skill-readme', 'skill-reference'],
    });
    expect(packageNode).toMatchObject({
      kind: 'package',
      label: 'hatch-pet',
      changeIds: ['skill-readme', 'skill-reference'],
    });
    expect(packageNode.children.map((node) => ({
      id: node.changeIds[0],
      label: node.label,
    }))).toEqual([
      { id: 'skill-readme', label: '[add] README.md' },
      { id: 'skill-reference', label: '[modify] references/guide.md' },
    ]);
  });

  it('flattens only expanded branches and reports each parent for collapse', () => {
    const tree = buildDeploySelectionTree(skillPlan());
    const capability = tree[0];
    const packageNode = capability.children[0];

    expect(flattenDeploySelectionTree(tree, [])).toHaveLength(1);
    expect(flattenDeploySelectionTree(tree, [capability.id])).toMatchObject([
      { node: { id: capability.id }, depth: 0 },
      {
        node: { id: packageNode.id },
        depth: 1,
        parentId: capability.id,
      },
    ]);
    expect(flattenDeploySelectionTree(
      tree,
      [capability.id, packageNode.id],
    )).toHaveLength(4);
  });
});

function skillPlan(): DeployPlan {
  const change = (
    id: string,
    targetPath: string,
    kind: 'add' | 'modify',
  ) => ({
    id,
    ide: 'codex' as const,
    capability: 'skills' as const,
    name: 'hatch-pet',
    targetPath,
    change: kind,
    defaultSelected: true,
    group: 'standard' as const,
    strategy: 'replace-entire-file' as const,
    preview: {
      targetPath,
      kind: 'text' as const,
      bytes: 10,
      sha256: id.padEnd(64, 'a'),
      diff: '+ content',
    },
  });
  return {
    schemaVersion: 1,
    operation: 'deploy',
    status: 'planned',
    readyToApply: true,
    operationId: 'tree-test',
    preconditions: {},
    repositoryPath: '/tmp/mcv',
    changes: [
      change(
        'skill-readme',
        '/tmp/.codex/skills/hatch-pet/README.md',
        'add',
      ),
      change(
        'skill-reference',
        '/tmp/.codex/skills/hatch-pet/references/guide.md',
        'modify',
      ),
    ],
    linkOutcomes: [],
    issues: [],
    nextActions: [],
  };
}
