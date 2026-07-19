import * as fs from 'fs';
import * as path from 'path';

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
