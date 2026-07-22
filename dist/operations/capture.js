"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.createCapturePlan = createCapturePlan;
const crypto = __importStar(require("crypto"));
const buffer_1 = require("buffer");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const uuid_1 = require("uuid");
const yaml = __importStar(require("yaml"));
const adapters_1 = require("../adapters");
const skills_1 = require("../core/skills");
const objects_1 = require("../utils/objects");
const repository_1 = require("../utils/repository");
const sanitize_1 = require("../utils/sanitize");
const structured_config_1 = require("../utils/structured-config");
const contracts_1 = require("./contracts");
const EMPTY_SUMMARY = {
    sensitiveFieldCount: 0,
    parameterizedPathCount: 0,
    excludedFileCount: 0,
};
async function createCapturePlan(context) {
    const operationId = (0, uuid_1.v4)();
    let repositoryPath = null;
    try {
        repositoryPath = (0, repository_1.resolveBoundRepository)(context);
        return await buildCapturePlan(context, repositoryPath, operationId);
    }
    catch {
        return {
            schemaVersion: contracts_1.OPERATION_SCHEMA_VERSION,
            operation: 'capture',
            status: 'failed',
            readyToApply: false,
            operationId,
            preconditions: {},
            repositoryPath,
            changes: [],
            issues: [{
                    severity: 'error',
                    code: 'capture.planFailed',
                    message: 'The Capture Plan could not be generated safely.',
                }],
            nextActions: ['Fix the reported Repository or IDE configuration problem, then regenerate the Capture Plan.'],
            error: {
                code: 'capture.planFailed',
                message: 'The Capture Plan could not be generated safely.',
                nextActions: ['Fix the Repository or IDE configuration problem, then regenerate the Capture Plan.'],
            },
            summary: EMPTY_SUMMARY,
        };
    }
}
async function buildCapturePlan(context, repositoryPath, operationId) {
    const manifest = (0, repository_1.readManifest)(repositoryPath);
    const definitions = (0, adapters_1.createAdapterDefinitions)().filter(({ targetId }) => manifest.targets[targetId]?.enabled === true);
    if (definitions.length === 0) {
        return {
            schemaVersion: contracts_1.OPERATION_SCHEMA_VERSION,
            operation: 'capture',
            status: 'planned',
            readyToApply: true,
            operationId,
            preconditions: {},
            repositoryPath,
            changes: [],
            issues: [{
                    severity: 'notice',
                    code: 'capture.noEnabledTargets',
                    message: 'No IDE targets are enabled in this Repository.',
                }],
            nextActions: ['Enable at least one IDE target in mcv.yaml before capturing configuration.'],
            summary: EMPTY_SUMMARY,
        };
    }
    const captureContext = {
        ...context,
        variables: resolveManifestVariables(manifest.variables, context),
    };
    const captured = await Promise.all(definitions.map(async (definition) => {
        const discovered = await definition.adapter.discoverFiles(captureContext);
        const result = await definition.adapter.capture(discovered, captureContext);
        return { definition, result };
    }));
    const issues = captured.flatMap(({ result }, resultIndex) => result.warnings.map((_warning, warningIndex) => ({
        severity: 'warning',
        code: `capture.sourceSkipped.${resultIndex + 1}.${warningIndex + 1}`,
        message: 'A source item was skipped because it could not be processed safely.',
    })));
    const sourcedFiles = captured.flatMap(({ definition, result }) => result.files.map((file) => ({
        ...file,
        ide: ideName(definition.targetId),
        surface: surfaceName(file.repositoryPath, definition.targetId),
    })));
    const skills = (0, skills_1.collectSkills)((0, skills_1.getSkillSources)(captureContext, {
        codex: manifest.targets.codex?.enabled === true,
        claudeCode: manifest.targets.claudeCode?.enabled === true,
        gemini: manifest.targets.gemini?.enabled === true,
    }));
    for (let index = 0; index < skills.warnings.length; index += 1) {
        issues.push({
            severity: 'warning',
            code: `capture.skillSkipped.${index + 1}`,
            message: 'A Skill source item was skipped because it could not be processed safely.',
        });
    }
    const summary = captured.reduce((total, { result }) => ({
        sensitiveFieldCount: total.sensitiveFieldCount + result.summary.sensitiveFieldCount,
        parameterizedPathCount: total.parameterizedPathCount + result.summary.parameterizedPathCount,
        excludedFileCount: total.excludedFileCount + result.summary.excludedFileCount,
    }), {
        ...EMPTY_SUMMARY,
        excludedFileCount: skills.excludedFileCount,
    });
    const changes = [];
    const plannedRepositoryPaths = new Set();
    addRulesChange(repositoryPath, sourcedFiles, changes, issues, plannedRepositoryPaths);
    addMcpChanges(repositoryPath, sourcedFiles, changes, issues, plannedRepositoryPaths);
    addFileChanges(repositoryPath, sourcedFiles, changes, issues, plannedRepositoryPaths);
    addSkillChanges(repositoryPath, skills.packages, changes, issues, plannedRepositoryPaths);
    addRepositoryDeletionChanges(repositoryPath, definitions.map(({ targetId }) => targetId), sourcedFiles, skills.packages, changes, issues, plannedRepositoryPaths);
    changes.sort(compareChanges);
    const preconditions = Object.fromEntries(changes.flatMap((change) => [
        [`source:${change.id}`, hashText(change.previews.map((preview) => preview.sha256).join('\n'))],
        [`target:${change.id}`, hashRepositoryPaths(repositoryPath, change.repositoryPaths)],
    ]));
    const blocked = issues.some((issue) => issue.severity === 'decisionRequired' || issue.severity === 'error');
    return {
        schemaVersion: contracts_1.OPERATION_SCHEMA_VERSION,
        operation: 'capture',
        status: 'planned',
        readyToApply: !blocked,
        operationId,
        preconditions,
        repositoryPath,
        changes,
        issues,
        nextActions: blocked
            ? ['Resolve every decisionRequired or error Issue, then regenerate the Capture Plan.']
            : [],
        summary,
    };
}
function addRulesChange(repositoryPath, files, changes, issues, plannedRepositoryPaths) {
    const candidates = files.filter((file) => file.repositoryPath === 'common/AGENTS.md');
    if (candidates.length === 0)
        return;
    const targetPath = path.join(repositoryPath, 'common', 'AGENTS.md');
    const contents = [
        ...(fs.existsSync(targetPath) ? [fs.readFileSync(targetPath, 'utf8')] : []),
        ...candidates.flatMap((candidate) => typeof candidate.content === 'string' ? [candidate.content] : []),
    ];
    const content = mergeCanonicalRules(contents);
    const planned = planFile(repositoryPath, {
        ...candidates[0],
        ide: 'shared',
        surface: 'shared',
        sourcePath: candidates.map((candidate) => candidate.sourcePath).join(', '),
        content,
    }, issues);
    if (!planned || sameOptionalContent(planned.existingContent, planned.finalContent))
        return;
    changes.push(fileChange('shared', 'shared', 'file', 'rules', 'Canonical Rules', planned, issues));
    plannedRepositoryPaths.add(planned.repositoryPath);
}
function addMcpChanges(repositoryPath, files, changes, issues, plannedRepositoryPaths) {
    const registryFiles = files.filter((file) => file.repositoryPath === 'common/mcp.yaml' && typeof file.content === 'string');
    const candidatesByName = new Map();
    for (const file of registryFiles) {
        const parsed = yaml.parse(file.content);
        if (!(0, objects_1.isRecord)(parsed) || !(0, objects_1.isRecord)(parsed.servers)) {
            issues.push({
                severity: 'error',
                code: 'capture.invalidMcpRegistry',
                message: 'An MCP source could not be represented as a safe registry.',
            });
            continue;
        }
        for (const [name, value] of Object.entries(parsed.servers)) {
            if (!(0, objects_1.isRecord)(value))
                continue;
            candidatesByName.set(name, [
                ...(candidatesByName.get(name) ?? []),
                { sourcePath: file.sourcePath, ide: file.ide, value },
            ]);
        }
    }
    const existingServers = readMcpServers(path.join(repositoryPath, 'common', 'mcp.yaml'));
    const names = new Set([...candidatesByName.keys(), ...Object.keys(existingServers)]);
    for (const name of [...names].sort()) {
        const deviceCandidates = uniqueMcpCandidates(candidatesByName.get(name) ?? []);
        const existing = (0, objects_1.isRecord)(existingServers[name]) ? existingServers[name] : undefined;
        if (deviceCandidates.length === 0 && existing) {
            const content = yaml.stringify({ [name]: existing });
            changes.push({
                id: selectionId('mcp', 'shared', name),
                ide: 'shared',
                surface: 'shared',
                itemType: 'mcp',
                capability: 'mcp',
                name,
                change: 'delete',
                defaultSelected: false,
                repositoryPaths: [`common/mcp.yaml#${name}`],
                previews: [preview(`common/mcp.yaml#${name}`, '', content, issues)],
            });
            continue;
        }
        const allCandidates = uniqueMcpCandidates([
            ...(existing ? [{ sourcePath: 'Repository common/mcp.yaml', ide: 'shared', value: existing }] : []),
            ...deviceCandidates,
        ]);
        const uniqueCore = new Set(allCandidates.map((candidate) => stableValue(withoutOverrides(candidate.value))));
        if (uniqueCore.size > 1) {
            const decisionGroupId = `capture-decision-${hashText(`mcp\0${name}`).slice(0, 16)}`;
            for (const candidate of allCandidates) {
                const candidateValue = stableValue(candidate.value);
                changes.push({
                    id: selectionId('mcp', 'shared', `${name}\0${candidateValue}`),
                    ide: 'shared',
                    surface: 'shared',
                    itemType: 'mcp',
                    capability: 'mcp',
                    name,
                    change: 'conflict',
                    defaultSelected: false,
                    repositoryPaths: [`common/mcp.yaml#${name}`],
                    previews: [preview(`common/mcp.yaml#${name}`, yaml.stringify({ [name]: candidate.value }), undefined, issues)],
                    decisionGroupId,
                });
            }
            issues.push({
                severity: 'decisionRequired',
                code: 'capture.mcpCoreConflict',
                message: `MCP server ${safeLabel(name)} has conflicting core definitions.`,
            });
            continue;
        }
        const merged = mergeMcpCandidates(allCandidates);
        if (existing && stableValue(existing) === stableValue(merged))
            continue;
        const before = existing ? yaml.stringify({ [name]: existing }) : undefined;
        const after = yaml.stringify({ [name]: merged });
        changes.push({
            id: selectionId('mcp', 'shared', name),
            ide: 'shared',
            surface: 'shared',
            itemType: 'mcp',
            capability: 'mcp',
            name,
            change: existing ? 'modify' : 'add',
            defaultSelected: true,
            repositoryPaths: [`common/mcp.yaml#${name}`],
            previews: [preview(`common/mcp.yaml#${name}`, after, before, issues)],
        });
    }
    if (names.size > 0)
        plannedRepositoryPaths.add('common/mcp.yaml');
}
function addFileChanges(repositoryPath, files, changes, issues, plannedRepositoryPaths) {
    const groups = new Map();
    for (const file of files) {
        if (file.repositoryPath === 'common/AGENTS.md' || file.repositoryPath === 'common/mcp.yaml')
            continue;
        groups.set(file.repositoryPath, [...(groups.get(file.repositoryPath) ?? []), file]);
    }
    for (const [repositoryFile, candidates] of groups) {
        plannedRepositoryPaths.add(repositoryFile);
        const unique = candidates.filter((candidate, index) => candidates.findIndex((other) => sameContent(other.content, candidate.content)) === index);
        if (unique.length > 1) {
            issues.push({
                severity: 'decisionRequired',
                code: 'capture.managedSourceConflict',
                message: `Capture source ${safeLabel(repositoryFile)} has conflicting definitions.`,
            });
            const first = unique[0];
            changes.push({
                id: selectionId('file', first.ide, repositoryFile),
                ide: first.ide,
                surface: first.surface,
                itemType: repositoryFile.includes('mcp-overrides') ? 'mcp' : 'file',
                capability: repositoryFile.includes('mcp-overrides') ? 'mcp' : 'native',
                name: path.posix.basename(repositoryFile),
                change: 'conflict',
                defaultSelected: false,
                repositoryPaths: [repositoryFile],
                previews: unique.map((candidate, index) => preview(`${repositoryFile}:candidate-${index + 1}`, candidate.content, undefined, issues)),
            });
            continue;
        }
        const planned = planFile(repositoryPath, unique[0], issues);
        if (!planned || sameOptionalContent(planned.existingContent, planned.finalContent))
            continue;
        const mcpOverride = repositoryFile.includes('mcp-overrides');
        changes.push(fileChange(planned.ide, planned.surface, mcpOverride ? 'mcp' : 'file', mcpOverride ? 'mcp' : 'native', path.posix.basename(repositoryFile), planned, issues));
    }
}
function addSkillChanges(repositoryPath, packages, changes, issues, plannedRepositoryPaths) {
    for (const [name, copies] of packages) {
        const selected = newestSkillCopy(uniqueSkillCopies(copies));
        const previews = [];
        const repositoryPaths = [];
        let changed = false;
        let added = true;
        for (const file of selected.files) {
            const repositoryFile = path.posix.join('common', 'skills', name, file.relativePath.replace(/\\/g, '/'));
            const targetPath = path.join(repositoryPath, ...repositoryFile.split('/'));
            const existing = fs.existsSync(targetPath) ? fs.readFileSync(targetPath) : undefined;
            if (existing)
                added = false;
            if (!existing?.equals(file.content))
                changed = true;
            previews.push(preview(repositoryFile, file.content, existing, issues));
            repositoryPaths.push(repositoryFile);
            plannedRepositoryPaths.add(repositoryFile);
        }
        const repositorySkillRoot = path.join(repositoryPath, 'common', 'skills', name);
        for (const repositoryFile of listFiles(repositorySkillRoot)) {
            const relative = path.relative(repositoryPath, repositoryFile).replace(/\\/g, '/');
            if (repositoryPaths.includes(relative))
                continue;
            const existing = fs.readFileSync(repositoryFile);
            changed = true;
            added = false;
            previews.push(preview(relative, '', existing, issues));
            repositoryPaths.push(relative);
            plannedRepositoryPaths.add(relative);
        }
        if (!changed)
            continue;
        changes.push({
            id: selectionId('skill', 'shared', name),
            ide: 'shared',
            surface: selected.source.surface,
            itemType: 'skill',
            capability: 'skills',
            name,
            change: added ? 'add' : 'modify',
            defaultSelected: true,
            repositoryPaths: repositoryPaths.sort(),
            previews: previews.sort((left, right) => left.repositoryPath.localeCompare(right.repositoryPath)),
        });
    }
}
function addRepositoryDeletionChanges(repositoryPath, enabledTargets, sourcedFiles, packages, changes, issues, plannedRepositoryPaths) {
    const repositoryRules = path.join(repositoryPath, 'common', 'AGENTS.md');
    if (fs.existsSync(repositoryRules)
        && !sourcedFiles.some((file) => file.repositoryPath === 'common/AGENTS.md')) {
        changes.push(deletionFileChange(repositoryPath, 'shared', 'shared', 'file', 'rules', 'Canonical Rules', 'common/AGENTS.md', issues));
    }
    const skillsRoot = path.join(repositoryPath, 'common', 'skills');
    if (fs.existsSync(skillsRoot)) {
        for (const entry of fs.readdirSync(skillsRoot, { withFileTypes: true })) {
            if (!entry.isDirectory() || packages.has(entry.name))
                continue;
            const repositoryPaths = listFiles(path.join(skillsRoot, entry.name))
                .map((file) => path.relative(repositoryPath, file).replace(/\\/g, '/'));
            changes.push({
                id: selectionId('skill', 'shared', entry.name),
                ide: 'shared',
                surface: 'shared',
                itemType: 'skill',
                capability: 'skills',
                name: entry.name,
                change: 'delete',
                defaultSelected: false,
                repositoryPaths,
                previews: repositoryPaths.map((repositoryFile) => preview(repositoryFile, '', fs.readFileSync(path.join(repositoryPath, ...repositoryFile.split('/'))), issues)),
            });
        }
    }
    for (const targetId of enabledTargets) {
        const ide = ideName(targetId);
        const nativeRoot = path.join(repositoryPath, 'ide', ide, 'native');
        for (const repositoryFile of listFiles(nativeRoot)) {
            const relative = path.relative(repositoryPath, repositoryFile).replace(/\\/g, '/');
            if (plannedRepositoryPaths.has(relative))
                continue;
            changes.push(deletionFileChange(repositoryPath, ide, surfaceName(relative, targetId), 'file', 'native', path.posix.basename(relative), relative, issues));
        }
    }
}
function planFile(repositoryPath, file, issues) {
    const contentBuffer = toBuffer(file.content);
    if (isText(contentBuffer) && (0, sanitize_1.scanTextForSecrets)(contentBuffer.toString('utf8')).length > 0) {
        issues.push({
            severity: 'error',
            code: 'capture.plaintextSecretBlocked',
            message: 'A Capture source contains a suspected plaintext secret and was blocked.',
        });
        return undefined;
    }
    const destinationPath = path.join(repositoryPath, ...file.repositoryPath.split('/'));
    const existingContent = fs.existsSync(destinationPath)
        ? fs.readFileSync(destinationPath)
        : undefined;
    const finalContent = mergeWithRepository(file, existingContent);
    return { ...file, existingContent, finalContent };
}
function fileChange(ide, surface, itemType, capability, name, file, issues) {
    return {
        id: selectionId(itemType, ide, file.repositoryPath),
        ide,
        surface,
        itemType,
        capability,
        name,
        change: file.existingContent ? 'modify' : 'add',
        defaultSelected: true,
        repositoryPaths: [file.repositoryPath],
        previews: [preview(file.repositoryPath, file.finalContent, file.existingContent, issues)],
    };
}
function deletionFileChange(repositoryPath, ide, surface, itemType, capability, name, repositoryFile, issues) {
    const existing = fs.readFileSync(path.join(repositoryPath, ...repositoryFile.split('/')));
    return {
        id: selectionId(itemType, ide, repositoryFile),
        ide,
        surface,
        itemType,
        capability,
        name,
        change: 'delete',
        defaultSelected: false,
        repositoryPaths: [repositoryFile],
        previews: [preview(repositoryFile, '', existing, issues)],
    };
}
function preview(repositoryPath, next, previous, issues) {
    const nextBuffer = toBuffer(next);
    const previousBuffer = previous === undefined ? undefined : toBuffer(previous);
    const binary = !isText(nextBuffer) || (previousBuffer !== undefined && !isText(previousBuffer));
    if (binary) {
        const metadataBuffer = nextBuffer.length === 0 && previousBuffer
            ? previousBuffer
            : nextBuffer;
        return {
            repositoryPath,
            kind: 'binary',
            bytes: metadataBuffer.length,
            sha256: hashBuffer(metadataBuffer),
        };
    }
    const nextText = nextBuffer.toString('utf8');
    const previousText = previousBuffer?.toString('utf8');
    if ((0, sanitize_1.scanTextForSecrets)(nextText).length > 0
        || (previousText !== undefined && (0, sanitize_1.scanTextForSecrets)(previousText).length > 0)) {
        issues.push({
            severity: 'error',
            code: 'capture.plaintextSecretBlocked',
            message: 'Unsafe plaintext content was withheld from the Capture preview.',
        });
        return {
            repositoryPath,
            kind: 'text',
            bytes: nextBuffer.length,
            sha256: hashBuffer(nextBuffer),
            diff: '[unsafe text withheld]',
        };
    }
    return {
        repositoryPath,
        kind: 'text',
        bytes: nextBuffer.length,
        sha256: hashBuffer(nextBuffer),
        diff: renderDiff(previousText, nextText),
    };
}
function renderDiff(previous, next) {
    if (previous === undefined)
        return lines(next).map((line) => `+ ${line}`).join('\n');
    if (next.length === 0)
        return lines(previous).map((line) => `- ${line}`).join('\n');
    return [
        ...lines(previous).map((line) => `- ${line}`),
        ...lines(next).map((line) => `+ ${line}`),
    ].join('\n');
}
function lines(value) {
    const normalized = value.replace(/\r\n?/g, '\n');
    const result = normalized.split('\n');
    if (result.at(-1) === '')
        result.pop();
    return result;
}
function mergeWithRepository(file, existingBuffer) {
    if (!existingBuffer || Buffer.isBuffer(file.content))
        return file.content;
    const format = structuredFormat(file.repositoryPath);
    if (file.ownership !== 'native' || !format)
        return file.content;
    const existing = (0, structured_config_1.parseStructuredObject)(existingBuffer.toString('utf8'), format, file.repositoryPath);
    const captured = (0, structured_config_1.parseStructuredObject)(file.content, format, file.repositoryPath);
    const merged = (0, objects_1.mergeRecords)(existing, captured);
    for (const localPath of file.localPaths ?? [])
        (0, structured_config_1.deleteObjectPath)(merged, localPath);
    return (0, structured_config_1.stringifyStructuredObject)(merged, format);
}
function structuredFormat(repositoryPath) {
    if (repositoryPath.endsWith('.json'))
        return 'json';
    if (repositoryPath.endsWith('.yaml') || repositoryPath.endsWith('.yml'))
        return 'yaml';
    if (repositoryPath.endsWith('.toml'))
        return 'toml';
    return undefined;
}
function readMcpServers(registryPath) {
    if (!fs.existsSync(registryPath))
        return {};
    const parsed = yaml.parse(fs.readFileSync(registryPath, 'utf8'));
    return (0, objects_1.isRecord)(parsed) && (0, objects_1.isRecord)(parsed.servers) ? parsed.servers : {};
}
function uniqueMcpCandidates(candidates) {
    return candidates.filter((candidate, index) => candidates.findIndex((other) => stableValue(other.value) === stableValue(candidate.value)) === index);
}
function mergeMcpCandidates(candidates) {
    const sorted = [...candidates].sort((left, right) => left.sourcePath.localeCompare(right.sourcePath));
    const result = { ...withoutOverrides(sorted[0].value) };
    const overrides = sorted.reduce((merged, candidate) => (0, objects_1.isRecord)(candidate.value.overrides)
        ? (0, objects_1.mergeRecords)(merged, candidate.value.overrides)
        : merged, {});
    if (Object.keys(overrides).length > 0)
        result.overrides = overrides;
    return result;
}
function withoutOverrides(value) {
    const copy = { ...value };
    delete copy.overrides;
    return copy;
}
function mergeCanonicalRules(contents) {
    const blocks = [];
    const seen = new Set();
    for (const content of contents) {
        for (const block of content.replace(/\r\n?/g, '\n').trim().split(/\n{2,}/)) {
            const normalized = block.trim();
            if (!normalized || seen.has(normalized))
                continue;
            seen.add(normalized);
            blocks.push(normalized);
        }
    }
    return `${blocks.join('\n\n')}\n`;
}
function uniqueSkillCopies(copies) {
    const seen = new Set();
    return copies.filter((copy) => !seen.has(copy.hash) && seen.add(copy.hash));
}
function newestSkillCopy(copies) {
    return [...copies].sort((left, right) => right.modifiedAtMs - left.modifiedAtMs
        || left.source.surface.localeCompare(right.source.surface)
        || left.directory.localeCompare(right.directory))[0];
}
function selectionId(itemType, ide, name) {
    return `capture-${hashText(`${itemType}\0${ide}\0${name}`).slice(0, 16)}`;
}
function hashRepositoryPaths(repositoryPath, repositoryPaths) {
    const hash = crypto.createHash('sha256');
    for (const repositoryFile of [...repositoryPaths].sort()) {
        const cleanPath = repositoryFile.split('#')[0];
        const target = path.join(repositoryPath, ...cleanPath.split('/'));
        hash.update(repositoryFile);
        hash.update(fs.existsSync(target) ? fs.readFileSync(target) : '<missing>');
    }
    return hash.digest('hex');
}
function hashText(value) {
    return crypto.createHash('sha256').update(value).digest('hex');
}
function hashBuffer(value) {
    return crypto.createHash('sha256').update(value).digest('hex');
}
function stableValue(value) {
    if (Array.isArray(value))
        return `[${value.map(stableValue).join(',')}]`;
    if ((0, objects_1.isRecord)(value)) {
        return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableValue(value[key])}`).join(',')}}`;
    }
    return JSON.stringify(value);
}
function ideName(targetId) {
    return targetId === 'claudeCode' ? 'claude-code' : targetId;
}
function surfaceName(repositoryPath, targetId) {
    if (targetId !== 'gemini')
        return ideName(targetId);
    if (repositoryPath.includes('/antigravity/'))
        return 'antigravity';
    return 'gemini-cli';
}
function resolveManifestVariables(variables, context) {
    const platformKey = context.platform === 'win32'
        ? 'windows'
        : context.platform === 'darwin' ? 'macos' : 'linux';
    return Object.fromEntries(Object.entries(variables ?? {}).flatMap(([name, declaration]) => {
        const value = typeof declaration === 'string'
            ? declaration
            : (0, objects_1.isRecord)(declaration) && typeof declaration[platformKey] === 'string'
                ? declaration[platformKey]
                : undefined;
        return value ? [[name, value.replace(/\$\{HOME\}/g, context.homeDir)]] : [];
    }));
}
function listFiles(directory) {
    if (!fs.existsSync(directory))
        return [];
    return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const target = path.join(directory, entry.name);
        return entry.isDirectory() ? listFiles(target) : entry.isFile() ? [target] : [];
    }).sort();
}
function isText(content) {
    const sample = content.subarray(0, Math.min(content.length, 8_192));
    if (sample.includes(0) || !(0, buffer_1.isUtf8)(sample) || hasBinarySignature(sample))
        return false;
    return !sample.some((byte) => byte < 0x20 && byte !== 0x09 && byte !== 0x0a && byte !== 0x0d);
}
function hasBinarySignature(content) {
    const signatures = [
        Buffer.from('%PDF-'),
        Buffer.from([0x50, 0x4b, 0x03, 0x04]),
        Buffer.from([0x1f, 0x8b]),
        Buffer.from([0x89, 0x50, 0x4e, 0x47]),
        Buffer.from([0xff, 0xd8, 0xff]),
        Buffer.from('GIF87a'),
        Buffer.from('GIF89a'),
        Buffer.from([0x7f, 0x45, 0x4c, 0x46]),
        Buffer.from([0x00, 0x61, 0x73, 0x6d]),
    ];
    return signatures.some((signature) => content.length >= signature.length
        && content.subarray(0, signature.length).equals(signature));
}
function toBuffer(content) {
    return Buffer.isBuffer(content) ? content : Buffer.from(content);
}
function sameContent(left, right) {
    return toBuffer(left).equals(toBuffer(right));
}
function sameOptionalContent(existing, next) {
    return existing?.equals(toBuffer(next)) ?? false;
}
function compareChanges(left, right) {
    return left.ide.localeCompare(right.ide)
        || left.itemType.localeCompare(right.itemType)
        || left.name.localeCompare(right.name)
        || left.id.localeCompare(right.id);
}
function safeLabel(value) {
    return /^[a-zA-Z0-9._/-]+$/.test(value) ? value : '[redacted name]';
}
