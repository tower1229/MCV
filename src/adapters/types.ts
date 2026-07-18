export interface DeviceContext {
  homeDir: string;
  platform?: NodeJS.Platform;
  pathEnv?: string;
  pathExt?: string;
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
}

export interface IdeAdapter {
  detect(context: DeviceContext): Promise<DetectedIde>;
  discoverFiles(context: DeviceContext): Promise<DetectedConfigFile[]>;
}
