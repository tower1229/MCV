import type { EnvironmentReport } from '../operations/environment';

export function renderEnvironmentPlain(report: EnvironmentReport): string[] {
  return report.environments.flatMap((environment) => [
    `${environment.name}: ${environment.detected ? 'detected' : 'not detected'}`,
    ...[...environment.configDirectories, ...environment.configFiles].map(
      (configPath) => `[${configPath.exists ? 'found' : 'missing'}] ${configPath.path}`,
    ),
  ]);
}
