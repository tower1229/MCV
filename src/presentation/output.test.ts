import * as fs from 'fs';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DeviceContext } from '../adapters/types.js';
import type { PresentationDocument } from './contracts.js';
import { presentDocument } from './output.js';

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
    expect(fs.existsSync(path.join(context.env.XDG_STATE_HOME!, 'mcv', 'reviews'))).toBe(false);
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
    title: 'Capture Plan',
    summary: [{ kind: 'status', role: 'success', text: '1 change ready for review.' }],
    details: [
      { kind: 'section', title: 'settings.json', blocks: [] },
      {
        kind: 'diff',
        lines: [{ kind: 'add', text: '+ apiToken: plaintext' }],
      },
    ],
    nextActions: ['Review the complete diff.'],
    detailPolicy: 'review',
  };
}
