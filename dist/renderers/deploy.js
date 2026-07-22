"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderDeployPlanPlain = renderDeployPlanPlain;
exports.renderDeployResultPlain = renderDeployResultPlain;
function renderDeployPlanPlain(plan) {
    const lines = [`Deploy Plan: ${plan.repositoryPath ?? 'not bound'}`];
    let currentGroup = '';
    for (const change of plan.changes.filter((item) => item.group === 'standard')) {
        const group = `${change.ide}/${change.capability}`;
        if (group !== currentGroup) {
            lines.push(`${displayIde(change.ide)} / ${displayCapability(change.capability)}`);
            currentGroup = group;
        }
        lines.push(...renderChange(change));
    }
    const advanced = plan.changes.filter((change) => change.group === 'advanced');
    if (advanced.length > 0) {
        lines.push('Advanced Cleanup (not selected by default)');
        for (const change of advanced) {
            lines.push(`  ${displayIde(change.ide)} / ${displayCapability(change.capability)}`);
            lines.push(...renderChange(change));
        }
    }
    if (plan.changes.length === 0 && plan.status === 'planned') {
        lines.push('No configuration changes to deploy.');
    }
    lines.push(`Summary: ${plan.changes.length} item(s).`);
    for (const issue of plan.issues) {
        lines.push(`[${issue.severity}] ${issue.code}: ${issue.message}`);
    }
    for (const action of plan.nextActions)
        lines.push(`Next: ${action}`);
    return lines;
}
function renderDeployResultPlain(result) {
    if (result.status === 'succeeded') {
        return [`Deployed ${result.data?.appliedChangeIds.length ?? 0} selected item(s) from ${result.repositoryPath}.`];
    }
    const lines = [`Deploy ${result.status}.`];
    for (const issue of result.issues)
        lines.push(`[${issue.severity}] ${issue.code}: ${issue.message}`);
    if (result.status === 'failed')
        lines.push(`Error: ${result.error.message}`);
    for (const action of result.nextActions)
        lines.push(`Next: ${action}`);
    return lines;
}
function renderChange(change) {
    const strategy = change.strategy === 'replace-entire-file'
        ? 'replace entire file'
        : 'managed merge';
    const lines = [
        `  [${change.change}] ${change.name} (${change.id}) [${strategy}]${change.defaultSelected ? ' [selected]' : ' [not selected]'}`,
    ];
    if (change.preview.kind === 'binary') {
        lines.push(`    ${change.targetPath}: binary, ${change.preview.bytes} bytes, sha256 ${change.preview.sha256}`);
    }
    else {
        lines.push(`    ${change.targetPath}:`);
        for (const line of change.preview.diff.split('\n'))
            lines.push(`      ${line}`);
    }
    return lines;
}
function displayIde(ide) {
    if (ide === 'claude-code')
        return 'Claude Code';
    return ide.charAt(0).toUpperCase() + ide.slice(1);
}
function displayCapability(capability) {
    if (capability === 'rules')
        return 'Shared Rules';
    if (capability === 'skills')
        return 'Skills';
    if (capability === 'mcp')
        return 'MCP';
    return 'IDE-native Configuration';
}
