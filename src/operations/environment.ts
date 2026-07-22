import * as fs from 'fs';
import * as path from 'path';
import { createAdapterDefinitions, type TargetId } from '../adapters';
import type {
  DetectedConfigDirectory,
  DetectedConfigFile,
  DeviceContext,
} from '../adapters/types';
import {
  OPERATION_SCHEMA_VERSION,
  type Report,
} from './contracts';
import { readManifest, type McvManifest } from '../utils/repository';

export type EnvironmentId = 'codex' | 'claude-code' | 'gemini';

export interface EnvironmentDetails {
  id: EnvironmentId;
  name: string;
  detected: boolean;
  configDirectories: DetectedConfigDirectory[];
  configFiles: DetectedConfigFile[];
}

export type EnvironmentReport = Report<never> & {
  operation: 'discover';
  repositoryPath: string | null;
  changes: [];
  environments: EnvironmentDetails[];
  missingVariables: string[];
};

export async function inspectEnvironment(
  context: DeviceContext,
  repositoryPath: string | null = null,
): Promise<EnvironmentReport> {
  const environments = await Promise.all(
    createAdapterDefinitions().map(async ({ targetId, adapter }) => {
      const [ide, configFiles] = await Promise.all([
        adapter.detect(context),
        adapter.discoverFiles(context),
      ]);
      return {
        id: environmentId(targetId),
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
    repositoryPath,
    changes: [],
    environments,
    missingVariables: repositoryPath
      ? findMissingVariables(repositoryPath, readManifest(repositoryPath), context)
      : [],
    issues: [],
    nextActions: [],
  };
}

function environmentId(targetId: TargetId): EnvironmentId {
  switch (targetId) {
    case 'codex': return 'codex';
    case 'claudeCode': return 'claude-code';
    case 'gemini': return 'gemini';
  }
}

function findMissingVariables(
  repositoryPath: string,
  manifest: McvManifest,
  context: DeviceContext,
): string[] {
  const missing = new Set<string>();
  const availablePortable = new Set([
    'HOME',
    'MCV_REPO',
    ...Object.keys(context.variables ?? {}),
    ...availableManifestVariableNames(manifest.variables, context.platform),
  ]);
  visitRepositoryTextFiles(repositoryPath, (content) => {
    for (const match of content.matchAll(/\$\{env:([A-Z][A-Z0-9_]*)\}/g)) {
      if (!context.env[match[1]]) missing.add(match[1]);
    }
    for (const match of content.matchAll(/\$\{([A-Z][A-Z0-9_]*)\}/g)) {
      if (!availablePortable.has(match[1])) missing.add(match[1]);
    }
  });
  return [...missing].sort();
}

function availableManifestVariableNames(
  variables: Record<string, unknown>,
  platform: NodeJS.Platform,
): string[] {
  const platformKey = platform === 'win32' ? 'windows' : platform === 'darwin' ? 'macos' : 'linux';
  return Object.entries(variables).flatMap(([name, declaration]) => {
    if (typeof declaration === 'string') return [name];
    if (declaration && typeof declaration === 'object') {
      const platformValue = (declaration as Record<string, unknown>)[platformKey];
      if (typeof platformValue === 'string') return [name];
    }
    return [];
  });
}

function visitRepositoryTextFiles(
  directory: string,
  visit: (content: string) => void,
): void {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === 'node_modules') continue;
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) visitRepositoryTextFiles(entryPath, visit);
    else if (entry.isFile() && /\.(?:json|ya?ml|toml|md)$/i.test(entry.name)) {
      visit(fs.readFileSync(entryPath, 'utf8'));
    }
  }
}
