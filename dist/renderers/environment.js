"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderEnvironmentPlain = renderEnvironmentPlain;
const color_1 = require("./color");
function renderEnvironmentPlain(report) {
    return report.environments.flatMap((environment) => [
        `${environment.name}: ${environment.detected
            ? (0, color_1.styleText)('detected', 'green')
            : (0, color_1.styleText)('not detected', 'dim')}`,
        ...[...environment.configDirectories, ...environment.configFiles].map((configPath) => `[${configPath.exists
            ? (0, color_1.styleText)('found', 'green')
            : (0, color_1.styleText)('missing', 'dim')}] ${configPath.path}`),
    ]);
}
