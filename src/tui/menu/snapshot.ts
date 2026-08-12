import type { DeviceContext } from '../../adapters/types.js';
import { inspectEnvironment } from '../../operations/environment.js';
import { inspectRepository } from '../../operations/repository.js';
import { inspectStatus } from '../../operations/status.js';
import { createProfileService } from '../../profiles/service.js';
import type { MenuSnapshot } from './model.js';

const EMPTY_PENDING = { total: 0, add: 0, modify: 0, delete: 0 } as const;
const EMPTY_DRIFT = { file: 0, content: 0, topology: 0, missing: 0 } as const;

export async function createMenuSnapshot(context: DeviceContext): Promise<MenuSnapshot> {
  const repository = inspectRepository(context);
  if (!repository.valid || !repository.repositoryPath) {
    const detected = await detectedIdeCount(context);
    const notBound = repository.repositoryPath === null
      && repository.issues.some((issue) => issue.code === 'repository.notBound');
    return {
      repository: notBound
        ? { status: 'unbound' }
        : {
            status: 'blocked',
            ...(repository.repositoryPath ? { path: repository.repositoryPath } : {}),
            message: repository.issues[0]?.message ?? 'Repository inspection failed.',
          },
      pendingDeployment: { ...EMPTY_PENDING },
      drift: { ...EMPTY_DRIFT },
      missingVariableCount: 0,
      actionableIssueCount: repository.issues.filter((issue) => issue.severity !== 'notice').length,
      ides: { enabled: 0, detected },
      lastOperation: null,
      profiles: [],
    };
  }

  try {
    const [status, inventory] = await Promise.all([
      inspectStatus(context),
      Promise.resolve(createProfileService(repository.repositoryPath).inspect()),
    ]);
    const fileDrift = Math.max(
      0,
      status.postDeployLocalState.drift
        - status.postDeployLocalState.contentDrift
        - status.postDeployLocalState.topologyDrift,
    );
    return {
      repository: {
        status: 'valid',
        path: status.repository.path,
        id: status.repository.id,
        schemaVersion: status.repository.schemaVersion,
      },
      pendingDeployment: {
        total: status.pendingDeployment.total,
        add: status.pendingDeployment.add,
        modify: status.pendingDeployment.modify,
        delete: status.pendingDeployment.delete,
      },
      drift: {
        file: fileDrift,
        content: status.postDeployLocalState.contentDrift,
        topology: status.postDeployLocalState.topologyDrift,
        missing: status.postDeployLocalState.missing,
      },
      missingVariableCount: status.environment.missingVariables.length,
      actionableIssueCount: status.issues.filter((issue) => issue.severity !== 'notice').length,
      ides: {
        enabled: status.environment.ideSupport.filter((ide) => ide.enabled).length,
        detected: status.environment.ideSupport.filter((ide) => ide.detected).length,
      },
      lastOperation: status.lastOperation ?? null,
      profiles: Object.entries(inventory.profiles).map(([id, profile]) => ({
        id,
        ...(profile.title ? { title: profile.title } : {}),
        assetCount: profile.assets.length,
      })),
    };
  } catch (error) {
    return {
      repository: {
        status: 'blocked',
        path: repository.repositoryPath,
        message: error instanceof Error ? error.message : String(error),
      },
      pendingDeployment: { ...EMPTY_PENDING },
      drift: { ...EMPTY_DRIFT },
      missingVariableCount: 0,
      actionableIssueCount: 1,
      ides: { enabled: 0, detected: 0 },
      lastOperation: null,
      profiles: [],
    };
  }
}

async function detectedIdeCount(context: DeviceContext): Promise<number> {
  try {
    const environment = await inspectEnvironment(context);
    return environment.environments.filter((ide) => ide.detected).length;
  } catch {
    return 0;
  }
}
