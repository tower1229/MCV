import * as fs from 'fs';
import { hashFile } from '../utils/files';
import { readState } from '../utils/state';

export function showStatus(): void {
  const baseline = readState().baselineSnapshot;
  if (!baseline || Object.keys(baseline.files).length === 0) {
    console.log('No deployment baseline found. Run `mcv deploy` first.');
    return;
  }

  for (const [filePath, expectedHash] of Object.entries(baseline.files)) {
    if (!fs.existsSync(filePath)) {
      console.log(`[missing] ${filePath}`);
      continue;
    }

    const currentHash = hashFile(filePath);
    console.log(`[${currentHash === expectedHash ? 'matching' : 'drifted'}] ${filePath}`);
  }
}
