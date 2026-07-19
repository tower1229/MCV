import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { createAdapterDefinitions } from '../adapters';
import type { DeviceContext } from '../adapters/types';
import { hashFile } from '../utils/files';
import { readManifest } from '../utils/repository';
import { readState } from '../utils/state';

export async function showStatus(context?: DeviceContext): Promise<void> {
  const state = readState();
  if (state.repositoryPath) {
    console.log(`[bound] ${state.repositoryPath} (${state.defaultRepositoryId ?? 'unknown repository ID'})`);
    if (!fs.existsSync(path.join(state.repositoryPath, 'mcv.yaml'))) {
      console.log('[repository-missing] Bound repository cannot be read.');
    } else {
      reportGit(state.repositoryPath);
      if (context) await reportSurfaces(state.repositoryPath, context);
      reportMissingEnvironment(state.repositoryPath, context?.env ?? process.env);
    }
  }

  const baseline = state.baselineSnapshot;
  if (!baseline || Object.keys(baseline.files).length === 0) {
    console.log('No deployment baseline found. Run `mcv deploy` first.');
  } else {
    for (const [filePath, expectedHash] of Object.entries(baseline.files)) {
      if (!fs.existsSync(filePath)) console.log(`[missing] ${filePath}`);
      else console.log(`[${hashFile(filePath) === expectedHash ? 'matching' : 'drifted'}] ${filePath}`);
    }
  }
  if (state.lastOperation) console.log(`[last-${state.lastOperation.success ? 'success' : 'failure'}] ${state.lastOperation.kind} ${state.lastOperation.time}`);
}

function reportGit(repositoryPath: string): void {
  try {
    const output = execFileSync('git', ['status', '--porcelain'], { cwd: repositoryPath, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    console.log(`[git-${output.trim() ? 'dirty' : 'clean'}] ${repositoryPath}`);
  } catch { console.log(`[git-unavailable] ${repositoryPath}`); }
}

async function reportSurfaces(repositoryPath: string, context: DeviceContext): Promise<void> {
  const manifest = readManifest(repositoryPath);
  for (const definition of createAdapterDefinitions()) {
    if (manifest.targets[definition.targetId]?.enabled !== true) continue;
    const detected = await definition.adapter.detect(context);
    console.log(`[${detected.detected ? 'detected' : 'not-detected'}] ${definition.name}`);
    if (definition.targetId === 'gemini') {
      for (const directory of detected.configDirectories) console.log(`[surface-${directory.exists ? 'present' : 'absent'}] gemini/${directory.id}`);
    }
  }
}

function reportMissingEnvironment(repositoryPath: string, env: NodeJS.ProcessEnv): void {
  const missing = new Set<string>();
  const walk = (directory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === '.git' || entry.name === 'node_modules') continue;
      const current = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(current);
      else if (entry.isFile() && /\.(?:json|ya?ml|toml|md)$/i.test(entry.name)) {
        const content = fs.readFileSync(current, 'utf8');
        for (const match of content.matchAll(/\$\{env:([A-Z][A-Z0-9_]*)\}/g)) if (!env[match[1]]) missing.add(match[1]);
      }
    }
  };
  walk(repositoryPath);
  for (const name of [...missing].sort()) console.log(`[missing-env] ${name}`);
}
