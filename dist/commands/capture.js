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
exports.captureConfigurations = captureConfigurations;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const promises_1 = require("readline/promises");
const yaml = __importStar(require("yaml"));
const adapters_1 = require("../adapters");
const skills_1 = require("../core/skills");
const objects_1 = require("../utils/objects");
const repository_1 = require("../utils/repository");
const state_1 = require("../utils/state");
const sanitize_1 = require("../utils/sanitize");
const structured_config_1 = require("../utils/structured-config");
async function captureConfigurations(context, dependencies = {}, options = {}) {
    const repositoryPath = (0, repository_1.resolveBoundRepository)(context);
    const manifest = (0, repository_1.readManifest)(repositoryPath);
    const definitions = (0, adapters_1.createAdapterDefinitions)().filter(({ targetId }) => manifest.targets[targetId]?.enabled === true);
    if (definitions.length === 0) {
        console.log('No IDE targets are enabled in mcv.yaml.');
        return;
    }
    const captureContext = {
        ...context,
        variables: resolveManifestVariables(manifest.variables, context),
    };
    const results = await Promise.all(definitions.map(async ({ adapter }) => {
        const files = await adapter.discoverFiles(captureContext);
        return adapter.capture(files, captureContext);
    }));
    const warnings = results.flatMap((result) => result.warnings);
    const skillCollection = (0, skills_1.collectSkills)((0, skills_1.getSkillSources)(captureContext, {
        codex: manifest.targets.codex?.enabled === true,
        claudeCode: manifest.targets.claudeCode?.enabled === true,
        gemini: manifest.targets.gemini?.enabled === true,
    }));
    warnings.push(...skillCollection.warnings);
    const skillFiles = [];
    for (const [name, copies] of skillCollection.packages) {
        const unique = uniqueSkillCopies(copies);
        const selected = newestSkillCopy(unique);
        skillFiles.push(...(0, skills_1.skillPackageToCaptureFiles)(selected));
    }
    const mcpResolvedFiles = await resolveMcpConflicts(repositoryPath, results.flatMap((result) => result.files), dependencies, options, warnings);
    const adapterFiles = await resolveCanonicalConflicts(repositoryPath, mcpResolvedFiles, dependencies, options, warnings);
    const plan = buildCapturePlan(repositoryPath, [...adapterFiles, ...skillFiles], warnings);
    if (options.yes && warnings.length > 0) {
        throw new Error('--yes refused because the capture plan contains warnings or skipped conflicts; review it interactively.');
    }
    const summary = results.reduce((total, result) => ({
        sensitiveFieldCount: total.sensitiveFieldCount + result.summary.sensitiveFieldCount,
        parameterizedPathCount: total.parameterizedPathCount + result.summary.parameterizedPathCount,
        excludedFileCount: total.excludedFileCount + result.summary.excludedFileCount,
    }), { sensitiveFieldCount: 0, parameterizedPathCount: 0, excludedFileCount: skillCollection.excludedFileCount });
    if (options.json) {
        console.log(JSON.stringify({ repositoryPath, changes: plan.map(publicPlan), warnings, summary }, null, 2));
    }
    else {
        for (const warning of warnings)
            console.log(`Warning: ${warning}`);
        if (plan.length === 0) {
            console.log('No configuration changes to capture.');
            return;
        }
        console.log('Capture preview (sanitized and parameterized):');
        for (const file of plan) {
            console.log(`[${file.change}][${file.ownership}] ${file.repositoryPath}`);
            if (typeof file.content === 'string')
                console.log(file.content.trimEnd());
            if (options.verbose && Buffer.isBuffer(file.content))
                console.log(`<binary ${file.content.length} bytes>`);
        }
        console.log(`Summary: ${plan.length} file(s), ${summary.sensitiveFieldCount} sensitive field(s) replaced, ${summary.parameterizedPathCount} path(s) parameterized, ${summary.excludedFileCount} file(s) excluded.`);
    }
    if (plan.length === 0 || options.dryRun)
        return;
    if (!process.stdin.isTTY && !options.yes && !dependencies.confirmCapture) {
        throw new Error('Capture requires an interactive terminal; use --yes only after reviewing --dry-run.');
    }
    const confirmed = options.yes || await (dependencies.confirmCapture ?? confirmInTerminal)();
    if (!confirmed) {
        console.log('Capture cancelled; repository was not changed.');
        return;
    }
    applyCaptureTransaction(plan);
    const state = (0, state_1.readState)(context);
    state.lastOperation = { kind: 'capture', time: new Date().toISOString(), success: true };
    (0, state_1.writeState)(context, state);
    console.log(`Captured ${plan.length} file(s) into ${repositoryPath}.`);
}
async function resolveMcpConflicts(repositoryPath, files, dependencies, options, warnings) {
    const mcpFiles = files.filter((file) => file.repositoryPath === 'common/mcp.yaml' && typeof file.content === 'string');
    if (mcpFiles.length === 0)
        return files;
    const candidates = [...mcpFiles];
    const existingPath = path.join(repositoryPath, 'common', 'mcp.yaml');
    if (fs.existsSync(existingPath))
        candidates.unshift({ sourcePath: existingPath, repositoryPath: 'common/mcp.yaml', content: fs.readFileSync(existingPath, 'utf8'), ownership: 'managed' });
    const byName = new Map();
    for (const candidate of candidates) {
        const parsed = yaml.parse(candidate.content);
        if (!(0, objects_1.isRecord)(parsed) || !(0, objects_1.isRecord)(parsed.servers))
            throw new Error(`${candidate.sourcePath}: MCP registry must contain a servers object.`);
        for (const [name, value] of Object.entries(parsed.servers)) {
            if (!(0, objects_1.isRecord)(value) || /^(node_repl|browser-use|computer-use)$/i.test(name)) {
                if (/^(node_repl|browser-use|computer-use)$/i.test(name))
                    warnings.push(`Excluded runtime MCP ${name}.`);
                continue;
            }
            byName.set(name, [...(byName.get(name) ?? []), { sourcePath: candidate.sourcePath, value }]);
        }
    }
    const servers = {};
    for (const [name, copies] of byName) {
        const unique = copies.filter((copy, index) => copies.findIndex((other) => stableValue(other.value) === stableValue(copy.value)) === index);
        if (unique.length === 1) {
            servers[name] = unique[0].value;
            continue;
        }
        const sameCore = unique.every((copy) => stableValue(withoutOverrides(copy.value)) === stableValue(withoutOverrides(unique[0].value)));
        if (sameCore) {
            servers[name] = withoutOverrides(unique[0].value);
            continue;
        }
        const choice = dependencies.selectConflict
            ? await dependencies.selectConflict(`common/mcp.yaml#${name}`, unique.map((copy) => copy.sourcePath))
            : options.yes || options.dryRun || !process.stdin.isTTY ? undefined : await selectConflictInTerminal(`MCP ${name}`, unique.map((copy) => copy.sourcePath));
        if (choice === undefined || !unique[choice]) {
            warnings.push(`Skipped conflicting MCP ${name}; choose an authoritative source interactively.`);
            continue;
        }
        servers[name] = unique[choice].value;
    }
    const sourcePath = mcpFiles.map((file) => file.sourcePath).join(', ');
    return [...files.filter((file) => file.repositoryPath !== 'common/mcp.yaml'), { sourcePath, repositoryPath: 'common/mcp.yaml', content: yaml.stringify({ servers }), ownership: 'managed' }];
}
function withoutOverrides(value) {
    const copy = { ...value };
    delete copy.overrides;
    return copy;
}
function stableValue(value) {
    if (Array.isArray(value))
        return `[${value.map(stableValue).join(',')}]`;
    if ((0, objects_1.isRecord)(value))
        return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableValue(value[key])}`).join(',')}}`;
    return JSON.stringify(value);
}
async function resolveCanonicalConflicts(repositoryRoot, files, dependencies, options, warnings) {
    const result = [];
    const groups = new Map();
    for (const file of files)
        groups.set(file.repositoryPath, [...(groups.get(file.repositoryPath) ?? []), file]);
    for (const [repositoryPath, candidates] of groups) {
        if (repositoryPath === 'common/mcp.yaml') {
            result.push(...candidates);
            continue;
        }
        const repositoryFile = path.join(repositoryRoot, ...repositoryPath.split('/'));
        const candidatesWithRepository = repositoryPath === 'common/AGENTS.md' && fs.existsSync(repositoryFile)
            ? [{
                    sourcePath: repositoryFile,
                    repositoryPath,
                    content: fs.readFileSync(repositoryFile, 'utf8'),
                    ownership: 'managed',
                }, ...candidates]
            : candidates;
        const unique = candidatesWithRepository.filter((candidate, index) => candidatesWithRepository.findIndex((other) => sameContent(other.content, candidate.content)) === index);
        if (unique.length === 1) {
            result.push(unique[0]);
            continue;
        }
        if (repositoryPath === 'common/AGENTS.md'
            && unique.every((candidate) => typeof candidate.content === 'string')) {
            result.push({
                ...unique[0],
                sourcePath: unique.map((candidate) => candidate.sourcePath).join(', '),
                content: mergeCanonicalRules(unique.map((candidate) => candidate.content)),
            });
            continue;
        }
        const labels = unique.map((candidate) => candidate.sourcePath);
        const choice = dependencies.selectConflict
            ? await dependencies.selectConflict(repositoryPath, labels)
            : options.yes || options.dryRun || !process.stdin.isTTY
                ? undefined
                : await selectConflictInTerminal(repositoryPath, labels);
        if (choice === undefined || !unique[choice]) {
            warnings.push(`Skipped conflicting managed capture ${repositoryPath}; choose an authoritative source interactively.`);
            continue;
        }
        result.push(unique[choice]);
    }
    return result;
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
function buildCapturePlan(repositoryPath, files, warnings) {
    const planned = new Map();
    for (const file of files) {
        const contentBuffer = toBuffer(file.content);
        if (!contentBuffer.subarray(0, Math.min(contentBuffer.length, 8_192)).includes(0)) {
            const findings = (0, sanitize_1.scanTextForSecrets)(contentBuffer.toString('utf8'));
            if (findings.length > 0)
                throw new Error(`Blocked ${file.sourcePath}: suspected plaintext secret (${findings.join(', ')}).`);
        }
        const destinationPath = path.join(repositoryPath, ...file.repositoryPath.split('/'));
        const previous = planned.get(destinationPath);
        if (previous && !sameContent(previous.content, file.content) && file.repositoryPath !== 'common/mcp.yaml') {
            warnings.push(`Skipped conflict for ${file.repositoryPath}: ${previous.sourcePath} vs ${file.sourcePath}`);
            continue;
        }
        const existingBuffer = previous
            ? toBuffer(previous.content)
            : fs.existsSync(destinationPath) ? fs.readFileSync(destinationPath) : undefined;
        const content = mergeWithRepository(file, existingBuffer);
        if (existingBuffer?.equals(toBuffer(content)))
            continue;
        planned.set(destinationPath, {
            ...file,
            content,
            change: fs.existsSync(destinationPath) ? 'modify' : 'add',
            destinationPath,
        });
    }
    return [...planned.values()];
}
function mergeWithRepository(file, existingBuffer) {
    if (!existingBuffer)
        return file.content;
    if (Buffer.isBuffer(file.content))
        return file.content;
    const existingContent = existingBuffer.toString('utf8');
    const format = getStructuredFormat(file.repositoryPath);
    if (file.ownership === 'native' && format) {
        if (format === 'json') {
            const existingValue = JSON.parse(existingContent);
            const capturedValue = JSON.parse(file.content);
            if (!(0, objects_1.isRecord)(existingValue) || !(0, objects_1.isRecord)(capturedValue))
                return file.content;
        }
        const existing = (0, structured_config_1.parseStructuredObject)(existingContent, format, file.repositoryPath);
        const captured = (0, structured_config_1.parseStructuredObject)(file.content, format, file.repositoryPath);
        const merged = (0, objects_1.mergeRecords)(existing, captured);
        for (const localPath of file.localPaths ?? [])
            (0, structured_config_1.deleteObjectPath)(merged, localPath);
        return (0, structured_config_1.stringifyStructuredObject)(merged, format);
    }
    if (file.repositoryPath === 'common/mcp.yaml') {
        const captured = yaml.parse(file.content);
        if (!(0, objects_1.isRecord)(captured))
            throw new Error('common/mcp.yaml must contain a YAML object.');
        return file.content;
    }
    return file.content;
}
function applyCaptureTransaction(plan) {
    const originals = new Map();
    try {
        for (const file of plan) {
            originals.set(file.destinationPath, fs.existsSync(file.destinationPath) ? fs.readFileSync(file.destinationPath) : undefined);
            fs.mkdirSync(path.dirname(file.destinationPath), { recursive: true });
            const temp = `${file.destinationPath}.mcv-${process.pid}.tmp`;
            fs.writeFileSync(temp, file.content);
            fs.renameSync(temp, file.destinationPath);
        }
    }
    catch (error) {
        for (const [destination, original] of originals) {
            if (original === undefined)
                fs.rmSync(destination, { force: true });
            else
                fs.writeFileSync(destination, original);
        }
        throw error;
    }
}
function getStructuredFormat(repositoryPath) {
    if (repositoryPath.endsWith('.json'))
        return 'json';
    if (repositoryPath.endsWith('.yaml') || repositoryPath.endsWith('.yml'))
        return 'yaml';
    if (repositoryPath.endsWith('.toml'))
        return 'toml';
    return undefined;
}
function resolveManifestVariables(variables, context) {
    const platform = context.platform;
    const key = platform === 'win32' ? 'windows' : platform === 'darwin' ? 'macos' : 'linux';
    return Object.fromEntries(Object.entries(variables ?? {}).flatMap(([name, declaration]) => {
        const value = typeof declaration === 'string' ? declaration : (0, objects_1.isRecord)(declaration) && typeof declaration[key] === 'string' ? declaration[key] : undefined;
        return value ? [[name, value.replace(/\$\{HOME\}/g, context.homeDir)]] : [];
    }));
}
function publicPlan(file) {
    return { change: file.change, ownership: file.ownership, repositoryPath: file.repositoryPath, sourcePath: file.sourcePath, bytes: toBuffer(file.content).length };
}
function toBuffer(content) { return Buffer.isBuffer(content) ? content : Buffer.from(content); }
function sameContent(left, right) { return toBuffer(left).equals(toBuffer(right)); }
async function confirmInTerminal() {
    const prompt = (0, promises_1.createInterface)({ input: process.stdin, output: process.stdout });
    try {
        return /^(y|yes)$/i.test((await prompt.question('Write these changes to the repository? [y/N] ')).trim());
    }
    finally {
        prompt.close();
    }
}
async function selectConflictInTerminal(name, candidates) {
    const prompt = (0, promises_1.createInterface)({ input: process.stdin, output: process.stdout });
    try {
        console.log(`Conflict: ${name}`);
        candidates.forEach((candidate, index) => console.log(`  ${index + 1}. ${candidate}`));
        const answer = Number(await prompt.question('Choose authoritative source (blank to skip): '));
        return Number.isInteger(answer) && answer > 0 && answer <= candidates.length ? answer - 1 : undefined;
    }
    finally {
        prompt.close();
    }
}
