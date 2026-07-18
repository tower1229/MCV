import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import * as yaml from 'yaml';
import { readState, writeState } from '../utils/state';

export interface McvManifest {
  schemaVersion: number;
  repositoryId: string;
  initializedAt: string;
  targets: {
    codex: { enabled: boolean };
    claudeCode: { enabled: boolean };
    gemini: { enabled: boolean };
  };
  variables: Record<string, never>;
  security: {
    scanSecrets: boolean;
    allowPlaintextSecrets: boolean;
  };
  capture: {
    preserveUnknownNativeFields: boolean;
    includeRuntimeState: boolean;
  };
  deploy: {
    backupBeforeWrite: boolean;
    useSymlinks: boolean;
  };
}

export function initRepository(targetDir: string = process.cwd()): void {
  const repositoryPath = path.resolve(targetDir);
  const manifestPath = path.join(repositoryPath, 'mcv.yaml');

  if (fs.existsSync(manifestPath)) {
    console.log('An mcv.yaml manifest already exists in this directory.');
    console.log('You might want to run `mcv bind` instead to bind this existing repository to your device.');
    return;
  }

  const repositoryId = uuidv4();
  const initializedAt = new Date().toISOString();
  const manifest: McvManifest = {
    schemaVersion: 1,
    repositoryId,
    initializedAt,
    targets: {
      codex: { enabled: true },
      claudeCode: { enabled: true },
      gemini: { enabled: true },
    },
    variables: {},
    security: {
      scanSecrets: true,
      allowPlaintextSecrets: false,
    },
    capture: {
      preserveUnknownNativeFields: true,
      includeRuntimeState: false,
    },
    deploy: {
      backupBeforeWrite: true,
      useSymlinks: false,
    },
  };

  const yamlStr = yaml.stringify(manifest);
  fs.writeFileSync(manifestPath, yamlStr, 'utf-8');

  console.log(`Initialized empty MCV repository in ${repositoryPath}`);
  console.log(`Repository ID: ${repositoryId}`);

  const state = readState();
  state.deviceId ??= uuidv4();
  state.defaultRepositoryId = repositoryId;
  state.repositoryPath = repositoryPath;
  state.baselineSnapshot = {
    recordedAt: initializedAt,
    files: {},
  };
  writeState(state);

  console.log('Successfully bound current device to this MCV repository.');
}
