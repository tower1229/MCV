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
exports.restoreLatestBackup = restoreLatestBackup;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const files_1 = require("../utils/files");
const objects_1 = require("../utils/objects");
const state_1 = require("../utils/state");
function restoreLatestBackup() {
    const stateDirectory = path.dirname((0, state_1.getStateFilePath)());
    const latest = findLatestBackup(path.join(stateDirectory, 'backups'));
    if (!latest)
        throw new Error('No deployment backup found.');
    for (const file of latest.manifest.files) {
        if (!file.afterHash)
            continue;
        if (!fs.existsSync(file.originalPath) || (0, files_1.hashFile)(file.originalPath) !== file.afterHash) {
            throw new Error(`Refusing to restore because the deployed file changed afterwards: ${file.originalPath}`);
        }
    }
    const restoreBackup = backupCurrentState(stateDirectory, latest.manifest.files);
    const originals = new Map();
    try {
        for (const file of latest.manifest.files) {
            originals.set(file.originalPath, fs.existsSync(file.originalPath) ? fs.readFileSync(file.originalPath) : undefined);
            const action = file.action ?? 'modify';
            if (action === 'add') {
                fs.rmSync(file.originalPath, { force: true });
                console.log(`[removed] ${file.originalPath}`);
                continue;
            }
            if (!file.backupPath)
                throw new Error(`Backup path is missing for ${file.originalPath}.`);
            const sourcePath = resolveBackupPath(latest.directory, file.backupPath);
            (0, files_1.atomicWriteFile)(file.originalPath, fs.readFileSync(sourcePath));
            console.log(`[restored] ${file.originalPath}`);
        }
    }
    catch (error) {
        for (const [targetPath, content] of originals) {
            if (content === undefined)
                fs.rmSync(targetPath, { force: true });
            else
                (0, files_1.atomicWriteFile)(targetPath, content);
        }
        throw error;
    }
    const state = (0, state_1.readState)();
    delete state.baselineSnapshot;
    delete state.managedInventory;
    state.lastOperation = { kind: 'restore', time: new Date().toISOString(), success: true };
    (0, state_1.writeState)(state);
    console.log(`Current pre-restore state saved to ${restoreBackup}.`);
    console.log(`Restored ${latest.manifest.files.length} file(s) from the latest backup.`);
}
function backupCurrentState(stateDirectory, files) {
    const root = path.join(stateDirectory, 'restore-backups');
    fs.mkdirSync(root, { recursive: true });
    const directory = fs.mkdtempSync(path.join(root, 'before-restore-'));
    const entries = files.flatMap((file, index) => {
        if (!fs.existsSync(file.originalPath))
            return [];
        const backupPath = path.join('files', `${index}-${path.basename(file.originalPath)}`);
        fs.mkdirSync(path.dirname(path.join(directory, backupPath)), { recursive: true });
        fs.copyFileSync(file.originalPath, path.join(directory, backupPath));
        return [{ originalPath: file.originalPath, backupPath, hash: (0, files_1.hashFile)(file.originalPath) }];
    });
    (0, files_1.atomicWriteTextFile)(path.join(directory, 'manifest.json'), `${JSON.stringify({ createdAt: new Date().toISOString(), files: entries }, null, 2)}\n`);
    return directory;
}
function resolveBackupPath(directory, backupPath) {
    const sourcePath = path.resolve(directory, backupPath);
    const relativePath = path.relative(directory, sourcePath);
    if (relativePath.startsWith('..') || path.isAbsolute(relativePath))
        throw new Error(`Backup file path escapes its backup directory: ${backupPath}`);
    if (!fs.existsSync(sourcePath))
        throw new Error(`Backup file is missing: ${sourcePath}`);
    return sourcePath;
}
function findLatestBackup(backupRoot) {
    if (!fs.existsSync(backupRoot))
        return undefined;
    return fs.readdirSync(backupRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory()).flatMap((entry) => {
        const directory = path.join(backupRoot, entry.name);
        const manifest = readBackupManifest(path.join(directory, 'manifest.json'));
        return manifest ? [{ directory, manifest }] : [];
    }).sort((left, right) => Date.parse(right.manifest.createdAt) - Date.parse(left.manifest.createdAt))[0];
}
function readBackupManifest(manifestPath) {
    if (!fs.existsSync(manifestPath))
        return undefined;
    try {
        const value = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        if (!(0, objects_1.isRecord)(value) || typeof value.createdAt !== 'string' || !Array.isArray(value.files) || !value.files.every((file) => (0, objects_1.isRecord)(file) && typeof file.originalPath === 'string'))
            return undefined;
        return value;
    }
    catch {
        return undefined;
    }
}
