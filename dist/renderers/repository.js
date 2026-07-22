"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderRepositoryPlain = renderRepositoryPlain;
exports.renderBindPlain = renderBindPlain;
exports.renderUnbindPlain = renderUnbindPlain;
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
    return appendIssuesAndActions(['Removed the MCV Repository binding from this device.'], result);
}
function appendIssuesAndActions(lines, contract) {
    return [
        ...lines,
        ...contract.issues.map((issue) => `[${issue.severity}] ${issue.code}: ${issue.message}`),
        ...contract.nextActions.map((action) => `Next: ${action}`),
    ];
}
