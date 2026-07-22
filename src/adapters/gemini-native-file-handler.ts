import * as fs from 'fs';
import * as path from 'path';
import { atomicWriteFile } from '../utils/files';
import { sanitizeConfig } from '../utils/sanitize';
import { parseJsonc, parseStructuredObject, splitOwnedFields, stringifyStructuredObject } from '../utils/structured-config';
import { resolvePortableValue } from '../utils/variables';
import { readCanonicalSource, readDeployTarget, repositoryFileForPlatform } from './adapter-utils';
import { GEMINI_MANAGED_PATHS } from './overlay-policies';
import type { CanonicalDeploySource, DetectedConfigDirectory, DetectedConfigFile, DeployFile, DeployOperation, DeviceContext, NativeCaptureResult, NativeFileHandler } from './types';

const LOCAL_KEYS = new Set([
  '$.installationId', '$.installation_id', '$.recentProjects', '$.windowState', '$.telemetry',
  '$.userEmail', '$.oauth', '$.credentials', '$.terminal.integrated.env.windows',
  '$.claudeCode.environmentVariables', '$.antigravity.auth', '$.antigravity.account',
]);

interface Policy { repositoryPath: string; managed: boolean; }
const POLICIES: Record<string, Policy> = {
  'gemini-cli-settings': { repositoryPath: 'ide/gemini/native/gemini-cli/settings.json', managed: true },
  'antigravity-config': { repositoryPath: 'ide/gemini/native/antigravity/config.json', managed: false },
  'antigravity-mcp': { repositoryPath: 'ide/gemini/native/antigravity/mcp_config.json', managed: true },
  'antigravity-cli-settings': { repositoryPath: 'ide/gemini/native/antigravity/cli-settings.json', managed: false },
  'antigravity-ide-settings': { repositoryPath: 'ide/gemini/native/antigravity/ide-settings.json', managed: false },
  'antigravity-keybindings': { repositoryPath: 'ide/gemini/native/antigravity/keybindings.json', managed: false },
};

export class GeminiNativeFileHandler implements NativeFileHandler {
  discoverDirectories(context: DeviceContext): DetectedConfigDirectory[] {
    const root = path.join(context.homeDir, '.gemini');
    return [
      { id: 'gemini-cli', path: root, exists: this.hasAnyKnownFile(context) },
      { id: 'antigravity', path: path.join(root, 'config'), exists: fs.existsSync(path.join(root, 'config', 'config.json')) || fs.existsSync(path.join(root, 'config', 'mcp_config.json')) },
    ];
  }

  async discoverFiles(context: DeviceContext): Promise<DetectedConfigFile[]> {
    const root = path.join(context.homeDir, '.gemini');
    const antigravityUser = this.antigravityUserDirectory(context);
    const candidates = [
      { id: 'gemini-cli-settings', path: path.join(root, 'settings.json') },
      { id: 'user-instructions', path: path.join(root, 'GEMINI.md') },
      { id: 'antigravity-config', path: path.join(root, 'config', 'config.json') },
      { id: 'antigravity-mcp', path: path.join(root, 'config', 'mcp_config.json') },
      { id: 'antigravity-cli-settings', path: path.join(root, 'antigravity-cli', 'settings.json') },
      { id: 'antigravity-ide-settings', path: path.join(antigravityUser, 'settings.json') },
      { id: 'antigravity-keybindings', path: path.join(antigravityUser, 'keybindings.json') },
    ];
    return candidates.map((file) => ({ ...file, exists: fs.existsSync(file.path) }));
  }

