import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import * as yaml from 'yaml';
import { readState, writeState } from '../utils/state';

export interface McvManifest {
  schemaVersion: number;
  repository: {
    id: string;
    initializedAt: string;
  };
}

export function initRepository(targetDir: string = process.cwd()) {
  const manifestPath = path.join(targetDir, 'mcv.yaml');

  if (fs.existsSync(manifestPath)) {
    console.log('An mcv.yaml manifest already exists in this directory.');
    console.log('You might want to run `mcv bind` instead to bind this existing repository to your device.');
    return;
  }

  const repoId = uuidv4();
  const manifest: McvManifest = {
    schemaVersion: 1,
    repository: {
      id: repoId,
      initializedAt: new Date().toISOString()
    }
  };

  const yamlStr = yaml.stringify(manifest);
  fs.writeFileSync(manifestPath, yamlStr, 'utf-8');

  console.log(`Initialized empty MCV repository in ${targetDir}`);
  console.log(`Repository ID: ${repoId}`);

  // Bind the repository to local state
  const state = readState();
  state.defaultRepository = {
    id: repoId,
    path: targetDir
  };
  writeState(state);

  console.log('Successfully bound current device to this MCV repository.');
}
