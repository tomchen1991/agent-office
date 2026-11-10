import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { demoCharacters } from '../src/demoAssets.ts';
import { fixedOfficeSeats, officeActorPlacement, OFFICE_WORLD } from '../src/wholeOfficeGeometry.ts';
const measured = JSON.parse(readFileSync(new URL('./fixtures/sleep-alpha-bounds.json', import.meta.url), 'utf8')) as Record<string, {sha256: string; seatedSha256: string; frames: number[][]; endpointMatchesSeatedIdle6: boolean}>;
test('optional sleep atlases belong only to four dedicated roles, retain exact seated endpoints and fit existing desk anchors', () => {
  assert.deepEqual(demoCharacters.filter(character => character.sleep).map(character => character.id), ['self', 'github', 'devops', 'hotspot']);
  for (const character of demoCharacters.filter(character => character.sleep)) {
    const atlas = character.sleep!, fixture = measured[character.id];
    for (const [src, sha] of [[atlas.src, fixture.sha256], [character.seated.src, fixture.seatedSha256]]) {
      const png = readFileSync(new URL(`../public/${src}`, import.meta.url));
      assert.equal(createHash('sha256').update(png).digest('hex'), sha, 'Re-measure actual RGBA frames if artwork changes');
      assert.equal(png.readUInt32BE(16), 2048); assert.equal(png.readUInt32BE(20), 1024); assert.equal(png[25], 6);
    }
    assert.equal(fixture.endpointMatchesSeatedIdle6, true); assert.deepEqual(atlas.anchor, character.seated.anchor);
    const seat = fixedOfficeSeats().find(seat => seat.kind === (character.id === 'self' ? 'owner' : character.id))!;
    const placement = officeActorPlacement(seat, character, 'work', 0, 0);
    for (const [left, top, right, bottom] of fixture.frames) {
      const x0 = placement.x + (left / 512 - placement.contactX) * placement.width;
      const x1 = placement.x + (right / 512 - placement.contactX) * placement.width;
      const y0 = placement.y + (top / 512 - placement.contactY) * placement.width;
      const y1 = placement.y + (bottom / 512 - placement.contactY) * placement.width;
      assert.ok(x0 >= 0 && x1 <= OFFICE_WORLD.width && y0 >= 0 && y1 <= OFFICE_WORLD.height);
      if (character.id === 'self') assert.ok(x0 >= 49 && x1 < 650, 'No sleeping pixels cross private wall');
    }
  }
});
