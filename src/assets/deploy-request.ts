import type { DeployScope } from './catalog.js';
import type { AssetSelection } from '../profiles/resolver.js';

export interface DeployRequest {
  scope: DeployScope;
  targetRoot: string;
  profileIds: string[];
  selection: AssetSelection;
  /** When true, project-scope Plans may include Advanced Cleanup prune candidates from the Managed Receipt. */
  pruneManaged?: boolean;
}

export interface DeployContextFields {
  scope: DeployScope;
  targetRoot: string;
  profileIds: string[];
  profilesRevision: string;
  catalogRevision: string;
  assetIds: string[];
}

export function deployContextFieldsFromRequest(request: DeployRequest): DeployContextFields {
  return {
    scope: request.scope,
    targetRoot: request.targetRoot,
    profileIds: [...request.profileIds],
    profilesRevision: request.selection.profilesRevision,
    catalogRevision: request.selection.catalogRevision,
    assetIds: [...request.selection.assetIds],
  };
}
