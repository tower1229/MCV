import { styleText } from './color.js';
export function renderEnvironmentDocument(report) {
    const foundPathCount = report.environments.reduce((total, environment) => total + [...environment.configDirectories, ...environment.configFiles]
        .filter((configPath) => configPath.exists).length, 0);
    const totalPathCount = report.environments.reduce((total, environment) => total + environment.configDirectories.length + environment.configFiles.length, 0);
    return {
        operation: 'discover',
        title: 'Environment Report',
        summary: [],
        overflowSummary: [
            `Environment: ${report.environments.filter((environment) => environment.detected).length}/${report.environments.length} IDEs detected.`,
            `Configuration paths: ${foundPathCount} found, ${totalPathCount - foundPathCount} missing.`,
        ],
        details: renderEnvironmentPlain(report),
        nextActions: report.nextActions,
        detailPolicy: 'overflow',
    };
}
export function renderEnvironmentPlain(report) {
    return report.environments.flatMap((environment) => [
        `${environment.name}: ${environment.detected
            ? styleText('detected', 'green')
            : styleText('not detected', 'dim')}`,
        ...[...environment.configDirectories, ...environment.configFiles].map((configPath) => `[${configPath.exists
            ? styleText('found', 'green')
            : styleText('missing', 'dim')}] ${configPath.path}`),
    ]);
}
