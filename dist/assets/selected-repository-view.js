import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'yaml';
import { repositoryFileForPlatform } from '../adapters/adapter-utils.js';
import { isRecord } from '../utils/objects.js';
import { resolvePortableValue } from '../utils/variables.js';
import { IDE_INSTRUCTION_DEFINITIONS } from '../core/ide-instructions.js';
import { DECLARED_NATIVE_UNITS, nativeAssetId } from './native-units.js';
import { parseAssetId } from './ids.js';
/** Adapter/transformer bridge: SelectedRepositoryView → ManagedDeploySource. */
export function toManagedDeploySource(view, target) {
    const source = {
        skills: view.skills.flatMap((skill) => skill.files.map((file) => ({
            relativePath: `${skill.name}/${file.relativePath}`,
            content: file.content,
        }))),
    };
    const instructions = view.instructions[target];
    if (instructions)
        source.instructions = instructions;
    if (Object.keys(view.mcpServers).length > 0) {
        source.mcp = { servers: view.mcpServers };
    }
    if (Object.keys(view.mcpOverrides).length > 0) {
        source.mcpOverrides = view.mcpOverrides;
    }
    return source;
}
const MCP_OVERRIDE_SURFACES = {
    codex: 'ide/codex/mcp-overrides.yaml',
    'claude-code': 'ide/claude-code/mcp-overrides.yaml',
    'gemini-cli': 'ide/gemini/gemini-cli/mcp-overrides.yaml',
    antigravity: 'ide/gemini/antigravity/mcp-overrides.yaml',
};
export function buildSelectedRepositoryView(repositoryPath, selection, context) {
    const selected = new Set(selection.assetIds);
    const view = {
        instructions: {},
        skills: [],
        mcpServers: {},
        mcpOverrides: {},
        nativeAssets: new Map(),
    };
    for (const definition of IDE_INSTRUCTION_DEFINITIONS) {
        if (!selected.has(definition.assetId))
            continue;
        const instructionsPath = repositoryFileForPlatform(repositoryPath, definition.repositoryPath, context);
        if (!fs.existsSync(instructionsPath))
            continue;
        view.instructions[definition.target] = {
            id: definition.assetId,
            content: fs.readFileSync(instructionsPath, 'utf8'),
        };
    }
    for (const assetId of selection.assetIds) {
        const parsed = parseAssetId(assetId);
        if (parsed.type !== 'skill')
            continue;
        const skillRoot = path.join(repositoryPath, 'common', 'skills', parsed.name);
        if (!fs.existsSync(skillRoot))
            continue;
        view.skills.push({
            id: assetId,
            name: parsed.name,
            files: readSkillFiles(skillRoot),
        });
    }
    const mcpNames = selection.assetIds
        .map((id) => parseAssetId(id))
        .filter((parts) => parts.type === 'mcp')
        .map((parts) => parts.name);
    if (mcpNames.length > 0) {
        const mcpPath = selectOverride(repositoryPath, 'mcp.yaml', context);
        if (fs.existsSync(mcpPath)) {
            const parsed = resolvePortableValue(yaml.parse(fs.readFileSync(mcpPath, 'utf8')), context.variables ?? {}, context.platform);
            if (isRecord(parsed) && isRecord(parsed.servers)) {
                for (const name of mcpNames) {
                    if (name in parsed.servers) {
                        view.mcpServers[name] = parsed.servers[name];
                    }
                }
            }
        }
        for (const [surface, relativePath] of Object.entries(MCP_OVERRIDE_SURFACES)) {
            const overridePath = repositoryFileForPlatform(repositoryPath, relativePath, context);
            if (!fs.existsSync(overridePath))
                continue;
            const document = yaml.parse(fs.readFileSync(overridePath, 'utf8'));
            if (!isRecord(document))
                continue;
            const filtered = {};
            for (const name of mcpNames) {
                if (name in document)
                    filtered[name] = document[name];
            }
            if (Object.keys(filtered).length > 0) {
                view.mcpOverrides[surface] = filtered;
            }
        }
    }
    for (const unit of DECLARED_NATIVE_UNITS) {
        const assetId = nativeAssetId(unit);
        if (!selected.has(assetId))
            continue;
        const sourcePath = repositoryFileForPlatform(repositoryPath, unit.repositoryPath, context);
        if (!fs.existsSync(sourcePath))
            continue;
        view.nativeAssets.set(assetId, fs.readFileSync(sourcePath));
    }
    return view;
}
function selectOverride(repositoryPath, name, context) {
    const platformDirectory = context.platform === 'win32' ? 'windows' : 'macos';
    const override = path.join(repositoryPath, 'overrides', platformDirectory, 'common', name);
    return fs.existsSync(override) ? override : path.join(repositoryPath, 'common', name);
}
function readSkillFiles(skillRoot) {
    const files = [];
    const walk = (directory) => {
        for (const entry of fs.readdirSync(directory, { withFileTypes: true })
            .sort((left, right) => left.name.localeCompare(right.name))) {
            const absolute = path.join(directory, entry.name);
            if (entry.isDirectory()) {
                walk(absolute);
                continue;
            }
            if (!entry.isFile())
                continue;
            files.push({
                relativePath: path.relative(skillRoot, absolute).split(path.sep).join('/'),
                content: fs.readFileSync(absolute),
            });
        }
    };
    walk(skillRoot);
    return files;
}
