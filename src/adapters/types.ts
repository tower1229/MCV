import type { DeployRequest } from '../assets/deploy-request.js';
import type { SelectedRepositoryView } from '../assets/selected-repository-view.js';

export interface DeviceContext {
  homeDir: string;
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
  pathEnv?: string;
  pathExt?: string;
  variables?: Record<string, string>;
}

export type IdeId = 'codex' | 'claude-code' | 'gemini';
export type SkillSurfaceId = 'codex' | 'claude-code' | 'gemini-cli' | 'antigravity';

export interface DetectedIde {
  id: string;
  name: string;
  detected: boolean;
  configDirectories: DetectedConfigDirectory[];
}

export interface DetectedConfigDirectory {
  id: string;
  path: string;
  exists: boolean;
}

export interface DetectedConfigFile {
  id: string;
  path: string;
  exists: boolean;
}

export interface NativeFileHandler {
  discoverDirectories(context: DeviceContext): DetectedConfigDirectory[];
  discoverFiles(context: DeviceContext): Promise<DetectedConfigFile[]>;
  capture(
    files: DetectedConfigFile[],
    context: DeviceContext,
  ): Promise<NativeCaptureResult>;
  readDeployTarget(targetPath: string): DeployFile | undefined;
  deploy(repositoryPath: string, context: DeviceContext): Promise<DeployOperation>;
}

export interface ManagedTransformer {
  transform(
    capture: NativeCaptureResult,
    context: DeviceContext,
  ): CaptureResult;
  deploy(source: ManagedDeploySource, context: DeviceContext): Promise<DeployFile[]>;
}

export interface ManagedDeploySource {
  instructions?: { id: `instruction:${IdeId}`; content: string };
  skills: Array<{ relativePath: string; content: Buffer }>;
  mcp?: unknown;
  mcpOverrides?: Record<string, Record<string, unknown>>;
}

export interface IdeAdapter {
  readonly skillSurfaces: readonly SkillDeploymentSurface[];
  detect(context: DeviceContext): Promise<DetectedIde>;
  discoverFiles(context: DeviceContext): Promise<DetectedConfigFile[]>;
  capture(
    files: DetectedConfigFile[],
    context: DeviceContext,
  ): Promise<CaptureResult>;
  /**
   * Project selected Canonical/Native content for a DeployRequest.
   * Profile semantics never enter Adapters — only the selected view and request.
   * Project scope projects IDE Instructions as Managed Blocks here; Skills and MCP
   * key-level writers are planned in Deploy operations.
   */
  project(
    source: SelectedRepositoryView,
    request: DeployRequest,
    context: DeviceContext,
  ): Promise<DeployOperation>;
}

export interface SkillDeploymentSurface {
  id: SkillSurfaceId;
  destinationRoot(context: DeviceContext): string;
  supportsManagedDirectoryLinks(platform: NodeJS.Platform): boolean;
}

export interface DeployFile {
  targetPath: string;
  content: string | Buffer;
}

export interface DeployOperation {
  files: DeployFile[];
  write(file: DeployFile): void;
}

export interface CaptureFile {
  sourcePath: string;
  repositoryPath: string;
  content: string | Buffer;
  ownership: 'managed' | 'native';
  captureMerge?: 'preserve-object-fields' | 'replace-entire-file';
  localPaths?: string[];
}

export interface CaptureSummary {
  fileCount: number;
  parameterizedPathCount: number;
  excludedFileCount: number;
}

export interface CaptureResult {
  files: CaptureFile[];
  summary: CaptureSummary;
  warnings: string[];
}

export interface CapturedManagedFile {
  id: string;
  sourcePath: string;
  content: string;
}

export type ConfigurationCapability = 'instructions' | 'skills' | 'mcp' | 'native';
export type ConfigurationOwnership = 'generated' | 'native' | 'merged' | 'local';
export type ChangeKind = 'add' | 'modify' | 'delete' | 'conflict' | 'skip';

export interface ConfigurationItem {
  id: string;
  ide: string;
  surface: string;
  capability: ConfigurationCapability;
  ownership: ConfigurationOwnership;
  sourcePath: string;
  repositoryPath: string;
  content: string | Buffer;
  hash: string;
  warnings: string[];
}

export interface PlannedChange extends ConfigurationItem {
  change: ChangeKind;
  defaultSelected: boolean;
  reason?: string;
}

export interface ChangePlan {
  changes: PlannedChange[];
  warnings: string[];
}

export interface CapturedManagedField {
  sourcePath: string;
  path: string;
  value: unknown;
}

export interface NativeCaptureResult extends CaptureResult {
  managedFiles: CapturedManagedFile[];
  managedFields: CapturedManagedField[];
}
