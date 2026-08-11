import { fact, status } from '../presentation/builders.js';
export function renderEnvironmentDocument(report) {
    const foundPathCount = report.environments.reduce((total, environment) => total + [...environment.configDirectories, ...environment.configFiles]
        .filter((configPath) => configPath.exists).length, 0);
    const totalPathCount = report.environments.reduce((total, environment) => total + environment.configDirectories.length + environment.configFiles.length, 0);
    return {
        operation: 'discover',
        title: 'Environment Report',
        summary: [],
        overflowSummary: [
            status('information', `${report.environments.filter((environment) => environment.detected).length}/${report.environments.length} IDEs detected.`),
            status(foundPathCount > 0 ? 'success' : 'muted', `${foundPathCount} configuration paths found; ${totalPathCount - foundPathCount} optional paths absent.`),
        ],
        details: report.environments.flatMap((environment) => [
            status(environment.detected ? 'success' : 'muted', `${environment.name}: ${environment.detected ? 'detected' : 'not detected'}`),
            ...[...environment.configDirectories, ...environment.configFiles].map((configPath) => fact(configPath.exists ? 'Found' : 'Optional', configPath.path, configPath.exists ? 'success' : 'muted')),
        ]),
        nextActions: report.nextActions,
        detailPolicy: 'overflow',
    };
}
export function renderEnvironmentPlain(report) {
    return report.environments.flatMap((environment) => [
        `${environment.name}: ${environment.detected ? 'detected' : 'not detected'}`,
        ...[...environment.configDirectories, ...environment.configFiles].map((configPath) => `[${configPath.exists ? 'found' : 'missing'}] ${configPath.path}`),
    ]);
}
