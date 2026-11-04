import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';

// Derived lossless delivery copies only. Approved source sprites remain unchanged.
async function walk(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(entries.map(entry => entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)]));
  return nested.flat();
}
let before = 0, after = 0, count = 0;
for (const path of (await walk('dist/assets/demo')).filter(path => path.endsWith('.png'))) {
  const output = path.slice(0, -4) + '.webp';
  await sharp(path).webp({ lossless: true, effort: 4 }).toFile(output);
  before += (await stat(path)).size; after += (await stat(output)).size; count++;
}
console.log(`Lossless sprite delivery: ${count} files, ${(before / 1048576).toFixed(1)} → ${(after / 1048576).toFixed(1)} MiB`);
