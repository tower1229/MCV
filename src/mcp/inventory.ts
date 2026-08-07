import { deriveAssetCatalog } from '../assets/catalog.js';
import { createProfileService } from '../profiles/service.js';
import type {
  AssetSummary,
  InspectInventoryInput,
  InspectInventoryOutput,
} from './contracts.js';

const DEFAULT_LIMIT = 50;

export function inspectInventory(
  repositoryPath: string,
  input: InspectInventoryInput = {},
): InspectInventoryOutput {
  try {
    const inventory = createProfileService(repositoryPath).inspect();
    const catalog = deriveAssetCatalog(repositoryPath);
    const owners = new Map<string, string[]>();
    for (const [profileId, profile] of Object.entries(inventory.profiles)) {
      for (const assetId of profile.assets) {
        const current = owners.get(assetId) ?? [];
        current.push(profileId);
        owners.set(assetId, current);
      }
    }
    for (const [assetId, profileIds] of owners) {
      profileIds.sort((left, right) => left.localeCompare(right));
      owners.set(assetId, profileIds);
    }

    const summaries: AssetSummary[] = catalog.assets.map((asset) => {
      const profileIds = owners.get(asset.id) ?? [];
      return {
        id: asset.id,
        type: asset.type,
        displayName: asset.displayName,
        ...(asset.description !== undefined ? { description: asset.description } : {}),
        sizeBytes: asset.sizeBytes,
        activation: asset.activation,
        profileIds,
        unassigned: profileIds.length === 0,
      };
    });

    const offset = decodeCursor(input.cursor);
    if (offset === undefined) {
      return {
        status: 'error',
        error: {
          code: 'mcp.invalidCursor',
          message: 'inspect_inventory cursor is invalid.',
        },
      };
    }
    const limit = input.limit ?? DEFAULT_LIMIT;
    const page = summaries.slice(offset, offset + limit);
    const nextOffset = offset + page.length;
    return {
      status: 'ok',
      catalogRevision: inventory.catalogRevision,
      profilesRevision: inventory.profilesRevision,
      assets: page,
      ...(nextOffset < summaries.length ? { nextCursor: encodeCursor(nextOffset) } : {}),
    };
  } catch (error) {
    return {
      status: 'error',
      error: {
        code: 'mcp.inspectFailed',
        message: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

function encodeCursor(offset: number): string {
  return Buffer.from(JSON.stringify({ offset }), 'utf8').toString('base64url');
}

function decodeCursor(cursor: string | undefined): number | undefined {
  if (cursor === undefined) return 0;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as unknown;
    if (
      typeof parsed === 'object'
      && parsed !== null
      && 'offset' in parsed
      && typeof (parsed as { offset: unknown }).offset === 'number'
      && Number.isInteger((parsed as { offset: number }).offset)
      && (parsed as { offset: number }).offset >= 0
    ) {
      return (parsed as { offset: number }).offset;
    }
  } catch {
    return undefined;
  }
  return undefined;
}
