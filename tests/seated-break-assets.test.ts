import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { demoCharacters } from '../src/demoAssets.ts';
const hashes = {
  chatgpt: 'c0b60c078aae8927107f1c0bb9a7ea63b20e647cef68ba6f65cb748c768e2a05',
  deepseek: '3d64acfa4bb5f79f13793fbb78a73c9daa2c91ea86cc2de267959dbc3c837d1b',
  grok: 'b40d6adb7a169ca0cc095730bd42e4f4bef1a08fe3decc5dc62c97d1ef6db06c',
};
function visibleBounds(rgba: Buffer): [number, number, number, number] {
  let left = 512, top = 512, right = -1, bottom = -1;
  for (let y = 0; y < 512; y++) for (let x = 0; x < 512; x++) {
    // Ignore nearly transparent generation noise when measuring the visible silhouette.
    if (rgba[(y * 512 + x) * 4 + 3] < 16) continue;
    left = Math.min(left, x); top = Math.min(top, y);
    right = Math.max(right, x); bottom = Math.max(bottom, y);
  }
  return [left, top, right, bottom];
}
test('three approved transparent seated atlases retain exact original neutral endpoints and desk anchors', async () => {
  assert.deepEqual(demoCharacters.filter(character => character.seatedBreak).map(character => character.id).sort(), Object.keys(hashes).sort());
  for (const role of ['chatgpt','deepseek','grok'] as const) {
    const character = demoCharacters.find(character => character.id === role)!, atlas = character.seatedBreak!;
    assert.equal(atlas.src, `assets/demo/${role}/seated-break.png`);
    assert.deepEqual(atlas.anchor, character.seated.anchor);
    assert.deepEqual(atlas.anchor, {x:250/512,y:355/512});
    assert.equal(atlas.columns,4); assert.equal(atlas.rows,2); assert.equal(atlas.cellWidth,512); assert.equal(atlas.cellHeight,512);
    const png = readFileSync(new URL(`../public/${atlas.src}`, import.meta.url));
    assert.equal(createHash('sha256').update(png).digest('hex'), hashes[role]);
    assert.equal(png.readUInt32BE(16), 2048); assert.equal(png.readUInt32BE(20),1024); assert.equal(png[25],6);
    const neutral = await sharp(readFileSync(new URL(`../public/${character.seated.src}`, import.meta.url))).extract({left:1024,top:512,width:512,height:512}).ensureAlpha().raw().toBuffer();
    const baseline = visibleBounds(neutral)[3];
    assert.ok(Math.abs(baseline - 470) <= 1);
    for (let index = 0; index < 8; index++) {
      const frame = await sharp(png).extract({left:(index%4)*512,top:Math.floor(index/4)*512,width:512,height:512}).ensureAlpha().raw().toBuffer();
      const [left, top, right, bottom] = visibleBounds(frame);
      assert.ok(left <= right && top <= bottom, `${role} frame ${index} has a visible silhouette`);
      assert.ok(left > 0 && top > 0 && right < 511 && bottom < 511, `${role} frame ${index} is not clipped by its cell`);
      assert.ok(Math.abs(bottom - baseline) <= 3, `${role} frame ${index} keeps the original seated foot baseline`);
      if (index === 0 || index === 7) assert.deepEqual(frame,neutral,`${role} frame ${index} must connect seamlessly to seated idle`);
    }
  }
});
