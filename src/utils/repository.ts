import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'yaml';
import { readState } from './state';
import { isRecord } from './objects';
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
