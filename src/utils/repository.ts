import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'yaml';
import { atomicWriteTextFile } from './files';
import { getStateFilePath, readState, writeState } from './state';
import { isRecord } from './objects';
import { normalizeMcpServers } from '../core/mcp';
import Ajv2020, { type ValidateFunction } from 'ajv/dist/2020';
import type { DeviceContext } from '../adapters/types';

export const CURRENT_SCHEMA_VERSION = 2;
let manifestValidator: ValidateFunction | undefined;

export interface McvManifest {
  schemaVersion: 2;
  repositoryId: string;
  initializedAt: string;
  targets: {
    codex: { enabled: boolean };
    claudeCode: { enabled: boolean };
    gemini: {
      enabled: boolean;
      surfaces: { geminiCli: 'auto' | boolean; antigravity: 'auto' | boolean };
    };
  };
  variables: Record<string, unknown>;
  security: { scanSecrets: true; allowPlaintextSecrets: false };
  capture: { preserveUnknownNativeFields: boolean };
  deploy: { backupBeforeWrite: true; useSymlinks: false };
}

export function readManifest(repositoryPath: string): McvManifest {
  const manifestPath = path.join(repositoryPath, 'mcv.yaml');
  const raw = yaml.parse(fs.readFileSync(manifestPath, 'utf8')) as unknown;
  if (!isRecord(raw)) throw new Error(`${manifestPath} must contain a YAML object.`);
  if (raw.schemaVersion !== CURRENT_SCHEMA_VERSION) {
    throw new Error(`Repository schema ${String(raw.schemaVersion)} requires migration; run \`mcv migrate\`.`);
  }
  validateManifest(raw, manifestPath);
  return raw as unknown as McvManifest;
}

export function validateManifest(raw: Record<string, unknown>, source = 'mcv.yaml'): void {
  manifestValidator ??= createManifestValidator();
  if (!manifestValidator(raw)) {
    const details = manifestValidator.errors?.map((error) => `${error.instancePath || '/'} ${error.message ?? 'is invalid'}`).join('; ');
    throw new Error(`${source}: schema validation failed: ${details}`);
  }
}

function createManifestValidator(): ValidateFunction {
  const schemaPath = path.resolve(__dirname, '../../schemas/mcv.schema.json');
  const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8')) as object;
  return new Ajv2020({ allErrors: true, useDefaults: true, strict: true }).compile(schema);
}

export function resolveBoundRepository(context: DeviceContext, explicitPath?: string): string {
  const state = readState(context);
  const current = process.cwd();
  const candidate = explicitPath
    ? path.resolve(explicitPath)
    : state.repositoryPath
      ?? (fs.existsSync(path.join(current, 'mcv.yaml')) ? current : undefined);
  if (!candidate || !fs.existsSync(path.join(candidate, 'mcv.yaml'))) {
    throw new Error('No bound MCV repository found. Run `mcv bind <path>` or `mcv init`.');
  }
  const parsed = yaml.parse(fs.readFileSync(path.join(candidate, 'mcv.yaml'), 'utf8')) as unknown;
  if (!isRecord(parsed) || typeof parsed.repositoryId !== 'string') {
    throw new Error(`${candidate} is not a valid MCV repository.`);
  }
  if (!explicitPath && state.defaultRepositoryId && state.defaultRepositoryId !== parsed.repositoryId) {
    throw new Error('Bound repository ID does not match local state. Run `mcv bind <path>` again.');
  }
  return candidate;
}

export function bindRepository(context: DeviceContext, repositoryPath: string): void {
  const resolved = path.resolve(repositoryPath);
  const manifest = migrateRepository(context, resolved, false);
  const state = readState(context);
  state.schemaVersion = 2;
  state.repositoryPath = resolved;
  state.defaultRepositoryId = manifest.repositoryId;
  writeState(context, state);
}

export function unbindRepository(context: DeviceContext): void {
  const state = readState(context);
  delete state.repositoryPath;
  delete state.defaultRepositoryId;
  delete state.baselineSnapshot;
  writeState(context, state);
}

