import * as fs from 'fs';
import * as path from 'path';
import type { DeviceContext } from '../adapters/types';
import type { ConfigurationCapability } from '../adapters/types';
import { atomicWriteTextFile } from './files';

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
      return JSON.parse(content) as McvState;
    } catch {
      return {};
    }
  }
  return {};
}

export function writeState(context: DeviceContext, state: McvState): void {
  const statePath = getStateFilePath(context);
  const dir = path.dirname(statePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  atomicWriteTextFile(statePath, JSON.stringify(state, null, 2));
}
