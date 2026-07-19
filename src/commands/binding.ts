import { bindRepository, migrateRepository, unbindRepository } from '../utils/repository';

export function bind(repositoryPath: string): void {
  bindRepository(repositoryPath);
  console.log(`Bound this device to ${repositoryPath}.`);
}

export function unbind(): void {
  unbindRepository();
  console.log('Removed the MCV repository binding from this device.');
}

export function migrate(repositoryPath: string, dryRun: boolean): void {
  const manifest = migrateRepository(repositoryPath, dryRun);
  console.log(`${dryRun ? 'Migration preview' : 'Migrated repository'}: schema v${manifest.schemaVersion}`);
}
