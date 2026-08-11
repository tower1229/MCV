import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { styleText } from '../renderers/color.js';
const REVIEW_MAX_AGE_MS = 24 * 60 * 60 * 1_000;
const REVIEW_MAX_FILES = 10;
const REVIEW_MAX_TOTAL_BYTES = 50 * 1024 * 1024;
const INLINE_MAX_LINES = 40;
const INLINE_MAX_BYTES = 8 * 1024;
export function presentHumanDocument(context, document, options = {}) {
    if (document.details.length === 0) {
        for (const line of document.summary)
            console.log(line);
        printNextActions(document.nextActions);
        return {};
    }
    if (document.detailPolicy === 'progressive') {
        return presentProgressiveDocument(context, document, options);
    }
    const needsReviewFile = document.detailPolicy === 'review' || exceedsInlineBudget(document.details);
    if (!needsReviewFile) {
        for (const line of document.summary)
            console.log(line);
        for (const line of document.details)
            console.log(line);
        printNextActions(document.nextActions);
        return {};
    }
    const terminalSummary = document.detailPolicy === 'overflow'
        ? document.overflowSummary ?? document.summary
        : document.summary;
    for (const line of terminalSummary)
        console.log(line);
    let reviewPath;
    try {
        reviewPath = writeHumanReviewArtifact(context, document);
        printReviewPath(reviewPath);
    }
    catch (error) {
        console.error(`Could not create the local review file; printing full details instead. ${errorMessage(error)}`);
    }
    if (options.verbose || reviewPath === undefined) {
        for (const line of document.details)
            console.log(line);
    }
    printNextActions(document.nextActions);
    return reviewPath ? { reviewPath } : {};
}
function presentProgressiveDocument(context, document, options) {
    const needsReviewFile = exceedsInlineBudget(document.details);
    let reviewPath;
    if (needsReviewFile) {
        try {
            reviewPath = writeHumanReviewArtifact(context, document);
        }
        catch (error) {
            console.error(`Could not create the local review file; printing full details instead. ${errorMessage(error)}`);
        }
    }
    const output = options.verbose || (needsReviewFile && reviewPath === undefined)
        ? document.details
        : document.summary;
    for (const line of output)
        console.log(line);
    if (reviewPath) {
        printReviewPath(reviewPath);
    }
    printNextActions(document.nextActions);
    return reviewPath ? { reviewPath } : {};
}
export function writeHumanReviewArtifact(context, document) {
    const now = new Date();
    const reviewDirectory = getReviewDirectory(context);
    ensurePrivateDirectory(reviewDirectory);
    removeExpiredReviewFiles(reviewDirectory, now.getTime());
    const timestamp = now.toISOString().replaceAll(':', '').replace('.', '-');
    const name = `${document.operation}-${timestamp}-${crypto.randomUUID()}.txt`;
    const targetPath = path.join(reviewDirectory, name);
    const temporaryPath = path.join(reviewDirectory, `.${name}.${crypto.randomUUID()}.tmp`);
    const content = renderReviewArtifact(document, now);
    let fileDescriptor;
    try {
        fileDescriptor = fs.openSync(temporaryPath, 'wx', 0o600);
        fs.writeFileSync(fileDescriptor, content, 'utf8');
        fs.fsyncSync(fileDescriptor);
        fs.closeSync(fileDescriptor);
        fileDescriptor = undefined;
        fs.renameSync(temporaryPath, targetPath);
        if (context.platform !== 'win32')
            fs.chmodSync(targetPath, 0o600);
    }
    catch (error) {
        if (fileDescriptor !== undefined)
            fs.closeSync(fileDescriptor);
        try {
            fs.unlinkSync(temporaryPath);
        }
        catch {
            // The temporary file may not have been created.
        }
        throw error;
    }
    enforceReviewRetention(reviewDirectory, targetPath);
    return targetPath;
}
function getReviewDirectory(context) {
    if (context.platform === 'win32') {
        const localAppData = context.env.LOCALAPPDATA
            || path.join(context.homeDir, 'AppData', 'Local');
        return path.join(localAppData, 'mcv', 'reviews');
    }
    if (context.platform === 'darwin') {
        return path.join(context.homeDir, 'Library', 'Application Support', 'mcv', 'reviews');
    }
    const stateHome = context.env.XDG_STATE_HOME || path.join(context.homeDir, '.local', 'state');
    return path.join(stateHome, 'mcv', 'reviews');
}
function ensurePrivateDirectory(directoryPath) {
    fs.mkdirSync(directoryPath, { recursive: true, mode: 0o700 });
    const entry = fs.lstatSync(directoryPath);
    if (!entry.isDirectory() || entry.isSymbolicLink()) {
        throw new Error(`Review path is not a private directory: ${directoryPath}`);
    }
    if (process.platform !== 'win32')
        fs.chmodSync(directoryPath, 0o700);
}
function renderReviewArtifact(document, now) {
    return [
        `MCV ${document.title}`,
        `Created: ${now.toISOString()}`,
        'Purpose: local review only; this file cannot be replayed or used as Apply authorization.',
        'Privacy: this file may contain plaintext configuration values. Keep it private.',
        '',
        ...document.details,
        '',
    ].join('\n');
}
function removeExpiredReviewFiles(directoryPath, now) {
    for (const entry of reviewFiles(directoryPath)) {
        if (now - entry.mtimeMs > REVIEW_MAX_AGE_MS)
            removeReviewFile(entry.path);
    }
}
function enforceReviewRetention(directoryPath, protectedPath) {
    const entries = reviewFiles(directoryPath).sort((left, right) => right.mtimeMs - left.mtimeMs);
    let retainedCount = 0;
    let retainedBytes = 0;
    for (const entry of entries) {
        const isProtected = entry.path === protectedPath;
        const fits = retainedCount < REVIEW_MAX_FILES
            && retainedBytes + entry.size <= REVIEW_MAX_TOTAL_BYTES;
        if (isProtected || fits) {
            retainedCount += 1;
            retainedBytes += entry.size;
        }
        else {
            removeReviewFile(entry.path);
        }
    }
}
function reviewFiles(directoryPath) {
    const entries = [];
    for (const name of fs.readdirSync(directoryPath)) {
        if (!name.endsWith('.txt'))
            continue;
        const entryPath = path.join(directoryPath, name);
        let stats;
        try {
            stats = fs.lstatSync(entryPath);
        }
        catch {
            continue;
        }
        if (!stats.isFile() || stats.isSymbolicLink())
            continue;
        entries.push({ path: entryPath, mtimeMs: stats.mtimeMs, size: stats.size });
    }
    return entries;
}
function removeReviewFile(filePath) {
    try {
        fs.unlinkSync(filePath);
    }
    catch {
        // Retention is best-effort and must never hide the current operation output.
    }
}
function exceedsInlineBudget(lines) {
    if (lines.length > INLINE_MAX_LINES)
        return true;
    return Buffer.byteLength(lines.join('\n'), 'utf8') > INLINE_MAX_BYTES;
}
function printNextActions(nextActions) {
    for (const action of nextActions)
        console.log(`Next: ${action}`);
}
function printReviewPath(reviewPath) {
    console.log(`${styleText('Review', 'cyan')}      ${styleText(reviewPath, 'dim')}`);
}
function errorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}
