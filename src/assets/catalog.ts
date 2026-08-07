import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'yaml';
import { isRecord } from '../utils/objects.js';
import { hashDirectoryTree } from '../utils/files.js';
import { formatAssetId, isValidAssetId } from './ids.js';
import {
  adapterCapabilityDeclarations,
  DECLARED_NATIVE_UNITS,
  nativeAssetId,
} from './native-units.js';

export type AssetType = 'rule' | 'skill' | 'mcp' | 'native';
export type AssetActivation = 'always' | 'on-demand' | 'tool-surface' | 'configuration';
export type DeployScope = 'project' | 'global';
export type CatalogTarget = 'codex' | 'claude-code' | 'gemini';

export interface AssetCatalogItem {
  id: string;
  type: AssetType;
  displayName: string;
  description?: string;
  sourcePaths: string[];
  contentHash: string;
  sizeBytes: number;
  activation: AssetActivation;
  supportedScopes: DeployScope[];
  supportedTargets: CatalogTarget[];
}

export interface AssetCatalog {
  revision: string;
  assets: AssetCatalogItem[];
}

const ALL_TARGETS: CatalogTarget[] = ['codex', 'claude-code', 'gemini'];
const MCP_OVERRIDE_PATHS = [
  'ide/codex/mcp-overrides.yaml',
  'ide/claude-code/mcp-overrides.yaml',
  'ide/gemini/gemini-cli/mcp-overrides.yaml',
  'ide/gemini/antigravity/mcp-overrides.yaml',
] as const;

export function deriveAssetCatalog(repositoryPath: string): AssetCatalog {
  const assets: AssetCatalogItem[] = [];
  const rules = deriveCanonicalRules(repositoryPath);
  if (rules) assets.push(rules);
  assets.push(...deriveSkills(repositoryPath));
  assets.push(...deriveMcpServers(repositoryPath));
  assets.push(...deriveNativeUnits(repositoryPath));
  assets.sort((left, right) => left.id.localeCompare(right.id));
  return {
    revision: computeCatalogRevision(assets),
    assets,
  };
}

export function computeCatalogRevision(assets: readonly AssetCatalogItem[]): string {
  const hash = createHash('sha256');
  for (const asset of [...assets].sort((left, right) => left.id.localeCompare(right.id))) {
    hash.update(asset.id);
    hash.update('\0');
    hash.update(asset.contentHash);
    hash.update('\0');
  }
  for (const declaration of adapterCapabilityDeclarations()) {
    hash.update(declaration.target);
    hash.update('\0');
    hash.update(declaration.capabilities.join(','));
    hash.update('\0');
    hash.update(declaration.nativeFileIds.join(','));
    hash.update('\0');
  }
  return hash.digest('hex');
}

function deriveCanonicalRules(repositoryPath: string): AssetCatalogItem | undefined {
  const relativePaths = collectSourcePaths(repositoryPath, ['common/AGENTS.md']);
  if (relativePaths.length === 0) return undefined;
  const { contentHash, sizeBytes } = hashRelativePaths(repositoryPath, relativePaths);
  return {
    id: formatAssetId({ type: 'rule' }),
    type: 'rule',
    displayName: 'Canonical Rules',
    description: 'Cross-IDE development rules (common/AGENTS.md)',
    sourcePaths: relativePaths,
    contentHash,
    sizeBytes,
    activation: 'always',
    supportedScopes: ['project', 'global'],
    supportedTargets: [...ALL_TARGETS],
  };
}

