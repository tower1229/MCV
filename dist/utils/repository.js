import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'yaml';
import { readState } from './state.js';
import { isRecord } from './objects.js';
import { Ajv2020 } from 'ajv/dist/2020.js';
export const CURRENT_SCHEMA_VERSION = 2;
let manifestValidator;
export function readManifest(repositoryPath) {
    const manifestPath = path.join(repositoryPath, 'mcv.yaml');
    const raw = yaml.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (!isRecord(raw))
        throw new Error(`${manifestPath} must contain a YAML object.`);
    if (raw.schemaVersion !== CURRENT_SCHEMA_VERSION) {
        throw new Error(`Repository schema ${String(raw.schemaVersion)} requires migration; run \`mcv migrate\`.`);
    }
    validateManifest(raw, manifestPath);
    return raw;
}
export function validateManifest(raw, source = 'mcv.yaml') {
    manifestValidator ??= createManifestValidator();
    if (!manifestValidator(raw)) {
        const details = manifestValidator.errors?.map((error) => `${error.instancePath || '/'} ${error.message ?? 'is invalid'}`).join('; ');
        throw new Error(`${source}: schema validation failed: ${details}`);
    }
}
function createManifestValidator() {
    const schemaPath = new URL('../../schemas/mcv.schema.json', import.meta.url);
    const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
    return new Ajv2020({ allErrors: true, useDefaults: true, strict: true }).compile(schema);
}
export function resolveBoundRepository(context, explicitPath) {
    const state = readState(context);
    const current = process.cwd();
    const candidate = explicitPath
        ? path.resolve(explicitPath)
        : state.repositoryPath
            ?? (fs.existsSync(path.join(current, 'mcv.yaml')) ? current : undefined);
    if (!candidate || !fs.existsSync(path.join(candidate, 'mcv.yaml'))) {
        throw new Error('No bound MCV repository found. Run `mcv bind <path>` or `mcv init`.');
    }
    const parsed = yaml.parse(fs.readFileSync(path.join(candidate, 'mcv.yaml'), 'utf8'));
    if (!isRecord(parsed) || typeof parsed.repositoryId !== 'string') {
        throw new Error(`${candidate} is not a valid MCV repository.`);
    }
    if (!explicitPath && state.defaultRepositoryId && state.defaultRepositoryId !== parsed.repositoryId) {
        throw new Error('Bound repository ID does not match local state. Run `mcv bind <path>` again.');
    }
    return candidate;
}
