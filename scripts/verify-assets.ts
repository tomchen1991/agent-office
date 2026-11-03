import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const manifest = JSON.parse(readFileSync(new URL('../public/assets/manifest.json', import.meta.url), 'utf8')) as {assets: {path:string;sha256:string}[]};
for (const asset of manifest.assets) {
  const bytes = readFileSync(new URL(`../public/${asset.path}`, import.meta.url));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), asset.sha256, `Asset changed: ${asset.path}`);
  console.log(`PASS ${asset.path}`);
}
