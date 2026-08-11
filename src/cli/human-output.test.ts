import * as fs from 'fs';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DeviceContext } from '../adapters/types.js';
import {
  presentHumanDocument,
  type HumanDocument,
} from './human-output.js';

describe('human output presentation', () => {
  let testRoot: string;
  let context: DeviceContext;

  beforeEach(() => {
    testRoot = fs.mkdtempSync(path.join(process.cwd(), '.mcv-human-output-'));
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

  it('prints a concise summary and writes exact details to a private review artifact', () => {
    const document = reviewDocument();

    const presentation = presentHumanDocument(context, document);

    const output = vi.mocked(console.log).mock.calls.flat().join('\n');
    expect(output).toContain('Capture Plan: 1 change found.');
    expect(output).toContain('Review      ');
    expect(output).toContain(presentation.reviewPath);
    expect(output).toContain('Next: Review the complete diff.');
    expect(output).not.toContain('+ apiToken: plaintext');
    expect(presentation.reviewPath).toBeDefined();
    expect(fs.readFileSync(presentation.reviewPath!, 'utf8')).toContain('+ apiToken: plaintext');
    if (process.platform !== 'win32') {
      expect(fs.statSync(path.dirname(presentation.reviewPath!)).mode & 0o777).toBe(0o700);
      expect(fs.statSync(presentation.reviewPath!).mode & 0o777).toBe(0o600);
    }
  });

  it('keeps the review artifact and also prints full details with --verbose', () => {
    const presentation = presentHumanDocument(context, reviewDocument(), { verbose: true });

    const output = vi.mocked(console.log).mock.calls.flat().join('\n');
    expect(output).toContain('+ apiToken: plaintext');
    expect(presentation.reviewPath).toBeDefined();
  });

  it('falls back to inline details when the review artifact cannot be written', () => {
    const invalidStateRoot = path.join(testRoot, 'not-a-directory');
    fs.writeFileSync(invalidStateRoot, 'blocked');
    context.env.XDG_STATE_HOME = invalidStateRoot;

    const presentation = presentHumanDocument(context, reviewDocument());

    const output = vi.mocked(console.log).mock.calls.flat().join('\n');
    expect(presentation.reviewPath).toBeUndefined();
    expect(output).toContain('+ apiToken: plaintext');
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('Could not create the local review file'),
    );
  });

  it('keeps small reports inline and externalizes only overflowing reports', () => {
    const small = overflowDocument(['one detail']);
    presentHumanDocument(context, small);
    expect(vi.mocked(console.log).mock.calls.flat().join('\n')).toBe('one detail');

    vi.mocked(console.log).mockClear();
    const large = overflowDocument(Array.from({ length: 41 }, (_, index) => `detail ${index}`));
    const presentation = presentHumanDocument(context, large);
    const output = vi.mocked(console.log).mock.calls.flat().join('\n');
    expect(output).toContain('Environment: large report.');
    expect(output).toContain('Review      ');
    expect(output).not.toContain('detail 40');
    expect(fs.readFileSync(presentation.reviewPath!, 'utf8')).toContain('detail 40');
  });

  it('keeps progressive details on demand while preserving overflow artifacts and fallback', () => {
    const small = progressiveDocument(['hidden detail']);
    presentHumanDocument(context, small);
    expect(vi.mocked(console.log).mock.calls.flat().join('\n')).toBe('Status: concise.');

    vi.mocked(console.log).mockClear();
    presentHumanDocument(context, small, { verbose: true });
    expect(vi.mocked(console.log).mock.calls.flat().join('\n')).toBe('hidden detail');

    vi.mocked(console.log).mockClear();
    const large = progressiveDocument(Array.from({ length: 41 }, (_, index) => `detail ${index}`));
    const presentation = presentHumanDocument(context, large);
    const output = vi.mocked(console.log).mock.calls.flat().join('\n');
    expect(output).toContain('Status: concise.');
    expect(output).toContain('Review      ');
    expect(output).not.toContain('detail 40');
    expect(fs.readFileSync(presentation.reviewPath!, 'utf8')).toContain('detail 40');

    vi.mocked(console.log).mockClear();
    const invalidStateRoot = path.join(testRoot, 'not-a-progressive-directory');
    fs.writeFileSync(invalidStateRoot, 'blocked');
    context.env.XDG_STATE_HOME = invalidStateRoot;
    presentHumanDocument(context, large);
    expect(vi.mocked(console.log).mock.calls.flat().join('\n')).toContain('detail 40');
  });

  it('removes expired artifacts and retains at most ten recent review files', () => {
    const reviewDirectory = path.join(context.env.XDG_STATE_HOME!, 'mcv', 'reviews');
    fs.mkdirSync(reviewDirectory, { recursive: true });
    const expiredPath = path.join(reviewDirectory, 'capture-expired.txt');
    fs.writeFileSync(expiredPath, 'expired');
    const expiredTime = new Date(Date.now() - 2 * 24 * 60 * 60 * 1_000);
    fs.utimesSync(expiredPath, expiredTime, expiredTime);

    let latestPath = '';
    for (let index = 0; index < 12; index += 1) {
      latestPath = presentHumanDocument(context, reviewDocument()).reviewPath!;
    }

    expect(fs.existsSync(expiredPath)).toBe(false);
    expect(fs.existsSync(latestPath)).toBe(true);
    expect(fs.readdirSync(reviewDirectory).filter((name) => name.endsWith('.txt')))
      .toHaveLength(10);
  });
});

function reviewDocument(): HumanDocument {
  return {
    operation: 'capture',
    title: 'Capture Plan',
    summary: ['Capture Plan: 1 change found.'],
    details: ['settings.json:', '+ apiToken: plaintext'],
    nextActions: ['Review the complete diff.'],
    detailPolicy: 'review',
  };
}

function overflowDocument(details: string[]): HumanDocument {
  return {
    operation: 'discover',
    title: 'Environment Report',
    summary: [],
    overflowSummary: ['Environment: large report.'],
    details,
    nextActions: [],
    detailPolicy: 'overflow',
  };
}

function progressiveDocument(details: string[]): HumanDocument {
  return {
    operation: 'status',
    title: 'Overview Report',
    summary: ['Status: concise.'],
    details,
    nextActions: [],
    detailPolicy: 'progressive',
  };
}
