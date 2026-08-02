import * as fs from 'fs';
import * as path from 'path';
import type { DeviceContext } from '../adapters/types.js';
import type { ConfigurationCapability } from '../adapters/types.js';
import type { ManagedSkillLayout } from '../core/managed-skill-layout.js';
import { atomicWriteTextFile } from './files.js';

export interface BaselineSnapshot {
  recordedAt: string;
  files: Record<string, string>;
}

export interface McvState {
  schemaVersion?: 2;
  deviceId?: string;
  defaultRepositoryId?: string;
  repositoryPath?: string;
  baselineSnapshot?: BaselineSnapshot;
  managedInventory?: Record<string, { source: string; hash: string }>;
  managedSkillLayout?: ManagedSkillLayout;
  lastDeploySelection?: Partial<Record<'codex' | 'claude-code' | 'gemini', ConfigurationCapability[]>>;
  lastOperation?: { kind: 'capture' | 'deploy' | 'restore'; time: string; success: boolean };
}

export function getStateFilePath(context: DeviceContext): string {
  if (context.platform === 'win32') {
    return path.join(context.env.APPDATA || path.join(context.homeDir, 'AppData', 'Roaming'), 'mcv', 'config.json');
  }
  if (context.platform === 'darwin') {
    return path.join(context.homeDir, 'Library', 'Application Support', 'mcv', 'config.json');
  }
  return path.join(context.homeDir, '.config', 'mcv', 'config.json');
}

export function readState(context: DeviceContext): McvState {
  const statePath = getStateFilePath(context);
  if (fs.existsSync(statePath)) {
    try {
      const content = fs.readFileSync(statePath, 'utf-8');
      return normalizeLegacyState(JSON.parse(content) as McvState);
    } catch {
      return {};
    }
  }
  return {};
}

function normalizeLegacyState(state: McvState): McvState {
  const projections = state.managedSkillLayout?.projections;
  if (!projections) return state;
  for (const projection of Object.values(projections) as Array<{
    ide: string;
    surface: string;
  }>) {
    if (projection.ide === 'gemini-cli' || projection.ide === 'antigravity') {
      projection.surface = projection.ide;
      projection.ide = 'gemini';
    }
  }
  return state;
}

export function writeState(context: DeviceContext, state: McvState): void {
  const statePath = getStateFilePath(context);
  const dir = path.dirname(statePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  atomicWriteTextFile(statePath, JSON.stringify(state, null, 2));
}

export function recordCaptureSuccess(context: DeviceContext): void {
  const state = readState(context);
  state.lastOperation = {
    kind: 'capture',
    time: new Date().toISOString(),
    success: true,
  };
  writeState(context, state);
}
