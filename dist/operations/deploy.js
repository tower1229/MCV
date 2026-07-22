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
exports.createDeployPlan = createDeployPlan;
const crypto = __importStar(require("crypto"));
const buffer_1 = require("buffer");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const uuid_1 = require("uuid");
const adapters_1 = require("../adapters");
const files_1 = require("../utils/files");
const objects_1 = require("../utils/objects");
const repository_1 = require("../utils/repository");
const sanitize_1 = require("../utils/sanitize");
const state_1 = require("../utils/state");
const structured_config_1 = require("../utils/structured-config");
const variables_1 = require("../utils/variables");
const deploy_skills_1 = require("../utils/deploy-skills");
const contracts_1 = require("./contracts");
async function createDeployPlan(context) {
    const operationId = (0, uuid_1.v4)();
    let repositoryPath = null;
    try {
        repositoryPath = (0, repository_1.resolveBoundRepository)(context);
        return await buildDeployPlan(context, repositoryPath, operationId);
    }
    catch {
        return freezeDeployPlan({
            schemaVersion: contracts_1.OPERATION_SCHEMA_VERSION,
            operation: 'deploy',
            status: 'failed',
            readyToApply: false,
            operationId,
            preconditions: {},
            repositoryPath,
            changes: [],
            issues: [{
                    severity: 'error',
                    code: 'deploy.planFailed',
                    message: 'The Deploy Plan could not be generated safely.',
                }],
            nextActions: ['Fix the reported Repository or IDE configuration problem, then regenerate the Deploy Plan.'],
            error: {
                code: 'deploy.planFailed',
                message: 'The Deploy Plan could not be generated safely.',
                nextActions: ['Fix the Repository or IDE configuration problem, then regenerate the Deploy Plan.'],
            },
        });
    }
}
async function buildDeployPlan(context, repositoryPath, operationId) {
    const manifest = (0, repository_1.readManifest)(repositoryPath);
    const definitions = (0, adapters_1.createAdapterDefinitions)().filter(({ targetId }) => manifest.targets[targetId]?.enabled === true);
    if (definitions.length === 0) {
        return freezeDeployPlan({
            schemaVersion: contracts_1.OPERATION_SCHEMA_VERSION,
            operation: 'deploy',
            status: 'planned',
            readyToApply: true,
            operationId,
            preconditions: {},
            repositoryPath,
            changes: [],
            issues: [{
                    severity: 'notice',
                    code: 'deploy.noEnabledTargets',
                    message: 'No IDE targets are enabled in this Repository.',
                }],
            nextActions: ['Enable at least one IDE target in mcv.yaml before deploying configuration.'],
        });
    }
    const deployContext = {
        ...context,
        variables: resolveManifestVariables(manifest.variables, context, repositoryPath),
    };
    const desired = (await Promise.all(definitions.map(async (definition) => {
        const operation = await definition.adapter.deploy(repositoryPath, deployContext);
        return operation.files.flatMap((file) => {
            const semantics = inferDeploymentSemantics(file.targetPath, definition.targetId, repositoryPath, context);
            return semantics.capabilities.map((capability) => ({
                ...file,
                ide: ideName(definition.targetId),
                capability,
                strategy: semantics.strategy,
            }));
        });
    }))).flat();
    const issues = [];
    const safeDesired = desired.filter((file) => {
        const linkPath = (0, files_1.findSymbolicLinkAncestor)(file.targetPath);
        if (!linkPath)
            return true;
        issues.push({
            severity: 'warning',
            code: `deploy.symbolicLinkSkipped.${issues.length + 1}`,
            message: `A target beneath a symbolic link was excluded: ${file.targetPath}.`,
            details: `Symbolic link ancestor: ${linkPath}`,
        });
        return false;
    });
    const changes = safeDesired.flatMap((file) => {
        const previous = fs.existsSync(file.targetPath) ? fs.readFileSync(file.targetPath) : undefined;
        const next = toBuffer(file.content);
        if (previous?.equals(next))
            return [];
        const filePreview = preview(file.targetPath, file.capability, next, previous, issues);
        if (filePreview.kind === 'text' && filePreview.diff.length === 0)
            return [];
        const change = previous === undefined ? 'add' : 'modify';
        return [{
                id: selectionId(file.ide, file.capability, file.targetPath),
                ide: file.ide,
                capability: file.capability,
                name: displayName(file.targetPath, file.capability),
                targetPath: file.targetPath,
                change,
                defaultSelected: true,
                group: 'standard',
                strategy: file.strategy,
                preview: filePreview,
            }];
    });
    const legacyDuplicates = (0, deploy_skills_1.findLegacyCodexSkillDuplicates)(context, safeDesired, definitions.some(({ targetId }) => targetId === 'codex'));
    if (legacyDuplicates.names.length > 0) {
        issues.push({
            severity: 'notice',
            code: 'deploy.legacyCodexSkillDuplicates',
            message: `[duplicate:codex-legacy] ${legacyDuplicates.names.join(', ')}; review the Advanced Cleanup candidates.`,
        });
        for (const targetPath of legacyDuplicates.files) {
            changes.push({
                id: selectionId('codex', 'skills', targetPath),
                ide: 'codex',
                capability: 'skills',
                name: displayName(targetPath, 'skills'),
                targetPath,
                change: 'delete',
                defaultSelected: false,
                group: 'advanced',
                strategy: 'replace-entire-file',
                preview: preview(targetPath, 'skills', Buffer.alloc(0), fs.readFileSync(targetPath), issues),
            });
        }
    }
    const sourcePreconditions = new Map();
    const desiredPaths = new Set(safeDesired.map((file) => path.resolve(file.targetPath)));
    const managedInventory = (0, state_1.readState)(context).managedInventory ?? {};
    for (const [targetPath, inventoryEntry] of Object.entries(managedInventory)) {
        if (desiredPaths.has(path.resolve(targetPath)) || !fs.existsSync(targetPath))
            continue;
        const ide = inferIde(targetPath, context);
        if (!ide)
            continue;
        const semantics = inferDeploymentSemantics(targetPath, targetIdForIde(ide), repositoryPath, context);
        const capability = semantics.capabilities[0];
        if (semantics.strategy !== 'replace-entire-file' || !capability)
            continue;
        const deletion = {
            id: selectionId(ide, capability, targetPath),
            ide,
            capability,
            name: displayName(targetPath, capability),
            targetPath,
            change: 'delete',
            defaultSelected: false,
            group: 'advanced',
            strategy: semantics.strategy,
            preview: preview(targetPath, capability, Buffer.alloc(0), fs.readFileSync(targetPath), issues),
        };
        changes.push(deletion);
        sourcePreconditions.set(deletion.id, hashText(stableValue(inventoryEntry)));
    }
    changes.sort(compareChanges);
    const repositorySourceHash = hashRepositoryInputs(repositoryPath);
    const preconditions = Object.fromEntries(changes.flatMap((change) => {
        return [
            [`source:${change.id}`, sourcePreconditions.get(change.id) ?? repositorySourceHash],
            [`target:${change.id}`, fs.existsSync(change.targetPath) ? (0, files_1.hashFile)(change.targetPath) : hashText('<missing>')],
        ];
    }));
    const blocked = issues.some((issue) => issue.severity === 'decisionRequired' || issue.severity === 'error');
    return freezeDeployPlan({
        schemaVersion: contracts_1.OPERATION_SCHEMA_VERSION,
        operation: 'deploy',
        status: 'planned',
        readyToApply: !blocked,
        operationId,
        preconditions,
        repositoryPath,
        changes,
        issues,
        nextActions: blocked
            ? ['Resolve every decisionRequired or error Issue, then regenerate the Deploy Plan.']
            : [],
    });
}
function freezeDeployPlan(plan) {
    for (const change of plan.changes) {
        Object.freeze(change.preview);
        Object.freeze(change);
    }
    Object.freeze(plan.changes);
    for (const issue of plan.issues)
        Object.freeze(issue);
    Object.freeze(plan.issues);
    Object.freeze(plan.nextActions);
    Object.freeze(plan.preconditions);
    if (plan.status === 'failed') {
        Object.freeze(plan.error.nextActions);
        Object.freeze(plan.error);
    }
    return Object.freeze(plan);
}
function preview(targetPath, capability, next, previous, issues) {
    const metadata = next.length === 0 && previous ? previous : next;
    if (!isText(next) || (previous !== undefined && !isText(previous))) {
        return { targetPath, kind: 'binary', bytes: metadata.length, sha256: hashBuffer(metadata) };
    }
    const diff = renderSafeDiff(targetPath, capability, previous?.toString('utf8'), next.toString('utf8'));
    if ((0, sanitize_1.scanTextForSecrets)(diff).length > 0) {
        issues.push({
            severity: 'error',
            code: `deploy.unsafeDiffWithheld.${issues.length + 1}`,
            message: 'Unsafe plaintext content was withheld from the Deploy preview.',
        });
        return {
            targetPath,
            kind: 'text',
            bytes: metadata.length,
            sha256: hashBuffer(metadata),
            diff: '[unsafe text withheld]',
        };
    }
    return { targetPath, kind: 'text', bytes: metadata.length, sha256: hashBuffer(metadata), diff };
}
function renderSafeDiff(targetPath, capability, previous, next) {
    if (next.length === 0 || capability === 'rules' || capability === 'skills') {
        return renderChangedLines(previous, next);
    }
    const format = structuredFormat(targetPath);
    if (!format)
        return renderChangedLines(previous, next);
    try {
        const before = previous === undefined ? {} : (0, structured_config_1.parseStructuredObject)(previous, format, targetPath);
        const after = (0, structured_config_1.parseStructuredObject)(next, format, targetPath);
        const managedKey = format === 'toml' ? 'mcp_servers' : 'mcpServers';
        const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])]
            .filter((key) => capability === 'mcp' ? key === managedKey : key !== managedKey)
            .filter((key) => stableValue(before[key]) !== stableValue(after[key]))
            .sort();
        return keys.flatMap((key) => {
            const changed = [];
            if (key in before)
                changed.push(`- ${key}: ${stableValue(before[key])}`);
            if (key in after)
                changed.push(`+ ${key}: ${stableValue(after[key])}`);
            return changed;
        }).join('\n');
    }
    catch {
        return renderChangedLines(previous, next);
    }
}
function structuredFormat(targetPath) {
    if (targetPath.endsWith('.json'))
        return 'json';
    if (targetPath.endsWith('.yaml') || targetPath.endsWith('.yml'))
        return 'yaml';
    if (targetPath.endsWith('.toml'))
        return 'toml';
    return undefined;
}
function stableValue(value) {
    if (Array.isArray(value))
        return `[${value.map(stableValue).join(',')}]`;
    if ((0, objects_1.isRecord)(value)) {
        return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableValue(value[key])}`).join(',')}}`;
    }
    if (value instanceof Date)
        return JSON.stringify(value.toISOString());
    return JSON.stringify(value);
}
function renderChangedLines(previous, next) {
    const before = previous === undefined ? [] : lines(previous);
    const after = lines(next);
    if (previous === undefined)
        return after.map((line) => `+ ${line}`).join('\n');
    if (next.length === 0)
        return before.map((line) => `- ${line}`).join('\n');
    const lengths = Array.from({ length: before.length + 1 }, () => new Array(after.length + 1).fill(0));
    for (let left = before.length - 1; left >= 0; left -= 1) {
        for (let right = after.length - 1; right >= 0; right -= 1) {
            lengths[left][right] = before[left] === after[right]
                ? lengths[left + 1][right + 1] + 1
                : Math.max(lengths[left + 1][right], lengths[left][right + 1]);
        }
    }
    const changed = [];
    let left = 0;
    let right = 0;
    while (left < before.length || right < after.length) {
        if (left < before.length && right < after.length && before[left] === after[right]) {
            left += 1;
            right += 1;
        }
        else if (right < after.length && (left === before.length || lengths[left][right + 1] >= lengths[left + 1][right])) {
            changed.push(`+ ${after[right]}`);
            right += 1;
        }
        else {
            changed.push(`- ${before[left]}`);
            left += 1;
        }
    }
    return changed.join('\n');
}
function inferDeploymentSemantics(targetPath, targetId, repositoryPath, context) {
    const normalized = targetPath.replace(/\\/g, '/');
    const base = path.basename(targetPath).toLowerCase();
    if (base === 'agents.md' || base === 'claude.md' || base === 'gemini.md') {
        return { capabilities: ['rules'], strategy: 'replace-entire-file' };
    }
    if (normalized.includes('/skills/')) {
        return { capabilities: ['skills'], strategy: 'replace-entire-file' };
    }
    if (base === 'keybindings.json') {
        return { capabilities: ['native'], strategy: 'replace-entire-file' };
    }
    const capabilities = [];
    if (nativeSourceExists(targetPath, targetId, repositoryPath, context))
        capabilities.push('native');
    if (isMcpTarget(targetPath, targetId, context)
        && fs.existsSync(path.join(repositoryPath, 'common', 'mcp.yaml')))
        capabilities.push('mcp');
    return { capabilities: capabilities.length > 0 ? capabilities : ['native'], strategy: 'managed-merge' };
}
function nativeSourceExists(targetPath, targetId, repositoryPath, context) {
    const candidate = nativeRepositoryPath(targetPath, targetId, context);
    if (!candidate)
        return false;
    const platform = context.platform === 'win32' ? 'windows' : 'macos';
    return fs.existsSync(path.join(repositoryPath, 'overrides', platform, ...candidate.split('/')))
        || fs.existsSync(path.join(repositoryPath, ...candidate.split('/')));
}
function nativeRepositoryPath(targetPath, targetId, context) {
    const resolved = path.resolve(targetPath);
    if (targetId === 'codex')
        return 'ide/codex/native/config.toml';
    if (targetId === 'claudeCode') {
        if (resolved === path.resolve(context.homeDir, '.claude.json'))
            return 'ide/claude-code/native/.claude.json';
        return 'ide/claude-code/native/settings.json';
    }
    const root = path.resolve(context.homeDir, '.gemini');
    const relative = path.relative(root, resolved).replace(/\\/g, '/');
    const mappings = {
        'settings.json': 'ide/gemini/native/gemini-cli/settings.json',
        'config/config.json': 'ide/gemini/native/antigravity/config.json',
        'config/mcp_config.json': 'ide/gemini/native/antigravity/mcp_config.json',
        'antigravity-cli/settings.json': 'ide/gemini/native/antigravity/cli-settings.json',
    };
    if (mappings[relative])
        return mappings[relative];
    if (path.basename(resolved) === 'settings.json')
        return 'ide/gemini/native/antigravity/ide-settings.json';
    if (path.basename(resolved) === 'keybindings.json')
        return 'ide/gemini/native/antigravity/keybindings.json';
    return undefined;
}
function isMcpTarget(targetPath, targetId, context) {
    if (targetId === 'codex') {
        return path.resolve(targetPath) === path.resolve(context.env.CODEX_HOME || path.join(context.homeDir, '.codex'), 'config.toml');
    }
    if (targetId === 'claudeCode')
        return path.basename(targetPath) === '.claude.json';
    return path.basename(targetPath) === 'mcp_config.json'
        || path.resolve(targetPath) === path.resolve(context.homeDir, '.gemini', 'settings.json');
}
function selectionId(ide, capability, targetPath) {
    return `deploy-${hashText(`${ide}\0${capability}\0${path.resolve(targetPath)}`).slice(0, 16)}`;
}
function displayName(targetPath, capability) {
    if (capability === 'rules')
        return 'Shared Rules';
    if (capability === 'skills') {
        const segments = targetPath.replace(/\\/g, '/').split('/');
        const skillIndex = segments.lastIndexOf('skills');
        return segments[skillIndex + 1] ?? path.basename(targetPath);
    }
    if (capability === 'mcp')
        return 'MCP';
    return path.basename(targetPath);
}
function compareChanges(left, right) {
    const groupOrder = { standard: 0, advanced: 1 };
    const capabilityOrder = {
        rules: 0, skills: 1, mcp: 2, native: 3,
    };
    return groupOrder[left.group] - groupOrder[right.group]
        || left.ide.localeCompare(right.ide)
        || capabilityOrder[left.capability] - capabilityOrder[right.capability]
        || left.targetPath.localeCompare(right.targetPath);
}
function ideName(targetId) {
    if (targetId === 'claudeCode')
        return 'claude-code';
    return targetId;
}
function targetIdForIde(ide) {
    return ide === 'claude-code' ? 'claudeCode' : ide;
}
function inferIde(targetPath, context) {
    const resolved = path.resolve(targetPath);
    const roots = [
        ['codex', path.resolve(context.env.CODEX_HOME || path.join(context.homeDir, '.codex'))],
        ['codex', path.resolve(context.homeDir, '.agents', 'skills')],
        ['claude-code', path.resolve(context.env.CLAUDE_CONFIG_DIR || path.join(context.homeDir, '.claude'))],
        ['claude-code', path.resolve(context.homeDir, '.claude.json')],
        ['gemini', path.resolve(context.homeDir, '.gemini')],
    ];
    return roots.find(([, root]) => resolved === root || resolved.startsWith(`${root}${path.sep}`))?.[0];
}
function resolveManifestVariables(declarations, context, repositoryPath) {
    const platformKey = context.platform === 'win32'
        ? 'windows'
        : context.platform === 'darwin'
            ? 'macos'
            : 'linux';
    const definitions = {};
    for (const [name, declaration] of Object.entries(declarations ?? {})) {
        const value = typeof declaration === 'string'
            ? declaration
            : (0, objects_1.isRecord)(declaration) && typeof declaration[platformKey] === 'string'
                ? declaration[platformKey]
                : undefined;
        if (value !== undefined)
            definitions[name] = value;
    }
    return (0, variables_1.resolveVariableDefinitions)(definitions, {
        ...context.variables,
        HOME: context.homeDir,
        MCV_REPO: repositoryPath,
    }, context.platform);
}
function toBuffer(value) {
    return Buffer.isBuffer(value) ? Buffer.from(value) : Buffer.from(value);
}
function isText(value) {
    return value.length === 0 || ((0, buffer_1.isUtf8)(value) && !value.includes(0));
}
function lines(value) {
    const result = value.replace(/\r\n?/g, '\n').split('\n');
    if (result.at(-1) === '')
        result.pop();
    return result;
}
function hashBuffer(value) {
    return crypto.createHash('sha256').update(value).digest('hex');
}
function hashText(value) {
    return hashBuffer(Buffer.from(value));
}
function hashRepositoryInputs(repositoryPath) {
    const hash = crypto.createHash('sha256');
    const visit = (current) => {
        const relative = path.relative(repositoryPath, current).replace(/\\/g, '/');
        if (!fs.existsSync(current)) {
            hash.update(`missing\0${relative}\0`);
            return;
        }
        const stat = fs.lstatSync(current);
        if (stat.isSymbolicLink()) {
            hash.update(`symlink\0${relative}\0${fs.readlinkSync(current)}\0`);
            return;
        }
        if (stat.isDirectory()) {
            hash.update(`directory\0${relative}\0`);
            for (const entry of fs.readdirSync(current).sort())
                visit(path.join(current, entry));
            return;
        }
        hash.update(`file\0${relative}\0`);
        hash.update(fs.readFileSync(current));
        hash.update('\0');
    };
    visit(path.join(repositoryPath, 'mcv.yaml'));
    visit(path.join(repositoryPath, 'common'));
    visit(path.join(repositoryPath, 'ide'));
    visit(path.join(repositoryPath, 'overrides'));
    return hash.digest('hex');
}
