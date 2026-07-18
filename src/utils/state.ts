import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface RepositoryState {
  id: string;
  path: string;
}

export interface McvState {
  defaultRepository?: RepositoryState;
}

export function getStateFilePath(): string {
  if (process.platform === 'win32') {
    return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'mcv', 'config.json');
  } else if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'mcv', 'config.json');
  } else {
    // Fallback for linux/other
    return path.join(os.homedir(), '.config', 'mcv', 'config.json');
  }
}

export function readState(): McvState {
  const statePath = getStateFilePath();
  if (fs.existsSync(statePath)) {
    try {
      const content = fs.readFileSync(statePath, 'utf-8');
      return JSON.parse(content) as McvState;
    } catch (e) {
      return {};
    }
  }
  return {};
}

export function writeState(state: McvState): void {
  const statePath = getStateFilePath();
  const dir = path.dirname(statePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2), 'utf-8');
}
