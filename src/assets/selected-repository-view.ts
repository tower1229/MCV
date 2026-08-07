import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'yaml';
import { repositoryFileForPlatform } from '../adapters/adapter-utils.js';
import type { DeviceContext } from '../adapters/types.js';
import { isRecord } from '../utils/objects.js';
import { resolvePortableValue } from '../utils/variables.js';
import type { CanonicalDeploySource } from '../adapters/types.js';
import { DECLARED_NATIVE_UNITS, nativeAssetId } from './native-units.js';
import { parseAssetId } from './ids.js';
import type { AssetSelection } from '../profiles/resolver.js';

export interface SelectedRepositoryView {
  rules?: {
    id: 'rule:canonical';
    content: string;
  };
  skills: Array<{
    id: string;
    name: string;
    files: Array<{ relativePath: string; content: Buffer }>;
  }>;
  mcpServers: Record<string, unknown>;
  mcpOverrides: Record<string, Record<string, unknown>>;
  nativeAssets: Map<string, Buffer>;
}

/** Adapter/transformer bridge: SelectedRepositoryView → existing CanonicalDeploySource shape. */
export function toCanonicalDeploySource(view: SelectedRepositoryView): CanonicalDeploySource {
  const source: CanonicalDeploySource = {
    skills: view.skills.flatMap((skill) =>
      skill.files.map((file) => ({
        relativePath: `${skill.name}/${file.relativePath}`,
        content: file.content,
      }))),
  };
  if (view.rules) source.rules = view.rules.content;
  if (Object.keys(view.mcpServers).length > 0) {
    source.mcp = { servers: view.mcpServers };
  }
  if (Object.keys(view.mcpOverrides).length > 0) {
    source.mcpOverrides = view.mcpOverrides;
  }
  return source;
}

const MCP_OVERRIDE_SURFACES: Record<string, string> = {
  codex: 'ide/codex/mcp-overrides.yaml',
  'claude-code': 'ide/claude-code/mcp-overrides.yaml',
  'gemini-cli': 'ide/gemini/gemini-cli/mcp-overrides.yaml',
  antigravity: 'ide/gemini/antigravity/mcp-overrides.yaml',
};

export function buildSelectedRepositoryView(
  repositoryPath: string,
  selection: AssetSelection,
  context: DeviceContext,
): SelectedRepositoryView {
  const selected = new Set(selection.assetIds);
  const view: SelectedRepositoryView = {
    skills: [],
    mcpServers: {},
    mcpOverrides: {},
    nativeAssets: new Map(),
  };

  if (selected.has('rule:canonical')) {
    const rulesPath = selectOverride(repositoryPath, 'AGENTS.md', context);
    if (fs.existsSync(rulesPath)) {
      view.rules = {
        id: 'rule:canonical',
        content: fs.readFileSync(rulesPath, 'utf8'),
      };
    }
  }

  for (const assetId of selection.assetIds) {
    const parsed = parseAssetId(assetId);
    if (parsed.type !== 'skill') continue;
    const skillRoot = path.join(repositoryPath, 'common', 'skills', parsed.name);
    if (!fs.existsSync(skillRoot)) continue;
    view.skills.push({
      id: assetId,
      name: parsed.name,
      files: readSkillFiles(skillRoot),
    });
  }

  const mcpNames = selection.assetIds
    .map((id) => parseAssetId(id))
    .filter((parts): parts is { type: 'mcp'; name: string } => parts.type === 'mcp')
    .map((parts) => parts.name);
  if (mcpNames.length > 0) {
    const mcpPath = selectOverride(repositoryPath, 'mcp.yaml', context);
    if (fs.existsSync(mcpPath)) {
      const parsed = resolvePortableValue(
        yaml.parse(fs.readFileSync(mcpPath, 'utf8')) as unknown,
        context.variables ?? {},
        context.platform,
      );
      if (isRecord(parsed) && isRecord(parsed.servers)) {
        for (const name of mcpNames) {
          if (name in parsed.servers) {
            view.mcpServers[name] = parsed.servers[name];
          }
        }
      }
    }
    for (const [surface, relativePath] of Object.entries(MCP_OVERRIDE_SURFACES)) {
      const overridePath = repositoryFileForPlatform(repositoryPath, relativePath, context);
      if (!fs.existsSync(overridePath)) continue;
      const document = yaml.parse(fs.readFileSync(overridePath, 'utf8')) as unknown;
      if (!isRecord(document)) continue;
      const filtered: Record<string, unknown> = {};
      for (const name of mcpNames) {
        if (name in document) filtered[name] = document[name];
      }
      if (Object.keys(filtered).length > 0) {
        view.mcpOverrides[surface] = filtered;
      }
    }
  }

  for (const unit of DECLARED_NATIVE_UNITS) {
    const assetId = nativeAssetId(unit);
    if (!selected.has(assetId)) continue;
    const sourcePath = repositoryFileForPlatform(repositoryPath, unit.repositoryPath, context);
    if (!fs.existsSync(sourcePath)) continue;
    view.nativeAssets.set(assetId, fs.readFileSync(sourcePath));
  }

  return view;
}

function selectOverride(
  repositoryPath: string,
  name: string,
  context: DeviceContext,
): string {
  const platformDirectory = context.platform === 'win32' ? 'windows' : 'macos';
  const override = path.join(repositoryPath, 'overrides', platformDirectory, 'common', name);
  return fs.existsSync(override) ? override : path.join(repositoryPath, 'common', name);
}

function readSkillFiles(
  skillRoot: string,
): Array<{ relativePath: string; content: Buffer }> {
  const files: Array<{ relativePath: string; content: Buffer }> = [];
  const walk = (directory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name))) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(absolute);
        continue;
      }
      if (!entry.isFile()) continue;
      files.push({
        relativePath: path.relative(skillRoot, absolute).split(path.sep).join('/'),
        content: fs.readFileSync(absolute),
      });
    }
  };
  walk(skillRoot);
  return files;
}
