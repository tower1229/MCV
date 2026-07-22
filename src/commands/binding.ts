import { bindRepository, migrateRepository, unbindRepository } from '../utils/repository';
import type { DeviceContext } from '../adapters/types';

export function bind(context: DeviceContext, repositoryPath: string): void {
  bindRepository(context, repositoryPath);
  console.log(`Bound this device to ${repositoryPath}.`);
}

export function unbind(context: DeviceContext): void {
  unbindRepository(context);
  console.log('Removed the MCV repository binding from this device.');
}

export function migrate(context: DeviceContext, repositoryPath: string, dryRun: boolean): void {
  const manifest = migrateRepository(context, repositoryPath, dryRun);
  console.log(`${dryRun ? 'Migration preview' : 'Migrated repository'}: schema v${manifest.schemaVersion}`);
}
