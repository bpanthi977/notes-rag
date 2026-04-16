import * as fs from 'fs';
import * as path from 'path';

export interface FileFilters {
  extensions: string[];
  recursive: boolean;
  exclude: string[]; // regexp patterns tested against absolute file path
}

export function walkFiles(dir: string, filters: FileFilters): string[] {
  const { extensions, recursive, exclude } = filters;
  const excludeRegexps = exclude.map(p => new RegExp(p));
  const files: string[] = [];

  function walk(currentDir: string) {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory() && recursive) {
        walk(fullPath);
      } else if (entry.isFile() && extensions.includes(path.extname(entry.name).toLowerCase())) {
        const resolved = fs.realpathSync(fullPath);
        if (!excludeRegexps.some(re => re.test(resolved))) {
          files.push(resolved);
        }
      }
    }
  }

  walk(dir);
  return files;
}
