"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderRepositoryPlain = renderRepositoryPlain;
exports.renderBindPlain = renderBindPlain;
exports.renderUnbindPlain = renderUnbindPlain;
exports.renderInitPlain = renderInitPlain;
exports.renderMigrationPlain = renderMigrationPlain;
function renderRepositoryPlain(report) {
    const lines = [
        `Repository: ${report.repositoryPath ?? 'not bound'}`,
        `Repository ID: ${report.repositoryId ?? 'unknown'}`,
        `Schema version: ${report.repositorySchemaVersion ?? 'unknown'}`,
        `Validity: ${report.valid ? 'valid' : 'invalid'}`,
    ];
    if (report.git) {
        lines.push(`Git: ${report.git.clean ? 'clean' : 'dirty'}${report.git.branch ? ` (${report.git.branch})` : ''}`);
    }
    return appendIssuesAndActions(lines, report);
}
function renderBindPlain(result) {
    if (result.status === 'succeeded') {
        return [`Bound this device to ${result.repositoryPath}.`];
    }
    return appendIssuesAndActions([], result);
}
function renderUnbindPlain(result) {
    if (result.status !== 'succeeded')
        return appendIssuesAndActions([], result);
    return appendIssuesAndActions(['Removed the MCV Repository binding from this device.'], result);
}
function renderInitPlain(contract) {
    if (contract.status === 'planned') {
        const lines = [
            `Init Plan: ${contract.repositoryPath}`,
            ...contract.changes.map((change) => `[${change.kind}] ${change.path ?? change.repositoryPath}`),
        ];
        return appendIssuesAndActions(lines, contract);
    }
    if (contract.status === 'succeeded') {
        return [`Initialized and bound MCV Repository at ${contract.repositoryPath}.`];
    }
    return appendIssuesAndActions([], contract);
}
function renderMigrationPlain(contract) {
    if (contract.status === 'planned') {
        const lines = [
            `Migration Plan: ${contract.repositoryPath}`,
            ...contract.changes.map((change) => {
                if (change.kind === 'move')
                    return `[move] ${change.sourcePath} -> ${change.targetPath}`;
                if (change.id === 'schema-version')
                    return `[modify] ${change.path}: schema v${change.before} -> v${change.after}`;
                return `[${change.kind}] ${change.path}`;
            }),
        ];
        return appendIssuesAndActions(lines, contract);
    }
    if (contract.status === 'succeeded') {
        return [
            `Migrated Repository at ${contract.repositoryPath} to schema v${contract.data?.repositorySchemaVersion}.`,
            `Verified backup: ${contract.data?.backupPath}`,
        ];
    }
    return appendIssuesAndActions([], contract);
}
function appendIssuesAndActions(lines, contract) {
    return [
        ...lines,
        ...contract.issues.map((issue) => `[${issue.severity}] ${issue.code}: ${issue.message}`),
        ...contract.nextActions.map((action) => `Next: ${action}`),
    ];
}
