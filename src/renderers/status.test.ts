import { describe, expect, it } from 'vitest';
import type { StatusReport } from '../operations/status.js';
import { renderStatusDocument } from './status.js';
import { renderPresentationDocument } from '../presentation/render.js';

type LinkFact = StatusReport['linkFacts'][number];

describe('Status renderer', () => {
  it('renders a stable empty Linked Skills summary', () => {
    const document = renderStatusDocument(statusReport([]));

    expect(document.detailPolicy).toBe('progressive');
    expect(renderPresentationDocument(document, 'summary', { color: false }))
      .toContain('Skills  No linked packages');
    expect(renderPresentationDocument(document, 'details', { color: false }))
      .toContain('Linked Skills  none');
  });

  it('uses semantic ANSI colors in a TTY and preserves complete NO_COLOR text', () => {
    const originalIsTTY = process.stdout.isTTY;
    const originalTerm = process.env.TERM;
    const originalNoColor = process.env.NO_COLOR;
    Object.defineProperty(process.stdout, 'isTTY', { configurable: true, value: true });
    process.env.TERM = 'xterm-256color';
    delete process.env.NO_COLOR;

    try {
      const report = statusReport([]);
      report.pendingDeployment.modify = 2;
      report.pendingDeployment.total = 2;
      report.pendingDeployment.recommended = 2;
      const colored = renderPresentationDocument(renderStatusDocument(report), 'summary', { color: true });
      expect(colored).toContain('MCV configuration overview');
      expect(colored).toContain('\u001b[33m! 2 pending deployment changes');
      expect(colored).toContain('\u001b[36mEnvironment\u001b[0m');
      expect(colored).toContain('\u001b[32m✓ No missing variables');
      expect(colored).toContain('\u001b[36mRepository\u001b[0m  /repository');

      process.env.NO_COLOR = '';
      const plain = renderPresentationDocument(renderStatusDocument(report), 'summary', { color: false });
      expect(plain).not.toContain('\u001b[');
      expect(plain).toContain('! 2 pending deployment changes');
      expect(plain).toContain('No deletions or Advanced Cleanup');
      expect(plain).toContain('Environment  ✓ No missing variables');
    } finally {
      Object.defineProperty(process.stdout, 'isTTY', {
        configurable: true,
        value: originalIsTTY,
      });
      restoreEnvironmentVariable('TERM', originalTerm);
      restoreEnvironmentVariable('NO_COLOR', originalNoColor);
    }
  });

  it('collapses healthy packages into unique package and Surface coverage counts', () => {
    const facts = [
      linkFact({
        packageNames: ['cloudflare'],
        surfaces: [{ ide: 'codex', surface: 'codex' }],
        ownership: 'external',
        linkPaths: ['/home/.agents/skills/cloudflare'],
        resolvedPaths: ['/home/.claude/skills/cloudflare'],
        affectedFileCount: 321,
      }),
      linkFact({
        id: 'shared',
        packageNames: ['shared'],
        surfaces: [
          { ide: 'codex', surface: 'codex' },
          { ide: 'claude-code', surface: 'claude-code' },
        ],
        ownership: 'managed',
        linkPaths: ['/home/.agents/skills/shared', '/home/.claude/skills/shared'],
        resolvedPaths: ['/home/.codex/skills/shared'],
        affectedFileCount: 4,
      }),
      linkFact({
        id: 'claude-only',
        packageNames: ['claude-only'],
        surfaces: [{ ide: 'claude-code', surface: 'claude-code' }],
        ownership: 'external',
        linkPaths: ['/home/.claude/skills/claude-only'],
        resolvedPaths: ['/home/.agents/skills/claude-only'],
        affectedFileCount: 2,
      }),
    ];

    const document = renderStatusDocument(statusReport(facts));
    const summary = renderPresentationDocument(document, 'summary', { color: false });

    expect(summary).toContain(
      'Skills  ✓ 3 linked packages healthy',
    );
    expect(summary).toContain('Coverage  Codex 2 · Claude Code 2 · 1 shared');
    expect(summary).toContain('External links preserved');
    expect(summary).toContain('Details  mcv status --verbose');
    expect(summary).not.toContain('cloudflare · Codex');

    const details = renderPresentationDocument(renderStatusDocument(statusReport(facts)), 'details', { color: false });
    expect(details).toContain('✓ cloudflare · Codex · Already matches');
    expect(details).toContain('Ownership  outside MCV');
    expect(details).toContain('/home/.agents/skills/cloudflare');
    expect(details).toContain('/home/.claude/skills/cloudflare');
    expect(details).toContain('321 expected file placements verified');
    expect(details).toContain('Ownership  MCV-managed');
  });

  it('uses highest package severity and expands only actionable facts in the summary', () => {
    const facts = [
      linkFact({ id: 'duplicate-healthy', packageNames: ['duplicate'] }),
      linkFact({
        id: 'duplicate-blocked',
        packageNames: ['duplicate'],
        severity: 'error',
        status: 'blocked',
        reason: 'dangling',
      }),
      linkFact({
        id: 'decision',
        packageNames: ['decision'],
        severity: 'decisionRequired',
        status: 'blocked',
        reason: 'divergent',
      }),
      linkFact({
        id: 'warning',
        packageNames: ['warning-a', 'warning-b'],
        severity: 'warning',
        status: 'blocked',
        reason: 'divergent',
        scope: 'shared-link-root',
        surfaces: [{ ide: 'gemini', surface: 'gemini-cli' }],
      }),
      linkFact({ id: 'healthy', packageNames: ['healthy'] }),
    ];

    const summary = renderPresentationDocument(
      renderStatusDocument(statusReport(facts)), 'summary', { color: false },
    );

    expect(summary).toContain('Skills  × 5 packages · 1 healthy · 3 need review · 1 blocked');
    expect(summary).toContain('× duplicate · Codex · Blocked: link target is missing');
    expect(summary).toContain('? decision · Codex · Decision required');
    expect(summary).toContain('Choose Preserve or Replace during Deploy.');
    expect(summary).toContain('! warning-a, warning-b · Gemini CLI · Review required');
    expect(summary).toContain('Acknowledge during Deploy to preserve the external shared link.');
    expect(summary).not.toContain('healthy · Codex · Already matches');
    expect(summary.indexOf('× duplicate')).toBeLessThan(summary.indexOf('? decision'));
    expect(summary.indexOf('? decision')).toBeLessThan(summary.indexOf('! warning-a'));

    const details = renderPresentationDocument(renderStatusDocument(statusReport(facts)), 'details', { color: false });
    expect(details).toContain('Coverage  1 expected file placement affected');
  });

  it('reports Canonical Store and all supported Skill Surfaces without treating the Store as shared', () => {
    const facts = [
      linkFact({
        id: 'store',
        packageNames: ['stored'],
        surfaces: [],
      }),
      linkFact({
        id: 'gemini-shared',
        packageNames: ['gemini-shared'],
        surfaces: [
          { ide: 'gemini', surface: 'gemini-cli' },
          { ide: 'gemini', surface: 'antigravity' },
        ],
      }),
    ];

    const summary = renderPresentationDocument(
      renderStatusDocument(statusReport(facts)), 'summary', { color: false },
    );

    expect(summary).toContain(
      'Coverage  Gemini CLI 1 · Antigravity 1 · Canonical Device Skill Store 1 · 1 shared',
    );
  });
});

