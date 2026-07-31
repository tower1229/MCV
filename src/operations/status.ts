import type { DeviceContext } from '../adapters/types.js';
import {
  deployPathExists,
  hashDeviceTopologyNode,
} from '../core/canonical-skill-device-layout.js';
import {
  inspectManagedSkillDrift,
  isPathCoveredByManagedSkillLayout,
  resolveSkillPackageStorePath,
  type ContentDriftEntry,
  type TopologyDriftEntry,
} from '../core/managed-skill-layout.js';
import {
  readManifest,
  resolveBoundRepository,
  type McvManifest,
} from '../utils/repository.js';
import { readState, type McvState } from '../utils/state.js';
import {
  createDeployPlan,
  type DeployChange,
  type DeployLinkOutcome,
} from './deploy.js';
import {
  OPERATION_SCHEMA_VERSION,
  type Report,
} from './contracts.js';
import {
  inspectEnvironment,
  type EnvironmentDetails,
  type EnvironmentReport,
} from './environment.js';
import {
  inspectRepository,
  type GitRepositoryStatus,
} from './repository.js';

export interface RepositoryStatusSummary {
  path: string;
  id: string;
  schemaVersion: number;
  git?: GitRepositoryStatus;
}

export interface PendingDeploymentSummary {
  add: number;
  modify: number;
  delete: number;
  total: number;
}

export interface LocalStateFileStatus {
  path: string;
  state: 'unchanged' | 'drift' | 'missing';
}

export interface PostDeployLocalStateSummary {
  unchanged: number;
  drift: number;
  contentDrift: number;
  topologyDrift: number;
  missing: number;
  total: number;
  files: LocalStateFileStatus[];
  contentDrifts: ContentDriftEntry[];
  topologyDrifts: TopologyDriftEntry[];
}

export interface SurfaceSupport {
  id: string;
  path: string;
  detected: boolean;
}

export interface IdeSupport {
  id: EnvironmentDetails['id'];
  name: string;
  enabled: boolean;
  detected: boolean;
  surfaces: SurfaceSupport[];
}

export interface StatusEnvironmentSummary {
  missingVariables: string[];
  ideSupport: IdeSupport[];
}

export type StatusReport = Report<DeployChange> & {
  operation: 'status';
  repository: RepositoryStatusSummary;
  pendingDeployment: PendingDeploymentSummary;
  postDeployLocalState: PostDeployLocalStateSummary;
  environment: StatusEnvironmentSummary;
  linkOutcomes: DeployLinkOutcome[];
  lastOperation: ReturnType<typeof readState>['lastOperation'] | null;
};

export async function inspectStatus(context: DeviceContext): Promise<StatusReport> {
  const state = readState(context);
  const repositoryPath = resolveBoundRepository(context);
  const manifest = readManifest(repositoryPath);
  if (state.defaultRepositoryId && state.defaultRepositoryId !== manifest.repositoryId) {
    throw new Error('Bound repository ID does not match local state. Run `mcv bind <path>` again.');
  }

  const [deployPlan, environmentReport] = await Promise.all([
    createDeployPlan(context),
    inspectEnvironment(context, repositoryPath),
  ]);
  const repositoryReport = inspectRepository(context, repositoryPath);
  const changes = deployPlan.changes;

  return {
    schemaVersion: OPERATION_SCHEMA_VERSION,
    operation: 'status',
    status: 'reported',
    ready: deployPlan.status !== 'failed' && deployPlan.readyToApply,
    repositoryPath,
    repository: {
      path: repositoryPath,
      id: repositoryReport.repositoryId ?? manifest.repositoryId,
      schemaVersion: repositoryReport.repositorySchemaVersion ?? manifest.schemaVersion,
      ...(repositoryReport.git ? { git: repositoryReport.git } : {}),
    },
    changes,
    linkOutcomes: deployPlan.linkOutcomes,
    pendingDeployment: summarizePendingDeployment(changes),
    postDeployLocalState: summarizePostDeployLocalState(state),
    environment: {
      missingVariables: environmentReport.missingVariables,
      ideSupport: summarizeIdeSupport(environmentReport, manifest),
    },
    lastOperation: state.lastOperation ?? null,
    issues: deployPlan.issues,
    nextActions: deployPlan.nextActions,
  };
}

function summarizePendingDeployment(changes: DeployChange[]): PendingDeploymentSummary {
  const materializationPackages = new Set<string>();
  const summary: PendingDeploymentSummary = { add: 0, modify: 0, delete: 0, total: 0 };
  for (const change of changes) {
    if (change.deploymentKind === 'physical-materialization') {
      const packagePath = resolveSkillPackageStorePath(change.targetPath);
      if (materializationPackages.has(packagePath)) continue;
      materializationPackages.add(packagePath);
    }
    summary[change.change] += 1;
    summary.total += 1;
  }
  return summary;
}

function summarizePostDeployLocalState(state: McvState): PostDeployLocalStateSummary {
  const baselineFiles = state.baselineSnapshot?.files ?? {};
  const {
    contentDrifts,
    topologyDrifts,
    coveredPaths,
  } = inspectManagedSkillDrift(state.managedSkillLayout);

  const files = Object.entries(baselineFiles)
    .filter(([filePath]) => !isPathCoveredByManagedSkillLayout(filePath, coveredPaths))
    .map(([filePath, expectedHash]): LocalStateFileStatus => {
      if (!deployPathExists(filePath)) return { path: filePath, state: 'missing' };
      return {
        path: filePath,
        state: hashDeviceTopologyNode(filePath) === expectedHash ? 'unchanged' : 'drift',
      };
    });

  const ordinaryDrift = files.filter((file) => file.state === 'drift').length;
  const missing = files.filter((file) => file.state === 'missing').length;
  const unchanged = files.filter((file) => file.state === 'unchanged').length
    + (state.managedSkillLayout
      ? Object.values(state.managedSkillLayout.packages).length
        - contentDrifts.length
        + Object.values(state.managedSkillLayout.projections).length
        - topologyDrifts.length
      : 0);
  const contentDrift = contentDrifts.length;
  const topologyDrift = topologyDrifts.length;
  const drift = ordinaryDrift + contentDrift + topologyDrift;

  return {
    unchanged,
    drift,
    contentDrift,
    topologyDrift,
    missing,
    total: unchanged + drift + missing,
    files,
    contentDrifts,
    topologyDrifts,
  };
}

function summarizeIdeSupport(
  environmentReport: EnvironmentReport,
  manifest: McvManifest,
): IdeSupport[] {
  return environmentReport.environments.map((environment) => {
    const targetId = manifestTargetId(environment.id);
    return {
      id: environment.id,
      name: environment.name,
      enabled: manifest.targets[targetId]?.enabled === true,
      detected: environment.detected,
      surfaces: environment.configDirectories.map((surface) => ({
        id: surface.id,
        path: surface.path,
        detected: surface.exists,
      })),
    };
  });
}

function manifestTargetId(
  environmentId: EnvironmentDetails['id'],
): keyof McvManifest['targets'] {
  switch (environmentId) {
    case 'codex': return 'codex';
    case 'claude-code': return 'claudeCode';
    case 'gemini': return 'gemini';
  }
}
