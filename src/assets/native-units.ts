import type { IdeId } from '../adapters/types.js';
import { formatAssetId } from '../assets/ids.js';

export interface DeclaredNativeUnit {
  target: IdeId;
  fileId: string;
  repositoryPath: string;
  displayName: string;
  supportedScopes: Array<'project' | 'global'>;
}

/** Adapter-declared Native config units. Surface/platform overrides are not Assets. */
export const DECLARED_NATIVE_UNITS: readonly DeclaredNativeUnit[] = [
  {
    target: 'codex',
    fileId: 'user-settings',
    repositoryPath: 'ide/codex/native/config.toml',
    displayName: 'user-settings',
    supportedScopes: ['global'],
  },
  {
    target: 'claude-code',
    fileId: 'user-settings',
    repositoryPath: 'ide/claude-code/native/settings.json',
    displayName: 'user-settings',
    supportedScopes: ['global'],
  },
  {
    target: 'claude-code',
    fileId: 'user-state',
    repositoryPath: 'ide/claude-code/native/.claude.json',
    displayName: 'user-state',
    supportedScopes: ['global'],
  },
  {
    target: 'gemini',
    fileId: 'gemini-cli-settings',
    repositoryPath: 'ide/gemini/native/gemini-cli/settings.json',
    displayName: 'gemini-cli-settings',
    supportedScopes: ['global'],
  },
  {
    target: 'gemini',
    fileId: 'antigravity-config',
    repositoryPath: 'ide/gemini/native/antigravity/config.json',
    displayName: 'antigravity-config',
    supportedScopes: ['global'],
  },
  {
    target: 'gemini',
    fileId: 'antigravity-mcp',
    repositoryPath: 'ide/gemini/native/antigravity/mcp_config.json',
    displayName: 'antigravity-mcp',
    supportedScopes: ['global'],
  },
  {
    target: 'gemini',
    fileId: 'antigravity-cli-settings',
    repositoryPath: 'ide/gemini/native/antigravity/cli-settings.json',
    displayName: 'antigravity-cli-settings',
    supportedScopes: ['global'],
  },
  {
    target: 'gemini',
    fileId: 'antigravity-ide-settings',
    repositoryPath: 'ide/gemini/native/antigravity/ide-settings.json',
    displayName: 'antigravity-ide-settings',
    supportedScopes: ['global'],
  },
  {
    target: 'gemini',
    fileId: 'antigravity-keybindings',
    repositoryPath: 'ide/gemini/native/antigravity/keybindings.json',
    displayName: 'antigravity-keybindings',
    supportedScopes: ['global'],
  },
];

export interface AdapterCapabilityDeclaration {
  target: IdeId;
  capabilities: readonly ('rules' | 'skills' | 'mcp' | 'native')[];
  nativeFileIds: readonly string[];
}

export function adapterCapabilityDeclarations(): AdapterCapabilityDeclaration[] {
  const byTarget = new Map<IdeId, string[]>();
  for (const unit of DECLARED_NATIVE_UNITS) {
    const list = byTarget.get(unit.target) ?? [];
    list.push(unit.fileId);
    byTarget.set(unit.target, list);
  }
  return (['codex', 'claude-code', 'gemini'] as const).map((target) => ({
    target,
    capabilities: ['rules', 'skills', 'mcp', 'native'] as const,
    nativeFileIds: (byTarget.get(target) ?? []).slice().sort((a, b) => a.localeCompare(b)),
  }));
}

export function nativeAssetId(unit: DeclaredNativeUnit): string {
  return formatAssetId({ type: 'native', target: unit.target, fileId: unit.fileId });
}
