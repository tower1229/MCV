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
    const backupRoot = path.join(path.dirname((0, state_1.getStateFilePath)()), 'backups');
    const latest = findLatestBackup(backupRoot);
    if (!latest) {
        throw new Error('No deployment backup found.');
    }
    const files = latest.manifest.files.map((file) => {
        const sourcePath = path.resolve(latest.directory, file.backupPath);
        const relativePath = path.relative(latest.directory, sourcePath);
        if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
            throw new Error(`Backup file path escapes its backup directory: ${file.backupPath}`);
        }
        if (!fs.existsSync(sourcePath)) {
            throw new Error(`Backup file is missing: ${sourcePath}`);
        }
        return { targetPath: file.originalPath, content: fs.readFileSync(sourcePath) };
    });
    for (const file of files) {
        (0, files_1.atomicWriteFile)(file.targetPath, file.content);
        console.log(`[restored] ${file.targetPath}`);
    }
    console.log(`Restored ${files.length} file(s) from the latest backup.`);
}
function findLatestBackup(backupRoot) {
    if (!fs.existsSync(backupRoot))
        return undefined;
    return fs.readdirSync(backupRoot, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .flatMap((entry) => {
        const directory = path.join(backupRoot, entry.name);
        const manifest = readBackupManifest(path.join(directory, 'manifest.json'));
        return manifest ? [{ directory, manifest }] : [];
    })
        .sort((left, right) => Date.parse(right.manifest.createdAt) - Date.parse(left.manifest.createdAt))[0];
}
function readBackupManifest(manifestPath) {
    if (!fs.existsSync(manifestPath))
        return undefined;
    try {
        const value = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        if (!(0, objects_1.isRecord)(value)
            || typeof value.createdAt !== 'string'
            || Number.isNaN(Date.parse(value.createdAt))
            || !Array.isArray(value.files)
            || !value.files.every((file) => (0, objects_1.isRecord)(file)
                && typeof file.originalPath === 'string'
                && typeof file.backupPath === 'string')) {
            return undefined;
        }
        return value;
    }
    catch {
        return undefined;
    }
}
