import * as fs from 'fs';
import * as path from 'path';

export function walkFiles(dir: string, extensions: string[], recursive = false): string[] {
  const files: string[] = [];

  function walk(currentDir: string) {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory() && recursive) {
        walk(fullPath);
      } else if (entry.isFile() && extensions.includes(path.extname(entry.name).toLowerCase())) {
        files.push(fs.realpathSync(fullPath));
      }
    }
  }

  walk(dir);
  return files;
}

export function walkOrgFiles(dir: string, recursive = false): string[] {
  return walkFiles(dir, ['.org'], recursive);
}
