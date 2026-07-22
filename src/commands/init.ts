import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import * as yaml from 'yaml';
import { readState, writeState } from '../utils/state';
import type { McvManifest } from '../utils/repository';
import type { DeviceContext } from '../adapters/types';

export function initRepository(context: DeviceContext, targetDir: string = process.cwd()): boolean {
  const repositoryPath = path.resolve(targetDir);
  const manifestPath = path.join(repositoryPath, 'mcv.yaml');

  if (fs.existsSync(manifestPath)) {
    console.log('An mcv.yaml manifest already exists in this directory.');
    console.log('You might want to run `mcv bind` instead to bind this existing repository to your device.');
    return false;
  }

  const repositoryId = uuidv4();
  const initializedAt = new Date().toISOString();
  const manifest: McvManifest = {
    schemaVersion: 2,
    repositoryId,
    initializedAt,
    targets: {
      codex: { enabled: true },
      claudeCode: { enabled: true },
      gemini: {
        enabled: true,
        surfaces: { geminiCli: 'auto', antigravity: 'auto' },
      },
    },
    variables: {},
    security: {
      scanSecrets: true,
      allowPlaintextSecrets: false,
    },
    capture: {
      preserveUnknownNativeFields: true,
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

  const state = readState(context);
  state.schemaVersion = 2;
  state.deviceId ??= uuidv4();
  state.defaultRepositoryId = repositoryId;
  state.repositoryPath = repositoryPath;
  state.baselineSnapshot = {
    recordedAt: initializedAt,
    files: {},
  };
  writeState(context, state);

  console.log('Successfully bound current device to this MCV repository.');
  return true;
}
