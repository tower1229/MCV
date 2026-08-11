import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';

const sourceRoot = path.resolve(import.meta.dirname, '..');

describe('Human Presentation architecture boundary', () => {
  it('routes command-owned human output through Presentation and JSON gateways', () => {
    const commandSources = sourceFiles(path.join(sourceRoot, 'commands'));
    for (const filePath of commandSources) {
      const source = fs.readFileSync(filePath, 'utf8');
      expect(source, filePath).not.toMatch(/console\.(?:log|error|warn)\s*\(/u);
      expect(source, filePath).not.toMatch(/\\u001[bB]|\\x1[bB]|\\033/u);
    }
    expect(fs.readFileSync(path.join(sourceRoot, 'index.ts'), 'utf8'))
      .not.toMatch(/console\.(?:log|error|warn)\s*\(/u);
  });

  it('keeps operation renderers semantic and free of terminal controls', () => {
    for (const filePath of sourceFiles(path.join(sourceRoot, 'renderers'))) {
      const source = fs.readFileSync(filePath, 'utf8');
      expect(source, filePath).not.toMatch(/\\u001[bB]|\\x1[bB]|\\033/u);
      expect(source, filePath).not.toContain("../presentation/output.js");
    }
  });

  it('has no legacy string-document or coloring gateway', () => {
    expect(fs.existsSync(path.join(sourceRoot, 'cli', 'human-output.ts'))).toBe(false);
    expect(fs.existsSync(path.join(sourceRoot, 'renderers', 'human-document.ts'))).toBe(false);
    expect(fs.existsSync(path.join(sourceRoot, 'renderers', 'color.ts'))).toBe(false);
  });
});

function sourceFiles(directory: string): string[] {
  return fs.readdirSync(directory)
    .filter((name) => /\.(?:ts|tsx)$/u.test(name) && !name.includes('.test.'))
    .map((name) => path.join(directory, name));
}
