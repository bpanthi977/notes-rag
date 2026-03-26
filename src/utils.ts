import * as fs from 'fs';
import * as path from 'path';

export function walkOrgFiles(dir: string, recursive = false): string[] {
  const files: string[] = [];

  function walk(currentDir: string) {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory() && recursive) {
        walk(fullPath);
      } else if (entry.isFile() && entry.name.endsWith('.org')) {
        files.push(fs.realpathSync(fullPath));
      }
    }
  }

  walk(dir);
  return files;
}
