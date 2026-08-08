import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import type { IdeId } from '../adapters/types.js';
import { isRecord } from '../utils/objects.js';
import {
  parseStructuredObject,
  stringifyStructuredObject,
  type StructuredFormat,
} from '../utils/structured-config.js';
import { managedReceiptKey } from './managed-block.js';
import type { ManagedReceipt } from './managed-receipt.js';
import { assertPathContainedInProjectRoot } from './project-target.js';

export type ProjectMcpTargetId = 'codex' | 'claude-code' | 'gemini-cli';

export type ProjectMcpServerStatus =
  | 'absent'
  | 'identical'
  | 'update'
  | 'conflict';

export interface ProjectMcpDestinationTargets {
  codex: boolean;
  claudeCode: boolean;
  geminiCli: boolean;
}

export interface ProjectMcpTarget {
  id: ProjectMcpTargetId;
  ide: IdeId;
  relativePath: string;
  serversKey: 'mcp_servers' | 'mcpServers';
  format: StructuredFormat;
  surface: 'codex' | 'claude-code' | 'gemini-cli';
}

export interface ProjectMcpServerInput {
  assetId: string;
  name: string;
  desired: Record<string, unknown>;
}

export interface ProjectMcpServerProjection {
  target: ProjectMcpTarget;
  targetPath: string;
  serverName: string;
  assetId: string;
  receiptKey: string;
  serverHash: string;
  status: ProjectMcpServerStatus;
  desired: Record<string, unknown>;
}

const PROJECT_MCP_TARGETS: readonly ProjectMcpTarget[] = [
  {
    id: 'codex',
    ide: 'codex',
    relativePath: '.codex/config.toml',
    serversKey: 'mcp_servers',
    format: 'toml',
    surface: 'codex',
  },
  {
    id: 'claude-code',
    ide: 'claude-code',
    relativePath: '.mcp.json',
    serversKey: 'mcpServers',
    format: 'json',
    surface: 'claude-code',
  },
  {
    id: 'gemini-cli',
    ide: 'gemini',
    relativePath: '.gemini/settings.json',
    serversKey: 'mcpServers',
    format: 'json',
    surface: 'gemini-cli',
  },
];

export function projectMcpDestinationTargets(
  targets: ProjectMcpDestinationTargets,
): ProjectMcpTarget[] {
  return PROJECT_MCP_TARGETS.filter((target) => {
    if (target.id === 'codex') return targets.codex;
    if (target.id === 'claude-code') return targets.claudeCode;
    return targets.geminiCli;
  });
}

export function hashProjectMcpServerValue(value: unknown): string {
  return createHash('sha256').update(stableValue(value), 'utf8').digest('hex');
}

export function projectMcpServer(
  targetRoot: string,
  target: ProjectMcpTarget,
  server: ProjectMcpServerInput,
  receipt: ManagedReceipt | undefined,
): ProjectMcpServerProjection {
  const targetPath = path.join(targetRoot, ...target.relativePath.split('/'));
  assertPathContainedInProjectRoot(targetRoot, targetPath);

  const serverHash = hashProjectMcpServerValue(server.desired);
  const receiptKey = managedReceiptKey(target.relativePath, server.assetId);
  const base = {
    target,
    targetPath,
    serverName: server.name,
    assetId: server.assetId,
    receiptKey,
    serverHash,
    desired: server.desired,
  };

  if (!fs.existsSync(targetPath)) {
    return { ...base, status: 'absent' };
  }

  let document: Record<string, unknown>;
  try {
    document = parseStructuredObject(fs.readFileSync(targetPath, 'utf8'), target.format, targetPath);
  } catch {
    return { ...base, status: 'conflict' };
  }

  const servers = isRecord(document[target.serversKey])
    ? document[target.serversKey] as Record<string, unknown>
    : undefined;
  if (!servers || !(server.name in servers)) {
    return { ...base, status: 'absent' };
  }

  const localValue = servers[server.name];
  const localHash = hashProjectMcpServerValue(localValue);
  if (localHash === serverHash) {
    return { ...base, status: 'identical' };
  }

  const recorded = receipt?.managed[receiptKey];
  if (recorded !== undefined
    && recorded.assetId === server.assetId
    && recorded.hash === localHash) {
    return { ...base, status: 'update' };
  }

  return { ...base, status: 'conflict' };
}

/** Merge selected server keys into an existing project MCP config file. Non-selected keys stay. */
export function overlayProjectMcpFile(
  existingContent: string | undefined,
  target: ProjectMcpTarget,
  serversToWrite: Record<string, Record<string, unknown>>,
): string {
  const document = existingContent && existingContent.length > 0
    ? parseStructuredObject(existingContent, target.format, target.relativePath)
    : {};
  const currentServers = isRecord(document[target.serversKey])
    ? { ...(document[target.serversKey] as Record<string, unknown>) }
    : {};
  for (const [name, value] of Object.entries(serversToWrite)) {
    currentServers[name] = value;
  }
  return stringifyStructuredObject({
    ...document,
    [target.serversKey]: currentServers,
  }, target.format);
}

function stableValue(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableValue).join(',')}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${stableValue(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
