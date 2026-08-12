import { describe, expect, it } from 'vitest';
import type { DeployChange, DeployPlan, DeployResult } from '../operations/deploy.js';
import {
  renderDeployPlanDocument,
  renderDeployResultDocument,
} from './deploy.js';
import { renderPresentationDocument } from '../presentation/render.js';

describe('plain Deploy renderer', () => {
  it('uses semantic ANSI colors in a TTY and preserves complete NO_COLOR text', () => {
    const originalIsTTY = process.stdout.isTTY;
    const originalTerm = process.env.TERM;
    const originalNoColor = process.env.NO_COLOR;
    Object.defineProperty(process.stdout, 'isTTY', { configurable: true, value: true });
    process.env.TERM = 'xterm-256color';
    delete process.env.NO_COLOR;

    try {
      const colored = renderPresentationDocument(
        renderDeployPlanDocument(deployPlan()),
        'summary',
        { color: true },
      );
      expect(colored).toContain('Deploy global configuration');
      expect(colored).toContain('\u001b[32m✓ No selected changes to deploy');
      expect(colored).toContain('\u001b[36mRepository\u001b[0m  /repository');

      process.env.NO_COLOR = '';
      const plain = renderPresentationDocument(
        renderDeployPlanDocument(deployPlan()),
        'summary',
        { color: false },
      );
      expect(plain).not.toContain('\u001b[');
      expect(plain).toContain('✓ No selected changes to deploy');
      expect(plain).toContain('No deletions or topology migrations');
    } finally {
      Object.defineProperty(process.stdout, 'isTTY', {
        configurable: true,
        value: originalIsTTY,
      });
      restoreEnvironmentVariable('TERM', originalTerm);
      restoreEnvironmentVariable('NO_COLOR', originalNoColor);
    }
  });

  it('renders Gemini Skill Surfaces independently while retaining the Gemini IDE contract', () => {
    const changes = [
      skillChange('gemini-cli-change', 'gemini-cli', '/home/.gemini/skills/review/SKILL.md'),
      skillChange('antigravity-change', 'antigravity', '/home/.gemini/config/skills/review/SKILL.md'),
    ];
    const plan: DeployPlan = {
      schemaVersion: 4,
      operation: 'deploy',
      status: 'planned',
      readyToApply: true,
      operationId: 'renderer-test',
      preconditions: {},
      repositoryPath: '/repository',
      scope: 'global',
      targetRoot: '/tmp/home',
      profileIds: ['global'],
      profilesRevision: 'rev-profiles',
      catalogRevision: 'rev-catalog',
      assetIds: ['instruction:codex'],
      changes,
      linkOutcomes: [],
      linkFacts: [],
      decisions: [],
      issues: [],
      nextActions: [],
    };
    const result: DeployResult = {
      schemaVersion: 4,
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

    const details = renderPresentationDocument(renderDeployPlanDocument(plan), 'details', { color: false });
    expect(details).toContain('Gemini CLI / Skills');
    expect(details).toContain('Antigravity / Skills');
    expect(renderPresentationDocument(renderDeployResultDocument(result), 'details', { color: false })).toContain(
      'Copy projections  2 (Antigravity, Gemini CLI)',
    );
  });
});

function deployPlan(): DeployPlan {
  return {
    schemaVersion: 4,
    operation: 'deploy',
    status: 'planned',
    readyToApply: true,
    operationId: 'color-test',
    preconditions: {},
    repositoryPath: '/repository',
    scope: 'global',
    targetRoot: '/home',
    profileIds: ['global'],
    profilesRevision: 'rev-profiles',
    catalogRevision: 'rev-catalog',
    assetIds: [],
    changes: [],
    linkOutcomes: [],
    linkFacts: [],
    decisions: [],
    issues: [],
    nextActions: [],
  };
}

function restoreEnvironmentVariable(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

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