function deriveSkills(repositoryPath: string): AssetCatalogItem[] {
  const skillsRoot = path.join(repositoryPath, 'common', 'skills');
  if (!fs.existsSync(skillsRoot)) return [];
  const items: AssetCatalogItem[] = [];
  for (const entry of fs.readdirSync(skillsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const packageRoot = path.join(skillsRoot, entry.name);
    const skillMd = path.join(packageRoot, 'SKILL.md');
    if (!fs.existsSync(skillMd)) continue;
    let name = entry.name;
    let description: string | undefined;
    try {
      const frontmatter = parseSkillFrontmatter(fs.readFileSync(skillMd, 'utf8'));
      if (frontmatter.name && frontmatter.name !== entry.name) continue;
      if (frontmatter.name) name = frontmatter.name;
      description = frontmatter.description;
    } catch {
      continue;
    }
    const id = formatAssetId({ type: 'skill', name });
    if (!isValidAssetId(id)) continue;
    const sourcePaths = [`common/skills/${name}`];
    for (const platform of ['macos', 'windows'] as const) {
      const override = `overrides/${platform}/common/skills/${name}`;
      if (fs.existsSync(path.join(repositoryPath, ...override.split('/')))) {
        sourcePaths.push(override);
      }
    }
    const hash = createHash('sha256');
    hash.update(hashDirectoryTree(packageRoot));
    let sizeBytes = directorySizeBytes(packageRoot);
    for (const relative of sourcePaths.slice(1)) {
      const absolute = path.join(repositoryPath, ...relative.split('/'));
      hash.update(relative);
      hash.update('\0');
      if (fs.statSync(absolute).isDirectory()) {
        hash.update(hashDirectoryTree(absolute));
        sizeBytes += directorySizeBytes(absolute);
      } else {
        hash.update(fs.readFileSync(absolute));
        sizeBytes += fs.statSync(absolute).size;
      }
    }
    items.push({
      id,
      type: 'skill',
      displayName: name,
      description,
      sourcePaths,
      contentHash: hash.digest('hex'),
      sizeBytes,
      activation: 'on-demand',
      supportedScopes: ['project', 'global'],
      supportedTargets: [...ALL_TARGETS],
    });
  }
  return items;
}

function deriveMcpServers(repositoryPath: string): AssetCatalogItem[] {
  const registryRelative = 'common/mcp.yaml';
  const registryPath = path.join(repositoryPath, ...registryRelative.split('/'));
  if (!fs.existsSync(registryPath)) return [];
  const parsed = yaml.parse(fs.readFileSync(registryPath, 'utf8')) as unknown;
  if (!isRecord(parsed) || !isRecord(parsed.servers)) return [];
  const overrideDocs = loadMcpOverrideDocs(repositoryPath);
  const items: AssetCatalogItem[] = [];
  for (const [name, server] of Object.entries(parsed.servers)) {
    if (!isRecord(server)) continue;
    const id = formatAssetId({ type: 'mcp', name });
    if (!isValidAssetId(id)) continue;
    const sourcePaths = [registryRelative];
    const hash = createHash('sha256');
    hash.update(name);
    hash.update('\0');
    hash.update(yaml.stringify(server));
    let sizeBytes = Buffer.byteLength(yaml.stringify({ [name]: server }), 'utf8');
    for (const { relativePath, document } of overrideDocs) {
      if (!(name in document)) continue;
      sourcePaths.push(relativePath);
      const fragment = yaml.stringify({ [name]: document[name] });
      hash.update(relativePath);
      hash.update('\0');
      hash.update(fragment);
      sizeBytes += Buffer.byteLength(fragment, 'utf8');
    }
    for (const platform of ['macos', 'windows'] as const) {
      const override = `overrides/${platform}/common/mcp.yaml`;
      const absolute = path.join(repositoryPath, ...override.split('/'));
      if (!fs.existsSync(absolute)) continue;
      const overrideParsed = yaml.parse(fs.readFileSync(absolute, 'utf8')) as unknown;
      if (!isRecord(overrideParsed) || !isRecord(overrideParsed.servers) || !(name in overrideParsed.servers)) {
        continue;
      }
      sourcePaths.push(override);
      const fragment = yaml.stringify({ [name]: overrideParsed.servers[name] });
      hash.update(override);
      hash.update('\0');
      hash.update(fragment);
      sizeBytes += Buffer.byteLength(fragment, 'utf8');
    }
    items.push({
      id,
      type: 'mcp',
      displayName: name,
      description: name,
      sourcePaths,
      contentHash: hash.digest('hex'),
      sizeBytes,
      activation: 'tool-surface',
      supportedScopes: ['project', 'global'],
      supportedTargets: [...ALL_TARGETS],
    });
  }
  return items;
}

function deriveNativeUnits(repositoryPath: string): AssetCatalogItem[] {
  const items: AssetCatalogItem[] = [];
  for (const unit of DECLARED_NATIVE_UNITS) {
    const sourcePaths = collectSourcePaths(repositoryPath, [unit.repositoryPath]);
    if (sourcePaths.length === 0) continue;
    const { contentHash, sizeBytes } = hashRelativePaths(repositoryPath, sourcePaths);
    items.push({
      id: nativeAssetId(unit),
      type: 'native',
      displayName: unit.displayName,
      description: unit.fileId,
      sourcePaths,
      contentHash,
      sizeBytes,
      activation: 'configuration',
      supportedScopes: [...unit.supportedScopes],
      supportedTargets: [unit.target],
    });
  }
  return items;
}

function collectSourcePaths(repositoryPath: string, basePaths: string[]): string[] {
  const paths: string[] = [];
  for (const relative of basePaths) {
    if (fs.existsSync(path.join(repositoryPath, ...relative.split('/')))) {
      paths.push(relative);
    }
    for (const platform of ['macos', 'windows'] as const) {
      const override = `overrides/${platform}/${relative}`;
      if (fs.existsSync(path.join(repositoryPath, ...override.split('/')))) {
        paths.push(override);
      }
    }
  }
  return paths;
}

function hashRelativePaths(
  repositoryPath: string,
  relativePaths: string[],
): { contentHash: string; sizeBytes: number } {
  const hash = createHash('sha256');
  let sizeBytes = 0;
  for (const relative of relativePaths) {
    const absolute = path.join(repositoryPath, ...relative.split('/'));
    hash.update(relative);
    hash.update('\0');
    hash.update(fs.readFileSync(absolute));
    sizeBytes += fs.statSync(absolute).size;
  }
  return { contentHash: hash.digest('hex'), sizeBytes };
}

function directorySizeBytes(root: string): number {
  let total = 0;
  const visit = (directory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const current = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        visit(current);
        continue;
      }
      if (entry.isFile()) total += fs.statSync(current).size;
    }
  };
  visit(root);
  return total;
}

function loadMcpOverrideDocs(
  repositoryPath: string,
): Array<{ relativePath: string; document: Record<string, unknown> }> {
  const docs: Array<{ relativePath: string; document: Record<string, unknown> }> = [];
  for (const relativePath of MCP_OVERRIDE_PATHS) {
    const absolute = path.join(repositoryPath, ...relativePath.split('/'));
    if (!fs.existsSync(absolute)) continue;
    const parsed = yaml.parse(fs.readFileSync(absolute, 'utf8')) as unknown;
    if (!isRecord(parsed)) continue;
    docs.push({ relativePath, document: parsed });
  }
  return docs;
}

function parseSkillFrontmatter(content: string): { name?: string; description?: string } {
  const match = content.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/);
  if (!match) return {};
  const parsed = yaml.parse(match[1]) as unknown;
  if (!isRecord(parsed)) return {};
  return {
    name: typeof parsed.name === 'string' ? parsed.name.trim() : undefined,
    description: typeof parsed.description === 'string' ? parsed.description.trim() : undefined,
  };
}
