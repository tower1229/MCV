import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

export function hashFile(filePath: string): string {
  return createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

export function hashDirectoryTree(root: string): string {
  const hash = createHash('sha256');
  const visit = (directory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name))) {
      const current = path.join(directory, entry.name);
      hash.update(`${path.relative(root, current)}\0`);
      if (entry.isSymbolicLink()) {
        hash.update(`symlink\0${fs.readlinkSync(current)}\0`);
        continue;
      }
      if (entry.isDirectory()) {
        hash.update('directory\0');
        visit(current);
        continue;
      }
      hash.update(fs.readFileSync(current));
    }
  };
  visit(root);
  return hash.digest('hex');
}

export function findSymbolicLinkAncestor(targetPath: string): string | undefined {
  let current = path.resolve(targetPath);
  while (true) {
    try {
      if (fs.lstatSync(current).isSymbolicLink()) return current;
    } catch { /* Missing descendants are expected. */ }
    const parent = path.dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

export function atomicWriteTextFile(targetPath: string, content: string): void {
  atomicWriteFile(targetPath, content);
}

export function atomicWriteFile(
  targetPath: string,
  content: string | Buffer,
): void {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  const temporaryPath = `${targetPath}.mcv-${process.pid}-${Date.now()}.tmp`;
  try {
    fs.writeFileSync(temporaryPath, content);
    fs.renameSync(temporaryPath, targetPath);
  } finally {
    if (fs.existsSync(temporaryPath)) {
      fs.rmSync(temporaryPath, { force: true });
    }
  }
}
