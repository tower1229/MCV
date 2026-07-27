import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Box, Text } from 'ink';
export function ShellView({ state }) {
    const { page } = state;
    const title = page.route === 'overview' ? 'Overview' : 'Environment Details';
    return (_jsxs(Box, { flexDirection: "column", children: [_jsx(Text, { bold: true, children: "MCV" }), _jsx(Text, { children: title }), _jsx(Text, { children: " " }), page.status === 'loading' && _jsxs(Text, { children: ["Loading ", title, "..."] }), page.status === 'failure' && _jsxs(Text, { color: "red", children: ["Failed: ", page.message] }), page.status === 'ready' && page.route === 'overview' && (_jsx(Overview, { report: page.report })), page.status === 'ready' && page.route === 'environment' && (_jsx(EnvironmentDetails, { report: page.report })), _jsx(Text, { children: " " }), _jsx(Text, { dimColor: true, children: page.route === 'overview'
                    ? 'e Environment Details   q Quit   Ctrl+C Cancel'
                    : 'Escape Overview   q Quit   Ctrl+C Cancel' })] }));
}
function Overview({ report }) {
    const pending = report.pendingDeployment;
    const local = report.postDeployLocalState;
    return (_jsxs(Box, { flexDirection: "column", children: [_jsxs(Text, { children: ["Repository: ", report.repository.path] }), report.repository.git && (_jsxs(Text, { children: ["Git: ", report.repository.git.clean
                        ? 'clean'
                        : `${report.repository.git.uncommittedChanges} uncommitted changes`] })), _jsxs(Text, { children: ["Pending deployment: ", pending.total, " changes (", pending.add, " add,", ' ', pending.modify, " modify, ", pending.delete, " delete)"] }), _jsxs(Text, { children: ["Local managed state: ", local.drift, " changed, ", local.missing, " missing"] }), _jsxs(Text, { children: ["Environment: ", report.environment.missingVariables.length, " missing variables"] }), _jsx(Text, { children: "IDE support:" }), report.environment.ideSupport.map((ide) => (_jsxs(Text, { children: ['  ', ide.name, ": ", ide.enabled ? 'enabled' : 'disabled', ",", ' ', ide.detected ? 'detected' : 'not detected'] }, ide.id))), _jsxs(Text, { children: ["Last operation: ", report.lastOperation
                        ? `${report.lastOperation.kind} · ${report.lastOperation.success ? 'success' : 'failure'}`
                        : 'none'] })] }));
}
function EnvironmentDetails({ report }) {
    return (_jsxs(Box, { flexDirection: "column", children: [report.environments.map((environment) => (_jsxs(Box, { flexDirection: "column", children: [_jsxs(Text, { children: [environment.name, ": ", environment.detected ? 'detected' : 'not detected'] }), [...environment.configDirectories, ...environment.configFiles].map((item) => (_jsxs(Text, { children: ['  ', "[", item.exists ? 'found' : 'missing', "] ", item.path] }, `${environment.id}:${item.path}`)))] }, environment.id))), report.missingVariables.length > 0 && (_jsxs(Text, { children: ["Missing variables: ", report.missingVariables.join(', ')] }))] }));
}