export function migrateRepository(context: DeviceContext, repositoryPath: string, dryRun: boolean): McvManifest {
  const manifestPath = path.join(repositoryPath, 'mcv.yaml');
  if (!fs.existsSync(manifestPath)) throw new Error(`${repositoryPath} does not contain mcv.yaml.`);
  const raw = yaml.parse(fs.readFileSync(manifestPath, 'utf8')) as unknown;
  if (!isRecord(raw)) throw new Error(`${manifestPath} must contain a YAML object.`);
  if (raw.schemaVersion === 2) {
    validateManifest(raw, manifestPath);
    return raw as unknown as McvManifest;
  }
  if (raw.schemaVersion !== 1) throw new Error(`Unsupported repository schema ${String(raw.schemaVersion)}.`);
  const targets = isRecord(raw.targets) ? raw.targets : {};
  const gemini = isRecord(targets.gemini) ? targets.gemini : {};
  const migrated = {
    ...raw,
    schemaVersion: 2,
    repositoryId: String(raw.repositoryId),
    initializedAt: typeof raw.initializedAt === 'string' ? raw.initializedAt : new Date().toISOString(),
    targets: {
      ...targets,
      codex: { ...(isRecord(targets.codex) ? targets.codex : {}), enabled: isRecord(targets.codex) ? targets.codex.enabled !== false : true },
      claudeCode: { ...(isRecord(targets.claudeCode) ? targets.claudeCode : {}), enabled: isRecord(targets.claudeCode) ? targets.claudeCode.enabled !== false : true },
      gemini: {
        ...gemini,
        enabled: gemini.enabled !== false,
        surfaces: { geminiCli: 'auto', antigravity: 'auto' },
      },
    },
    variables: isRecord(raw.variables) ? raw.variables : {},
    security: { scanSecrets: true, allowPlaintextSecrets: false },
    capture: {
      preserveUnknownNativeFields: !isRecord(raw.capture) || raw.capture.preserveUnknownNativeFields !== false,
    },
    deploy: { backupBeforeWrite: true, useSymlinks: false },
  } as unknown as McvManifest;
  delete (migrated as unknown as Record<string, unknown>).includeRuntimeState;
  delete (migrated as unknown as Record<string, unknown>).allowPlaintextSecrets;
  if (dryRun) return migrated;
  const backupRoot = path.join(path.dirname(getStateFilePath(context)), 'repository-backups');
  fs.mkdirSync(backupRoot, { recursive: true });
  const backupDirectory = fs.mkdtempSync(path.join(backupRoot, 'schema-v1-'));
  const backupPath = path.join(backupDirectory, 'repository');
  fs.cpSync(repositoryPath, backupPath, { recursive: true });
  try {
    migrateGeminiNativeLayout(repositoryPath);
    migrateMcpRegistry(repositoryPath);
    atomicWriteTextFile(manifestPath, yaml.stringify(migrated));
  } catch (error) {
    fs.cpSync(backupPath, repositoryPath, { recursive: true, force: true });
    throw error;
  }
  return migrated;
}

function migrateGeminiNativeLayout(repositoryPath: string): void {
  const nativeRoot = path.join(repositoryPath, 'ide', 'gemini', 'native');
  const mappings = [
    ['settings.json', path.join('gemini-cli', 'settings.json')],
    ['config.json', path.join('antigravity', 'config.json')],
    ['mcp_config.json', path.join('antigravity', 'mcp_config.json')],
  ];
  for (const [legacy, current] of mappings) {
    const source = path.join(nativeRoot, legacy);
    const destination = path.join(nativeRoot, current);
    if (!fs.existsSync(source) || fs.existsSync(destination)) continue;
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.renameSync(source, destination);
  }
}

function migrateMcpRegistry(repositoryPath: string): void {
  const registryPath = path.join(repositoryPath, 'common', 'mcp.yaml');
  if (!fs.existsSync(registryPath)) return;
  const registry = yaml.parse(fs.readFileSync(registryPath, 'utf8')) as unknown;
  if (!isRecord(registry) || !isRecord(registry.servers)) return;
  const normalized = normalizeMcpServers(registry.servers, 'codex');
  atomicWriteTextFile(registryPath, yaml.stringify({ ...registry, servers: normalized.servers }));
}
