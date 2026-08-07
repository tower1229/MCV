import type { DeviceContext } from '../adapters/types.js';
import { GLOBAL_PROFILE_ID } from '../profiles/contracts.js';
import { deriveAssetCatalog } from '../assets/catalog.js';
import type { DeployRequest } from '../assets/deploy-request.js';
import { writeProfilesDocument } from '../profiles/store.js';
import { buildDeployRequest, createDeployPlan, type DeployPlan } from '../operations/deploy.js';
import { resolveBoundRepository } from '../utils/repository.js';

/** Seed profiles.yaml with a global Profile containing every current Catalog Asset. */
export function seedGlobalProfileWithCatalog(repositoryPath: string): void {
  const catalog = deriveAssetCatalog(repositoryPath);
  writeProfilesDocument(repositoryPath, {
    schemaVersion: 1,
    profiles: {
      global: {
        title: 'Global',
        assets: catalog.assets.map((asset) => asset.id),
      },
    },
  });
}

/** Build a DeployRequest for the built-in global Profile at device-global scope. */
export function globalDeployRequest(
  repositoryPath: string,
  context: DeviceContext,
): DeployRequest {
  const built = buildDeployRequest(repositoryPath, {
    profileIds: [GLOBAL_PROFILE_ID],
    scope: 'global',
    targetRoot: context.homeDir,
  });
  if ('error' in built) {
    throw new Error(`${built.error.code}: ${built.error.message}`);
  }
  return built.request;
}

/** Plan helper for tests and status: global Profile → device-global locations. */
export async function createGlobalDeployPlan(context: DeviceContext): Promise<DeployPlan> {
  const repositoryPath = resolveBoundRepository(context);
  return createDeployPlan(context, globalDeployRequest(repositoryPath, context));
}
