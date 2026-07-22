import { createAdapterDefinitions } from '../adapters';
import type {
  DetectedConfigDirectory,
  DetectedConfigFile,
  DeviceContext,
} from '../adapters/types';
import {
  OPERATION_SCHEMA_VERSION,
  type Report,
} from './contracts';

export interface EnvironmentDetails {
  id: string;
  name: string;
  detected: boolean;
  configDirectories: DetectedConfigDirectory[];
  configFiles: DetectedConfigFile[];
}

export type EnvironmentReport = Report<never> & {
  operation: 'discover';
  repositoryPath: null;
  changes: [];
  environments: EnvironmentDetails[];
};

export async function inspectEnvironment(
  context: DeviceContext,
): Promise<EnvironmentReport> {
  const environments = await Promise.all(
    createAdapterDefinitions().map(async ({ adapter }) => {
      const [ide, configFiles] = await Promise.all([
        adapter.detect(context),
        adapter.discoverFiles(context),
      ]);
      return {
        id: ide.id,
        name: ide.name,
        detected: ide.detected,
        configDirectories: ide.configDirectories,
        configFiles,
      };
    }),
  );

  return {
    schemaVersion: OPERATION_SCHEMA_VERSION,
    operation: 'discover',
    status: 'reported',
    ready: true,
    repositoryPath: null,
    changes: [],
    environments,
    issues: [],
    nextActions: [],
  };
}
