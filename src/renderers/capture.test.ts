import { describe, expect, it } from 'vitest';
import type { CapturePlan } from '../operations/capture.js';
import { formatContributingProjections, renderCapturePlanPlain } from './capture.js';

describe('Capture plan rendering', () => {
  it('identifies contributing Skill projections without duplicating the package change', () => {
    const plan = {
      schemaVersion: 2,
      operation: 'capture',
      status: 'planned',
      readyToApply: true,
      operationId: 'op-1',
      repositoryPath: '/repo',
      preconditions: {},
      changes: [{
        id: 'capture-skill-1',
        ide: 'shared',
        surface: 'codex',
        itemType: 'skill',
        capability: 'skills',
        name: 'shared-demo',
        change: 'add',
        defaultSelected: true,
        repositoryPaths: ['common/skills/shared-demo/SKILL.md'],
        previews: [{
          repositoryPath: 'common/skills/shared-demo/SKILL.md',
          kind: 'text',
          bytes: 12,
          sha256: 'abc',
          diff: '+ # Shared',
        }],
        contributingProjections: [
          {
            ide: 'claude-code',
            surface: 'claude-code',
            projectionPath: '/home/.claude/skills/shared-demo',
            ownership: 'managed',
          },
          {
            ide: 'codex',
            surface: 'codex',
            projectionPath: '/home/.agents/skills/shared-demo',
            ownership: 'physical',
          },
          {
            ide: 'gemini',
            surface: 'gemini-cli',
            projectionPath: '/home/.gemini/skills/shared-demo',
            ownership: 'managed',
          },
        ],
      }],
      issues: [],
      nextActions: [],
      summary: {
        parameterizedPathCount: 0,
        excludedFileCount: 0,
      },
    } satisfies CapturePlan;

    const lines = renderCapturePlanPlain(plan);
    expect(lines.filter((line) => line.includes('[add] shared-demo'))).toHaveLength(1);
    expect(lines).toContain(
      '    Projections: claude-code (managed), codex (physical), gemini-cli (managed)',
    );
    expect(formatContributingProjections(plan.changes[0].contributingProjections!)).toBe(
      'claude-code (managed), codex (physical), gemini-cli (managed)',
    );
  });
});
