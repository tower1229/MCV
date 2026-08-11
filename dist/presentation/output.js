import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { assertPlainTextSafe, renderPresentationBlocks, renderPresentationDocument, UnsafePresentationContentError, } from './render.js';
import { resolveOutputCapability, stylePresentationText } from './theme.js';
import { status } from './builders.js';
const REVIEW_MAX_AGE_MS = 24 * 60 * 60 * 1_000;
const REVIEW_MAX_FILES = 10;
const REVIEW_MAX_TOTAL_BYTES = 50 * 1024 * 1024;
const INLINE_MAX_LINES = 40;
const INLINE_MAX_BYTES = 8 * 1024;
export function presentDocument(context, document, options = {}) {
    const plainDetails = renderPresentationDocument(document, 'details', resolveOutputCapability({ forcePlain: true }));
    const hasDetails = plainDetails.length > 0;
    if (!hasDetails) {
        printDocumentRegion(document, 'summary');
        printNextActions(document.nextActions);
        return {};
    }
    if (document.detailPolicy === 'progressive') {
        return presentProgressiveDocument(context, document, plainDetails, options);
    }
    const needsReviewFile = document.detailPolicy === 'review' || exceedsInlineBudget(plainDetails);
    if (!needsReviewFile) {
        printDocumentRegion(document, 'summary');
        printDocumentRegion(document, 'details', false);
        printNextActions(document.nextActions);
        return {};
    }
    printDocumentRegion(document, document.detailPolicy === 'overflow' ? 'overflowSummary' : 'summary');
    const artifact = tryWriteReviewArtifact(context, document);
    if (artifact.reviewPath)
        printReviewPath(artifact.reviewPath);
    if (artifact.error)
        printReviewFailure(artifact.error);
    if (options.verbose || artifact.reviewPath === undefined) {
        printText(artifact.fallback ?? renderTerminalDetails(document));
    }
    printNextActions(document.nextActions);
    return artifact.reviewPath ? { reviewPath: artifact.reviewPath } : {};
}
function presentProgressiveDocument(context, document, plainDetails, options) {
    const needsReviewFile = exceedsInlineBudget(plainDetails);
    const artifact = needsReviewFile ? tryWriteReviewArtifact(context, document) : {};
    if (artifact.error)
        printReviewFailure(artifact.error);
    if (options.verbose || (needsReviewFile && artifact.reviewPath === undefined)) {
        printText(artifact.fallback ?? renderTerminalDetails(document));
    }
    else {
        printDocumentRegion(document, 'summary');
    }
    if (artifact.reviewPath)
        printReviewPath(artifact.reviewPath);
    printNextActions(document.nextActions);
    return artifact.reviewPath ? { reviewPath: artifact.reviewPath } : {};
}
function tryWriteReviewArtifact(context, document) {
    try {
        return { reviewPath: writeReviewArtifact(context, document) };
    }
    catch (error) {
        const normalized = error instanceof Error ? error : new Error(String(error));
        return {
            error: normalized,
            fallback: error instanceof UnsafePresentationContentError ? error.fallback : undefined,
        };
    }
}
export function writeReviewArtifact(context, document) {
    const now = new Date();
    const content = renderReviewArtifact(document, now);
    assertPlainTextSafe(content);
    const reviewDirectory = getReviewDirectory(context);
    ensurePrivateDirectory(reviewDirectory);
    removeExpiredReviewFiles(reviewDirectory, now.getTime());
    const timestamp = now.toISOString().replaceAll(':', '').replace('.', '-');
    const name = `${document.operation}-${timestamp}-${crypto.randomUUID()}.txt`;
    const targetPath = path.join(reviewDirectory, name);
    const temporaryPath = path.join(reviewDirectory, `.${name}.${crypto.randomUUID()}.tmp`);
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
function renderReviewArtifact(document, now) {
    const details = renderPresentationDocument(document, 'details', resolveOutputCapability({ forcePlain: true }));
    return [
        `MCV ${document.title}`,
        `Created: ${now.toISOString()}`,
        'Purpose: local review only; this file cannot be replayed or used as Apply authorization.',
        'Privacy: this file may contain plaintext configuration values. Keep it private.',
        '',
        details,
        '',
    ].join('\n');
}
function printDocumentRegion(document, region, includeTitle = true) {
    const capability = resolveOutputCapability({
        isTTY: Boolean(process.stdout.isTTY),
        columns: process.stdout.columns,
    });
    const body = renderPresentationDocument(document, region, capability);
    const title = includeTitle
        ? stylePresentationText(document.title, 'information', capability)
        : '';
    printText([title, body].filter(Boolean).join('\n'));
}
function renderTerminalDetails(document) {
    const capability = resolveOutputCapability({
        isTTY: Boolean(process.stdout.isTTY),
        columns: process.stdout.columns,
    });
    return renderPresentationDocument(document, 'details', capability);
}
export function presentDiagnostic(message) {
    const capability = resolveOutputCapability({
        isTTY: Boolean(process.stderr.isTTY),
        columns: process.stderr.columns,
    });
    console.error(renderPresentationBlocks([status('danger', message)], capability));
}
export function presentBlocks(blocks) {
    const capability = resolveOutputCapability({
        isTTY: Boolean(process.stdout.isTTY),
        columns: process.stdout.columns,
    });
    printText(renderPresentationBlocks(blocks, capability));
}
export function presentPrompt(message) {
    const capability = resolveOutputCapability({
        isTTY: Boolean(process.stdout.isTTY),
        columns: process.stdout.columns,
    });
    printText(renderPresentationBlocks([status('decision', message)], capability));
}
export function presentOutcome(title, message, role = 'information') {
    const capability = resolveOutputCapability({
        isTTY: Boolean(process.stdout.isTTY),
        columns: process.stdout.columns,
    });
    printText(`${stylePresentationText(title, 'information', capability)}\n${renderPresentationBlocks([status(role, message)], capability)}`);
}
export function presentReviewReference(reviewPath) {
    printReviewPath(reviewPath);
}
function printReviewFailure(error) {
    presentDiagnostic(`Could not create the local review file; printing full details instead. ${error.message}`);
}
function printNextActions(nextActions) {
    if (nextActions.length === 0)
        return;
    const capability = resolveOutputCapability({
        isTTY: Boolean(process.stdout.isTTY),
        columns: process.stdout.columns,
    });
    printText(renderPresentationBlocks(nextActions.map((action) => status('information', `Next: ${action}`)), capability));
}
function printReviewPath(reviewPath) {
    const capability = resolveOutputCapability({
        isTTY: Boolean(process.stdout.isTTY),
        columns: process.stdout.columns,
    });
    printText(renderPresentationBlocks([{
            kind: 'fact',
            label: 'Review',
            value: reviewPath,
            role: 'muted',
        }], capability));
}
function printText(value) {
    if (value)
        console.log(value);
}
function exceedsInlineBudget(plainDetails) {
    return plainDetails.split('\n').length > INLINE_MAX_LINES
        || Buffer.byteLength(plainDetails, 'utf8') > INLINE_MAX_BYTES;
}
function getReviewDirectory(context) {
    if (context.platform === 'win32') {
        const localAppData = context.env.LOCALAPPDATA || path.join(context.homeDir, 'AppData', 'Local');
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
function removeReviewFile(filePath) {
    try {
        fs.unlinkSync(filePath);
    }
    catch {
        // Retention is best-effort and must never hide the current operation output.
    }
}
