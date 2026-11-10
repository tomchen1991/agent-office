import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { demoCharacters } from '../src/demoAssets.ts';

const manifest = JSON.parse(readFileSync(new URL('../public/assets/demo/manifest.json', import.meta.url), 'utf8')) as {
  frameOrder: Record<string, string[]>;
  assets: {character: string; sheet: string; path: string; sha256: string; anchor?: number[]}[];
};

for (const id of ['devops', 'hotspot'] as const) {
  test(`${id} has independent approved transparent atlases and pixel-exact sleep endpoints`, async () => {
    const character = demoCharacters.find(character => character.id === id)!;
    assert.ok(character?.ready);
    const frames: Record<string, Buffer[]> = {};
    for (const sheet of ['locomotion', 'seated', 'sleep'] as const) {
      const atlas = character[sheet]!;
      assert.ok(atlas);
      assert.equal(atlas.src, `assets/demo/${id}/${sheet}.png`);
      assert.deepEqual([atlas.columns, atlas.rows, atlas.cellWidth, atlas.cellHeight], [4, 2, 512, 512]);
      const expectedAnchor = sheet === 'locomotion' ? [300, 470] : [250, 355];
      assert.deepEqual([atlas.anchor.x * 512, atlas.anchor.y * 512], expectedAnchor);
      const entries = manifest.assets.filter(asset => asset.character === id && asset.sheet === sheet);
      assert.equal(entries.length, 1);
      assert.deepEqual(entries[0].anchor, expectedAnchor);
      assert.equal(entries[0].path, atlas.src);
      assert.equal(manifest.frameOrder[sheet].length, 8);
      const png = readFileSync(new URL(`../public/${atlas.src}`, import.meta.url));
      assert.equal(createHash('sha256').update(png).digest('hex'), entries[0].sha256);
      const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
      assert.deepEqual([info.width, info.height, info.channels], [2048, 1024, 4]);
      frames[sheet] = [];
      for (let index = 0; index < 8; index++) {
        const cell = Buffer.alloc(512 * 512 * 4);
        for (let y = 0; y < 512; y++) {
          const start = ((Math.floor(index / 4) * 512 + y) * 2048 + index % 4 * 512) * 4;
          data.copy(cell, y * 512 * 4, start, start + 512 * 4);
        }
        let opaque = 0, transparent = 0;
        for (let offset = 3; offset < cell.length; offset += 4) {
          if (cell[offset] > 0) opaque++;
          else transparent++;
        }
        assert.ok(opaque > 0 && transparent > 0, `${sheet}/${index} must contain art and transparency`);
        frames[sheet].push(cell);
      }
    }
    assert.deepEqual(frames.sleep[0], frames.seated[6]);
    assert.deepEqual(frames.sleep[7], frames.seated[6]);
  });
}
