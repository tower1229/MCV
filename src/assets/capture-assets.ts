import type { ConfigurationCapability } from '../adapters/types.js';
import type { ProfilesDocument } from '../profiles/contracts.js';
import { formatAssetId } from './ids.js';
import { DECLARED_NATIVE_UNITS, nativeAssetId } from './native-units.js';
import { instructionDefinition } from '../core/ide-instructions.js';

export interface CaptureAssetRef {
  ide: 'shared' | 'codex' | 'claude-code' | 'gemini';
  capability: ConfigurationCapability;
  itemType: 'file' | 'skill' | 'mcp';
  name: string;
  decision?: 'candidate' | 'skip';
  repositoryPaths: readonly string[];
}

export function assetIdForCaptureChange(change: CaptureAssetRef): string | undefined {
  if (change.capability === 'instructions' && change.ide !== 'shared') {
    return instructionDefinition(change.ide).assetId;
  }
  if (change.itemType === 'skill') {
    return formatAssetId({ type: 'skill', name: change.name });
  }
  if (change.capability === 'mcp' && change.itemType === 'mcp') {
    if (change.decision === 'skip' || change.name.endsWith(' (skip)')) return undefined;
    return formatAssetId({ type: 'mcp', name: change.name });
  }
  if (change.capability === 'native') {
    const repositoryPath = change.repositoryPaths[0];
    const unit = DECLARED_NATIVE_UNITS.find((entry) => entry.repositoryPath === repositoryPath);
    return unit ? nativeAssetId(unit) : undefined;
  }
  return undefined;
}

export function findReferencingProfiles(
  document: ProfilesDocument,
  assetId: string,
): string[] {
  return Object.entries(document.profiles)
    .filter(([, profile]) => profile.assets.includes(assetId))
    .map(([id]) => id)
    .sort((left, right) => left.localeCompare(right));
}
