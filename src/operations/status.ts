import * as fs from 'fs';
import type { DeviceContext } from '../adapters/types';
import { hashFile } from '../utils/files';
import {
  readManifest,
  resolveBoundRepository,
  type McvManifest,
} from '../utils/repository';
import { readState } from '../utils/state';
import {
  createDeployPlan,
  type DeployChange,
} from './deploy';
import {
  OPERATION_SCHEMA_VERSION,
  type Report,
} from './contracts';
import {
  inspectEnvironment,
  type EnvironmentDetails,
  type EnvironmentReport,
} from './environment';
import {
  inspectRepository,
  type GitRepositoryStatus,
} from './repository';

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
  missing: number;
  total: number;
  files: LocalStateFileStatus[];
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
    pendingDeployment: summarizePendingDeployment(changes),
    postDeployLocalState: summarizePostDeployLocalState(state.baselineSnapshot?.files ?? {}),
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
  const summary: PendingDeploymentSummary = { add: 0, modify: 0, delete: 0, total: changes.length };
  for (const change of changes) summary[change.change] += 1;
  return summary;
}

function summarizePostDeployLocalState(
  baselineFiles: Record<string, string>,
): PostDeployLocalStateSummary {
  const files = Object.entries(baselineFiles).map(([filePath, expectedHash]): LocalStateFileStatus => {
    if (!fs.existsSync(filePath)) return { path: filePath, state: 'missing' };
    return {
      path: filePath,
      state: hashFile(filePath) === expectedHash ? 'unchanged' : 'drift',
    };
  });
  return {
    unchanged: files.filter((file) => file.state === 'unchanged').length,
    drift: files.filter((file) => file.state === 'drift').length,
    missing: files.filter((file) => file.state === 'missing').length,
    total: files.length,
    files,
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
