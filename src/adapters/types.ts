export interface DeviceContext {
  homeDir: string;
  platform?: NodeJS.Platform;
  pathEnv?: string;
  pathExt?: string;
  variables?: Record<string, string>;
}

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
  readCanonical(
    repositoryPath: string,
    context: DeviceContext,
  ): Promise<CanonicalDeploySource>;
  readDeployTarget(targetPath: string): DeployFile | undefined;
  deploy(repositoryPath: string, context: DeviceContext): Promise<DeployOperation>;
}

export interface CanonicalTransformer {
  transform(
    capture: NativeCaptureResult,
    context: DeviceContext,
  ): CaptureResult;
  deploy(source: CanonicalDeploySource, context: DeviceContext): Promise<DeployFile[]>;
}

export interface CanonicalDeploySource {
  rules?: string;
  skills: Array<{ relativePath: string; content: Buffer }>;
  mcp?: unknown;
}

export interface IdeAdapter {
  detect(context: DeviceContext): Promise<DetectedIde>;
  discoverFiles(context: DeviceContext): Promise<DetectedConfigFile[]>;
  capture(
    files: DetectedConfigFile[],
    context: DeviceContext,
  ): Promise<CaptureResult>;
  deploy(repositoryPath: string, context: DeviceContext): Promise<DeployOperation>;
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
  content: string;
  ownership: 'managed' | 'native';
}

export interface CaptureSummary {
  fileCount: number;
  sensitiveFieldCount: number;
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

export interface CapturedManagedField {
  sourcePath: string;
  path: string;
  value: unknown;
}

export interface NativeCaptureResult extends CaptureResult {
  managedFiles: CapturedManagedFile[];
  managedFields: CapturedManagedField[];
}
