import { describe, expect, it } from 'vitest';
import type { DeployChange, DeployPlan, DeployResult } from '../operations/deploy.js';
import { renderDeployPlanPlain, renderDeployResultPlain } from './deploy.js';

describe('plain Deploy renderer', () => {
  it('renders Gemini Skill Surfaces independently while retaining the Gemini IDE contract', () => {
    const changes = [
      skillChange('gemini-cli-change', 'gemini-cli', '/home/.gemini/skills/review/SKILL.md'),
      skillChange('antigravity-change', 'antigravity', '/home/.gemini/config/skills/review/SKILL.md'),
    ];
    const plan: DeployPlan = {
      schemaVersion: 1,
      operation: 'deploy',
      status: 'planned',
      readyToApply: true,
      operationId: 'renderer-test',
      preconditions: {},
      repositoryPath: '/repository',
      changes,
      linkOutcomes: [],
      issues: [],
      nextActions: [],
    };
    const result: DeployResult = {
      schemaVersion: 1,
      operation: 'deploy',
      status: 'succeeded',
      repositoryPath: '/repository',
      changes,
      linkOutcomes: [],
      issues: [],
      nextActions: [],
      data: {
        appliedChangeIds: changes.map((change) => change.id),
        writtenPaths: changes.map((change) => change.targetPath),
        deletedPaths: [],
      },
    };

    expect(renderDeployPlanPlain(plan).join('\n')).toContain('Gemini CLI / Skills');
    expect(renderDeployPlanPlain(plan).join('\n')).toContain('Antigravity / Skills');
    expect(renderDeployResultPlain(result)).toContain(
      'Copy projections: 2 (Antigravity, Gemini CLI)',
    );
  });
});

function skillChange(
  id: string,
  surface: 'gemini-cli' | 'antigravity',
  targetPath: string,
): DeployChange {
  return {
    id,
    owner: 'ide',
    ide: 'gemini',
    surface,
    capability: 'skills',
    name: 'review',
    targetPath,
    change: 'add',
    defaultSelected: true,
    group: 'standard',
    strategy: 'replace-entire-file',
    deploymentKind: 'copy-projection',
    preview: {
      targetPath,
      kind: 'text',
      bytes: 9,
      sha256: 'a'.repeat(64),
      diff: '+ # Review',
    },
  };
}