function linkFact(overrides: Partial<LinkFact> = {}): LinkFact {
  return {
    id: 'healthy',
    status: 'satisfied-via-link',
    severity: 'notice',
    ownership: 'external',
    scope: 'skill-package',
    packageNames: ['healthy'],
    linkPaths: ['/home/.agents/skills/healthy'],
    resolvedPaths: ['/home/.codex/skills/healthy'],
    surfaces: [{ ide: 'codex', surface: 'codex' }],
    affectedFileCount: 1,
    ...overrides,
  };
}

function statusReport(linkFacts: LinkFact[]): StatusReport {
  return {
    schemaVersion: 4,
    operation: 'status',
    status: 'reported',
    ready: true,
    repositoryPath: '/repository',
    repository: {
      path: '/repository',
      id: 'repository-id',
      schemaVersion: 4,
    },
    pendingDeployment: {
      add: 0,
      modify: 0,
      delete: 0,
      total: 0,
      recommended: 0,
      optional: 0,
      advancedCleanupExcluded: 0,
    },
    postDeployLocalState: {
      unchanged: 0,
      drift: 0,
      contentDrift: 0,
      topologyDrift: 0,
      missing: 0,
      total: 0,
      files: [],
      contentDrifts: [],
      topologyDrifts: [],
    },
    environment: {
      missingVariables: [],
      ideSupport: [],
    },
    linkOutcomes: [],
    linkFacts,
    lastOperation: null,
    issues: [],
    nextActions: [],
  };
}

function restoreEnvironmentVariable(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
