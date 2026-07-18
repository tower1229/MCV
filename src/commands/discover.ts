import { ClaudeCodeAdapter } from '../adapters/claude-code';
import type { DeviceContext } from '../adapters/types';

export async function discoverConfigurations(context: DeviceContext): Promise<void> {
  const adapter = new ClaudeCodeAdapter();
  const [ide, files] = await Promise.all([
    adapter.detect(context),
    adapter.discoverFiles(context),
  ]);

  console.log(`${ide.name}: ${ide.detected ? 'detected' : 'not detected'}`);
  for (const configPath of [...ide.configDirectories, ...files]) {
    console.log(`[${configPath.exists ? 'found' : 'missing'}] ${configPath.path}`);
  }
}
