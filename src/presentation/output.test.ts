import * as fs from 'fs';
import * as path from 'path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DeviceContext } from '../adapters/types.js';
import type { DeployChange } from '../operations/deploy.js';
import type { PresentationDocument } from './contracts.js';
import { presentDocument } from './output.js';
import { renderStatusDocument } from '../renderers/status.js';

describe('Presentation output', () => {
  let testRoot: string;
  let context: DeviceContext;

  beforeEach(() => {
    testRoot = fs.mkdtempSync(path.join(process.cwd(), '.mcv-presentation-'));
    context = {
      homeDir: path.join(testRoot, 'home'),
      platform: 'linux',
      env: { XDG_STATE_HOME: path.join(testRoot, 'state') },
    };
    fs.mkdirSync(context.homeDir, { recursive: true });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(testRoot, { recursive: true, force: true });
  });

  it('writes a color-free private Review Artifact from semantic Details', () => {
    vi.stubEnv('FORCE_COLOR', '1');

    const result = presentDocument(context, reviewDocument());

    expect(result.reviewPath).toBeDefined();
    const artifact = fs.readFileSync(result.reviewPath!, 'utf8');
    expect(artifact).toContain('+ apiToken: plaintext');
    expect(artifact).not.toMatch(/\u001b\[/u);
    const output = loggedText();
    expect(output).toContain('✓ 1 change ready for review.');
    expect(output).toContain('Review');
    expect(output).not.toContain('+ apiToken: plaintext');
    if (process.platform !== 'win32') {
      expect(fs.statSync(path.dirname(result.reviewPath!)).mode & 0o777).toBe(0o700);
      expect(fs.statSync(result.reviewPath!).mode & 0o777).toBe(0o600);
    }
  });

  it('refuses forbidden controls and prints reversible escaped fallback', () => {
    const document = reviewDocument();
    document.details = [{ kind: 'literal', text: 'value\u001b[31mred' }];

    const result = presentDocument(context, document);

    expect(result.reviewPath).toBeUndefined();
    expect(loggedText()).toContain('value\\u{1B}[31mred');
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('forbidden control U+001B'),
    );
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('lines inline instead'));
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('permissions and retry'));
    expect(fs.existsSync(path.join(context.env.XDG_STATE_HOME!, 'mcv', 'reviews'))).toBe(false);
  });

  it('uses the native Windows state path and keeps the Review Artifact control-free', () => {
    context = {
      homeDir: path.join(testRoot, 'home'),
      platform: 'win32',
      env: { LOCALAPPDATA: path.join(testRoot, 'Local App Data') },
    };

    const result = presentDocument(context, reviewDocument());

    expect(result.reviewPath).toMatch(new RegExp(`^${escapeRegExp(path.join(context.env.LOCALAPPDATA!, 'mcv', 'reviews'))}`));
    const artifact = fs.readFileSync(result.reviewPath!, 'utf8');
    expect(artifact).not.toMatch(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u0080-\u009f]/u);
    expect(artifact).not.toMatch(/\u001b\[/u);
  });

  it('uses unwrapped Plain Details for the 40-line overflow threshold', () => {
    const document = reviewDocument();
    document.operation = 'discover';
    document.detailPolicy = 'overflow';
    document.summary = [];
    document.overflowSummary = [{ kind: 'status', role: 'information', text: 'large report' }];
    document.details = Array.from({ length: 41 }, (_, index) => ({
      kind: 'paragraph' as const,
      content: [{ text: `detail ${index}` }],
    }));

    const result = presentDocument(context, document);

    expect(loggedText()).toContain('• large report');
    expect(loggedText()).not.toContain('detail 40');
    expect(fs.readFileSync(result.reviewPath!, 'utf8')).toContain('detail 40');
  });

  it('renders a copyable Next command through its command content kind', () => {
    const document = reviewDocument();
    document.details = [];
    document.nextActions = [{ kind: 'command', text: 'mcv status --verbose' }];

    presentDocument(context, document);

    expect(loggedText()).toContain('Next command  mcv status --verbose');
  });

  it('prints an unwrapped file URL for a spaced native Review directory', () => {
    context.platform = 'darwin';
    const originalIsTTY = process.stdout.isTTY;
    const originalColumns = process.stdout.columns;
    Object.defineProperty(process.stdout, 'isTTY', { configurable: true, value: true });
    Object.defineProperty(process.stdout, 'columns', { configurable: true, value: 40 });

    try {
      const result = presentDocument(context, reviewDocument());
      const reviewDirectory = path.join(context.homeDir, 'Library', 'Application Support', 'mcv', 'reviews');
      const reviewUrl = pathToFileURL(result.reviewPath!).href;
      expect(result.reviewPath).toMatch(new RegExp(`^${escapeRegExp(reviewDirectory)}`));
      expect(reviewUrl).toContain('Application%20Support');
      expect(reviewUrl).not.toContain('Application Support');
      expect(loggedText()).toContain(`Review  ${reviewUrl}`);
      expect(loggedText()).not.toMatch(/Application(?:%20)?\n\s+Support/u);
    } finally {
      Object.defineProperty(process.stdout, 'isTTY', { configurable: true, value: originalIsTTY });
      Object.defineProperty(process.stdout, 'columns', { configurable: true, value: originalColumns });
    }
  });

  it('writes pending deployment details into an Overview Review Artifact', () => {
    const report = {
      schemaVersion: 4,
      operation: 'status' as const,
      status: 'reported' as const,
      ready: true,
      repositoryPath: path.join(context.homeDir, 'repository'),
      repository: {
        path: path.join(context.homeDir, 'repository'),
        id: 'repository-id',
        schemaVersion: 5,
      },
      pendingDeployment: {
        add: 0,
        modify: 1,
        delete: 0,
        total: 1,
        recommended: 1,
        optional: 0,
        advancedCleanupExcluded: 0,
      },
      pendingChanges: [overviewPendingChange(Array.from({ length: 45 }, (_, index) => `+ detail ${index}`).join('\n'))],
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
      environment: { missingVariables: [], ideSupport: [] },
      linkOutcomes: [],
      linkFacts: [],
      lastOperation: null,
      issues: [],
      nextActions: [],
    };

    const result = presentDocument(context, renderStatusDocument(report));

    expect(result.reviewPath).toBeDefined();
    const artifact = fs.readFileSync(result.reviewPath!, 'utf8');
    expect(artifact).toContain('Pending deployment details');
    expect(artifact).toContain('! modify: grilling');
    expect(artifact).toContain('+ detail 0');
    expect(loggedText()).not.toContain('Pending deployment details');
  });

  it('identifies the known operation outcome when primary presentation rendering fails', () => {
    const document = reviewDocument();
    Object.defineProperty(document, 'details', { get: () => { throw new Error('renderer exploded'); } });

    expect(() => presentDocument(context, document))
      .toThrow('capture planned Capture Plan could not be rendered during the presentation stage');
  });

  it('retains at most ten recent Review Artifacts', () => {
    let latestPath = '';
    for (let index = 0; index < 12; index += 1) {
      latestPath = presentDocument(context, reviewDocument()).reviewPath!;
    }
    const reviewDirectory = path.dirname(latestPath);
    expect(fs.existsSync(latestPath)).toBe(true);
    expect(fs.readdirSync(reviewDirectory).filter((name) => name.endsWith('.txt')))
      .toHaveLength(10);
  });

  function loggedText(): string {
    return vi.mocked(console.log).mock.calls.flat().join('\n');
  }
});

function reviewDocument(): PresentationDocument {
  return {
    operation: 'capture',
    outcome: 'planned',
    title: 'Capture Plan',
    summary: [{ kind: 'status', role: 'success', text: '1 change ready for review.' }],
    details: [
      { kind: 'section', title: 'settings.json', blocks: [] },
      {
        kind: 'diff',
        lines: [{ kind: 'add', text: '+ apiToken: plaintext' }],
      },
    ],
    nextActions: [{ kind: 'instruction', text: 'Review the complete diff.' }],
    detailPolicy: 'review',
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function overviewPendingChange(diff = '+ updated skill'): DeployChange {
  return {
    id: 'skill:grilling',
    owner: 'ide',
    ide: 'codex',
    surface: 'codex',
    capability: 'skills',
    name: 'grilling',
    targetPath: '/home/.codex/skills/grilling/SKILL.md',
    change: 'modify',
    defaultSelected: true,
    group: 'standard',
    strategy: 'replace-entire-file',
    deploymentKind: 'copy-projection',
    preview: {
      targetPath: '/home/.codex/skills/grilling/SKILL.md',
      kind: 'text',
      bytes: 14,
      sha256: 'b'.repeat(64),
      diff,
    },
  };
}
