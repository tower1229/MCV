import * as fs from 'fs';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import * as yaml from 'yaml';
import { migrateRepository } from './repository';

describe('repository schema migration', () => {
  const originalEnv = { ...process.env };
  const roots: string[] = [];
  afterEach(() => { process.env = { ...originalEnv }; for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

  it('previews without mutation and migrates Gemini layout plus runtime MCP safely', () => {
    const root = fs.mkdtempSync(path.join(process.cwd(), '.mcv-migration-')); roots.push(root);
    process.env.APPDATA = path.join(root, 'state');
    const repository = path.join(root, 'repository'); fs.mkdirSync(path.join(repository, 'ide', 'gemini', 'native'), { recursive: true });
    fs.mkdirSync(path.join(repository, 'common'), { recursive: true });
    fs.writeFileSync(path.join(repository, 'mcv.yaml'), 'schemaVersion: 1\nrepositoryId: repo\ninitializedAt: old\ntargets: { gemini: { enabled: true } }\ncustomField: keep\n');
    fs.writeFileSync(path.join(repository, 'ide', 'gemini', 'native', 'settings.json'), '{}\n');
    fs.writeFileSync(path.join(repository, 'common', 'mcp.yaml'), 'servers:\n  node_repl: { command: runtime/node_repl.exe }\n  user: { command: server }\n');
    expect(migrateRepository(repository, true).schemaVersion).toBe(2);
    expect(yaml.parse(fs.readFileSync(path.join(repository, 'mcv.yaml'), 'utf8')).schemaVersion).toBe(1);
    migrateRepository(repository, false);
    const migrated = yaml.parse(fs.readFileSync(path.join(repository, 'mcv.yaml'), 'utf8'));
    expect(migrated.customField).toBe('keep');
    expect(fs.existsSync(path.join(repository, 'ide', 'gemini', 'native', 'gemini-cli', 'settings.json'))).toBe(true);
    const mcp = yaml.parse(fs.readFileSync(path.join(repository, 'common', 'mcp.yaml'), 'utf8'));
    expect(Object.keys(mcp.servers)).toEqual(['user']);
  });
});
