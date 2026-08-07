import * as fs from 'fs';
import * as path from 'path';
import { isRecord } from '../utils/objects.js';
import { atomicWriteFile } from '../utils/files.js';
import { parameterizeConfig } from '../utils/parameterize.js';
import { deleteObjectPath } from '../utils/structured-config.js';
import { resolvePortableValue } from '../utils/variables.js';
import { CLAUDE_CODE_MANAGED_PATHS } from './overlay-policies.js';
import { readCanonicalSource, repositoryFileForPlatform } from './adapter-utils.js';
const JSON_CAPTURE_POLICIES = {
    'user-settings': {
        repositoryPath: 'ide/claude-code/native/settings.json',
        managedPaths: new Set(CLAUDE_CODE_MANAGED_PATHS),
        localPaths: new Set(),
    },
    'user-state': {
        repositoryPath: 'ide/claude-code/native/.claude.json',
        managedPaths: new Set(CLAUDE_CODE_MANAGED_PATHS),
        localPaths: new Set([
            '$.projects', '$.clientDataCache', '$.firstStartTime', '$.githubRepoPaths',
            '$.hasCompletedOnboarding', '$.hasIdeOnboardingBeenShown', '$.ideHintShownCount',
            '$.lastOnboardingVersion', '$.lastReleaseNotesSeen', '$.changelogLastFetched',
            '$.machineID', '$.userID', '$.metricsStatusCache', '$.migrationVersion',
            '$.numStartups', '$.promptQueueUseCount', '$.seenNotifications', '$.skillUsage',
            '$.tipsHistory', '$.installMethod', '$.officialMarketplaceAutoInstallAttempted',
            '$.officialMarketplaceAutoInstalled', '$.opusProMigrationComplete',
            '$.sonnet1m45MigrationComplete', '$.shiftEnterKeyBindingInstalled',
        ]),
    },
};
export class ClaudeCodeNativeFileHandler {
    root(context) {
        return context.env?.CLAUDE_CONFIG_DIR || path.join(context.homeDir, '.claude');
    }
    discoverDirectories(context) {
        const configRoot = this.root(context);
        return [
            {
                id: 'config-root',
                path: configRoot,
                exists: fs.existsSync(configRoot),
            },
        ];
    }
    async discoverFiles(context) {
        const candidates = [
            {
                id: 'user-settings',
                path: path.join(this.root(context), 'settings.json'),
            },
            {
                id: 'user-instructions',
                path: path.join(this.root(context), 'CLAUDE.md'),
            },
            {
                id: 'user-state',
                path: path.join(context.homeDir, '.claude.json'),
            },
        ];
        return candidates.map((candidate) => ({
            ...candidate,
            exists: fs.existsSync(candidate.path),
        }));
    }
    async capture(files, context) {
        const capturedFiles = [];
        const managedFiles = [];
        const managedFields = [];
        const warnings = [];
        let parameterizedPathCount = 0;
        let excludedFileCount = 0;
        for (const file of files.filter((candidate) => candidate.exists)) {
            if (file.id === 'user-instructions') {
                const parameterized = parameterizeConfig(fs.readFileSync(file.path, 'utf8'), context);
                parameterizedPathCount += parameterized.parameterizedPathCount;
                managedFiles.push({
                    id: file.id,
                    sourcePath: file.path,
                    content: parameterized.value,
                });
                continue;
            }
            const policy = JSON_CAPTURE_POLICIES[file.id];
            if (!policy)
                continue;
            const parsed = this.readJsonObject(file.path, warnings);
            if (!parsed)
                continue;
            const nativeFields = {};
            for (const [key, value] of Object.entries(parsed)) {
                const objectPath = `$.${key}`;
                if (policy.localPaths.has(objectPath))
                    continue;
                if (policy.managedPaths.has(objectPath)) {
                    const parameterized = parameterizeConfig({ [key]: value }, context);
                    parameterizedPathCount += parameterized.parameterizedPathCount;
                    managedFields.push({
                        sourcePath: file.path,
                        path: objectPath,
                        value: parameterized.value[key],
                    });
                }
                else {
                    nativeFields[key] = value;
                }
            }
            if (Object.keys(nativeFields).length > 0) {
                const parameterized = parameterizeConfig(nativeFields, context);
                parameterizedPathCount += parameterized.parameterizedPathCount;
                capturedFiles.push({
                    sourcePath: file.path,
                    repositoryPath: policy.repositoryPath,
                    content: `${JSON.stringify(parameterized.value, null, 2)}\n`,
                    ownership: 'native',
                    localPaths: [...policy.localPaths],
                });
            }
        }
        return {
            files: capturedFiles,
            managedFiles,
            managedFields,
            summary: {
                fileCount: capturedFiles.length,
                parameterizedPathCount,
                excludedFileCount,
            },
            warnings,
        };
    }
    async deploy(repositoryPath, context) {
        const mappings = [
            {
                fileId: 'user-settings',
                sourcePath: repositoryFileForPlatform(repositoryPath, 'ide/claude-code/native/settings.json', context),
            },
            {
                fileId: 'user-state',
                sourcePath: repositoryFileForPlatform(repositoryPath, 'ide/claude-code/native/.claude.json', context),
            },
        ];
        const files = mappings.flatMap(({ fileId, sourcePath }) => {
            if (!fs.existsSync(sourcePath))
                return [];
            const file = projectClaudeCodeNativeAsset(fileId, fs.readFileSync(sourcePath), context);
            return file ? [file] : [];
        });
        return {
            files,
            write: (file) => atomicWriteFile(file.targetPath, file.content),
        };
    }
    async readCanonical(repositoryPath, context) {
        return readCanonicalSource(repositoryPath, context);
    }
    readDeployTarget(targetPath) {
        if (!fs.existsSync(targetPath))
            return undefined;
        return { targetPath, content: fs.readFileSync(targetPath) };
    }
    readCanonicalSkillFiles(sourceRoot, currentDirectory) {
        return fs.readdirSync(currentDirectory, { withFileTypes: true }).flatMap((entry) => {
            const sourcePath = path.join(currentDirectory, entry.name);
            if (entry.isDirectory()) {
                return this.readCanonicalSkillFiles(sourceRoot, sourcePath);
            }
            if (!entry.isFile())
                return [];
            return [{
                    relativePath: path.relative(sourceRoot, sourcePath),
                    content: fs.readFileSync(sourcePath),
                }];
        });
    }
    readJsonObject(filePath, warnings) {
        try {
            const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
            if (!isRecord(parsed)) {
                warnings.push(`Skipped ${filePath}: expected a JSON object.`);
                return undefined;
            }
            return parsed;
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            warnings.push(`Skipped ${filePath}: ${message}`);
            return undefined;
        }
    }
}
export function projectClaudeCodeNativeAsset(fileId, content, context) {
    const policy = JSON_CAPTURE_POLICIES[fileId];
    if (!policy)
        return undefined;
    const configRoot = context.env?.CLAUDE_CONFIG_DIR || path.join(context.homeDir, '.claude');
    const targetPath = fileId === 'user-state'
        ? path.join(context.homeDir, '.claude.json')
        : path.join(configRoot, 'settings.json');
    const parsed = JSON.parse(content.toString('utf8'));
    if (!isRecord(parsed)) {
        throw new Error(`native:claude-code/${fileId} must contain a JSON object.`);
    }
    const resolved = resolvePortableValue(parsed, context.variables ?? {}, context.platform);
    for (const localPath of policy.localPaths)
        deleteObjectPath(resolved, localPath);
    return {
        targetPath,
        content: `${JSON.stringify(resolved, null, 2)}\n`,
    };
}