  async capture(files: DetectedConfigFile[], context: DeviceContext): Promise<NativeCaptureResult> {
    const result: NativeCaptureResult = { files: [], managedFiles: [], managedFields: [], summary: { fileCount: 0, sensitiveFieldCount: 0, parameterizedPathCount: 0, excludedFileCount: 0 }, warnings: [] };
    for (const file of files.filter((candidate) => candidate.exists)) {
      if (file.id === 'user-instructions') {
        const sanitized = sanitizeConfig(fs.readFileSync(file.path, 'utf8'), context);
        result.managedFiles.push({ id: file.id, sourcePath: file.path, content: sanitized.value });
        continue;
      }
      const policy = POLICIES[file.id];
      if (!policy) continue;
      try {
        const content = fs.readFileSync(file.path, 'utf8');
        if (file.id === 'antigravity-keybindings') {
          const parsed = parseJsonc(content);
          if (!Array.isArray(parsed)) throw new Error(`${file.path} must contain a JSON array.`);
          const native = sanitizeConfig(parsed, context);
          result.files.push({ sourcePath: file.path, repositoryPath: policy.repositoryPath, content: `${JSON.stringify(native.value, null, 2)}\n`, ownership: 'native' });
          result.summary.sensitiveFieldCount += native.sensitiveFieldCount;
          result.summary.parameterizedPathCount += native.parameterizedPathCount;
          continue;
        }
        const parsed = parseStructuredObject(content, 'json', file.path);
        const flatLocalPaths = file.id === 'antigravity-ide-settings' ? getAntigravityIdeLocalPaths(parsed) : [];
        const filtered = file.id === 'antigravity-ide-settings' ? filterAntigravityIdeLocalFields(parsed) : parsed;
        const owned = splitOwnedFields(filtered, policy.managed ? GEMINI_MANAGED_PATHS : [], [...LOCAL_KEYS]);
        const native = sanitizeConfig(owned.native, context);
        result.summary.sensitiveFieldCount += native.sensitiveFieldCount;
        result.summary.parameterizedPathCount += native.parameterizedPathCount;
        if (Object.keys(native.value).length > 0) result.files.push({ sourcePath: file.path, repositoryPath: policy.repositoryPath, content: stringifyStructuredObject(native.value, 'json'), ownership: 'native', localPaths: [...LOCAL_KEYS, ...flatLocalPaths] });
        for (const field of owned.managed) {
          const sanitized = sanitizeConfig(field.value, context);
          result.managedFields.push({ sourcePath: file.path, path: field.path, value: sanitized.value });
          result.summary.sensitiveFieldCount += sanitized.sensitiveFieldCount;
          result.summary.parameterizedPathCount += sanitized.parameterizedPathCount;
        }
      } catch (error) {
        result.warnings.push(`Skipped ${file.path}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    result.summary.fileCount = result.files.length;
    return result;
  }

  async deploy(repositoryPath: string, context: DeviceContext): Promise<DeployOperation> {
    const nativeRoot = path.join(repositoryPath, 'ide', 'gemini', 'native');
    const root = path.join(context.homeDir, '.gemini');
    const antigravityUser = this.antigravityUserDirectory(context);
    const mappings = [
      ['gemini-cli/settings.json', path.join(root, 'settings.json')],
      ['antigravity/config.json', path.join(root, 'config', 'config.json')],
      ['antigravity/mcp_config.json', path.join(root, 'config', 'mcp_config.json')],
      ['antigravity/cli-settings.json', path.join(root, 'antigravity-cli', 'settings.json')],
      ['antigravity/ide-settings.json', path.join(antigravityUser, 'settings.json')],
      ['antigravity/keybindings.json', path.join(antigravityUser, 'keybindings.json')],
    ] as const;
    const deployed: DeployFile[] = mappings.flatMap(([relative, targetPath]) => {
      let source = repositoryFileForPlatform(repositoryPath, `ide/gemini/native/${relative}`, context);
      if (relative === 'gemini-cli/settings.json' && !fs.existsSync(source)) {
        source = path.join(nativeRoot, 'settings.json');
      }
      if (!fs.existsSync(source)) return [];
      const content = fs.readFileSync(source, 'utf8');
      if (relative === 'antigravity/keybindings.json') {
        const parsed = JSON.parse(content) as unknown;
        const resolved = resolvePortableValue(parsed, context.variables ?? {}, context.platform);
        return [{ targetPath, content: `${JSON.stringify(resolved, null, 2)}\n` }];
      }
      const parsed = parseStructuredObject(content, 'json', source);
      const resolved = resolvePortableValue(parsed, context.variables ?? {}, context.platform) as Record<string, unknown>;
      return [{ targetPath, content: stringifyStructuredObject(resolved, 'json') }];
    });
    return { files: deployed, write: (file) => atomicWriteFile(file.targetPath, file.content) };
  }

  async readCanonical(repositoryPath: string, context: DeviceContext): Promise<CanonicalDeploySource> { return readCanonicalSource(repositoryPath, context); }
  readDeployTarget(targetPath: string): DeployFile | undefined { return readDeployTarget(targetPath); }

  private hasAnyKnownFile(context: DeviceContext): boolean {
    const root = path.join(context.homeDir, '.gemini');
    return ['settings.json', 'GEMINI.md'].some((name) => fs.existsSync(path.join(root, name)))
      || fs.existsSync(path.join(root, 'skills'));
  }

  private antigravityUserDirectory(context: DeviceContext): string {
    const env = context.env;
    if (context.platform === 'win32') return path.join(env.APPDATA || path.join(context.homeDir, 'AppData', 'Roaming'), 'Antigravity', 'User');
    return path.join(context.homeDir, 'Library', 'Application Support', 'Antigravity', 'User');
  }
}

function filterAntigravityIdeLocalFields(value: Record<string, unknown>): Record<string, unknown> {
  const local = new Set(getAntigravityIdeLocalPaths(value).map((entry) => entry.slice(2)));
  return Object.fromEntries(Object.entries(value).filter(([key]) => !local.has(key)));
}

function getAntigravityIdeLocalPaths(value: Record<string, unknown>): string[] {
  const localPattern = /(^window\.|environmentVariables|terminal\.integrated\.env\.|userEmail|LocalStoragePath|machineId|device|recent|workspace|telemetry|auth|credential|token|apiKey|secret|geminicodeassist\.project|remote\.SSH\.remotePlatform)/i;
  return Object.keys(value).filter((key) => localPattern.test(key)).map((key) => `$.${key}`);
}
