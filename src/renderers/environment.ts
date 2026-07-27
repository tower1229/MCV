import type { EnvironmentReport } from '../operations/environment.js';
import { styleText } from './color.js';

export function renderEnvironmentPlain(report: EnvironmentReport): string[] {
  return report.environments.flatMap((environment) => [
    `${environment.name}: ${environment.detected
      ? styleText('detected', 'green')
      : styleText('not detected', 'dim')}`,
    ...[...environment.configDirectories, ...environment.configFiles].map(
      (configPath) => `[${configPath.exists
        ? styleText('found', 'green')
        : styleText('missing', 'dim')}] ${configPath.path}`,
    ),
  ]);
}
