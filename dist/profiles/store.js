import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'yaml';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { atomicWriteTextFile } from '../utils/files.js';
import { isRecord } from '../utils/objects.js';
import { GLOBAL_PROFILE_ID, PROFILES_SCHEMA_VERSION, PROFILE_ID_PATTERN, } from './contracts.js';
let profilesValidator;
export function profilesPath(repositoryPath) {
    return path.join(repositoryPath, 'profiles.yaml');
}
export function emptyProfilesDocument() {
    return {
        schemaVersion: PROFILES_SCHEMA_VERSION,
        profiles: {
            [GLOBAL_PROFILE_ID]: { assets: [] },
        },
    };
}
export function readProfilesDocument(repositoryPath) {
    const filePath = profilesPath(repositoryPath);
    if (!fs.existsSync(filePath)) {
        throw new Error(`${filePath} is missing; run \`mcv migrate\` or recreate the Repository.`);
    }
    const raw = yaml.parse(fs.readFileSync(filePath, 'utf8'));
    if (!isRecord(raw))
        throw new Error(`${filePath} must contain a YAML object.`);
    validateProfilesDocument(raw, filePath);
    return normalizeProfilesDocument(raw);
}
export function writeProfilesDocument(repositoryPath, document) {
    const normalized = normalizeProfilesDocument(document);
    validateProfilesDocument(structuredClone(normalized), profilesPath(repositoryPath));
    const content = serializeProfilesDocument(normalized);
    atomicWriteTextFile(profilesPath(repositoryPath), content);
    return computeProfilesRevision(normalized);
}
export function normalizeProfilesDocument(document) {
    if (!isRecord(document.profiles) || !(GLOBAL_PROFILE_ID in document.profiles)) {
        throw new Error('profiles.yaml must contain the built-in global Profile.');
    }
    const profiles = {};
    const orderedIds = [
        GLOBAL_PROFILE_ID,
        ...Object.keys(document.profiles)
            .filter((id) => id !== GLOBAL_PROFILE_ID)
            .sort((left, right) => left.localeCompare(right)),
    ];
    for (const id of orderedIds) {
        if (!PROFILE_ID_PATTERN.test(id) || id.length > 64) {
            throw new Error(`Invalid Profile ID: ${id}`);
        }
        const profile = document.profiles[id];
        if (!profile)
            continue;
        profiles[id] = normalizeProfile(profile);
    }
    return {
        schemaVersion: PROFILES_SCHEMA_VERSION,
        profiles,
    };
}
export function serializeProfilesDocument(document) {
    const normalized = normalizeProfilesDocument(document);
    const profiles = {};
    for (const id of Object.keys(normalized.profiles)) {
        profiles[id] = normalized.profiles[id];
    }
    return yaml.stringify({
        schemaVersion: PROFILES_SCHEMA_VERSION,
        profiles,
    }, { sortMapEntries: false });
}
export function computeProfilesRevision(document) {
    return createHash('sha256')
        .update(serializeProfilesDocument(document))
        .digest('hex');
}
export function validateProfilesDocument(raw, source = 'profiles.yaml') {
    profilesValidator ??= createProfilesValidator();
    if (!profilesValidator(raw)) {
        const details = profilesValidator.errors
            ?.map((error) => `${error.instancePath || '/'} ${error.message ?? 'is invalid'}`)
            .join('; ');
        throw new Error(`${source}: schema validation failed: ${details}`);
    }
    if (!isRecord(raw.profiles) || !(GLOBAL_PROFILE_ID in raw.profiles)) {
        throw new Error(`${source}: the built-in global Profile is required.`);
    }
    for (const id of Object.keys(raw.profiles)) {
        if (!PROFILE_ID_PATTERN.test(id) || id.length > 64) {
            throw new Error(`${source}: invalid Profile ID ${id}`);
        }
    }
}
export function normalizeProfile(profile) {
    const assets = [...new Set(profile.assets)].sort((left, right) => left.localeCompare(right));
    const normalized = { assets };
    if (typeof profile.title === 'string')
        normalized.title = profile.title;
    if (typeof profile.description === 'string')
        normalized.description = profile.description;
    return normalized;
}
function createProfilesValidator() {
    const schemaPath = new URL('../../schemas/profiles.schema.json', import.meta.url);
    const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
    return new Ajv2020({ allErrors: true, strict: true }).compile(schema);
}
