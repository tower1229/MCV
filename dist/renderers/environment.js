"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderEnvironmentPlain = renderEnvironmentPlain;
function renderEnvironmentPlain(report) {
    return report.environments.flatMap((environment) => [
        `${environment.name}: ${environment.detected ? 'detected' : 'not detected'}`,
        ...[...environment.configDirectories, ...environment.configFiles].map((configPath) => `[${configPath.exists ? 'found' : 'missing'}] ${configPath.path}`),
    ]);
}
