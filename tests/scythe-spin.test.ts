import test from 'node:test';
import assert from 'node:assert/strict';
import { advancePersonal, interruptPersonal, personalDemo, personalPose, scytheFrame, actorHasScythe } from '../src/personalIdle.ts';
import { reconcileLiveOffice, advanceLiveOffice } from '../src/liveOfficeMotion.ts';
import type { LiveOfficeActor, LiveOfficeTarget } from '../src/liveOfficeMotion.ts';

test('exactly two complete eight-angle turns, settle, pose hold, then exact handoff grip', () => {
  const frames = Array.from({ length: 26 }, (_, i) => scytheFrame({ phase: 'scythe', elapsedMs: i * 100 }));
  assert.deepEqual(frames, [8, 0,1,2,3,4,5,6,7, 0,1,2,3,4,5,6,7, 0,8,9,9,9,9,9,8,8]);
  for (let ms = 0; ms < 2600; ms++) {
    const action = personalDemo('self', 4200 + ms)!;
    assert.equal(action.phase, 'scythe');
    assert.equal(personalPose(action).frame, frames[Math.floor(ms / 100)]);
    assert.equal(actorHasScythe(action), true);
  }
  assert.deepEqual(personalDemo('self', 6800), { phase: 'putdown', elapsedMs: 0 });
  assert.equal(personalDemo('self', 11000), undefined);
});

test('every recall boundary preserves frame, finishes current revolution and settles before handoff', () => {
  for (let ms = 0; ms < 2600; ms++) {
    const original = { phase: 'scythe' as const, elapsedMs: ms };
    const recalled = interruptPersonal(original)!;
    if (ms < 100) { assert.equal(recalled.phase, 'putdown'); continue; }
    assert.equal(recalled.phase, 'scythe');
    assert.equal(scytheFrame(recalled), scytheFrame(original), `no orientation snap at ${ms}`);
    assert.deepEqual(interruptPersonal(recalled), recalled, 'repeated reconcile cannot reset return');
    const deadline = recalled.scytheReturnAtMs!;
    assert.ok(deadline > ms && deadline <= 2600);
    if (ms < 1700) {
      const zeroAt = deadline - 200;
      for (let t = ms; t < zeroAt; t++) assert.equal(scytheFrame({ ...recalled, elapsedMs: t }), Math.floor((t - 100) / 100) % 8);
      assert.equal(scytheFrame({ ...recalled, elapsedMs: zeroAt }), 0);
    }
    const final = advancePersonal(recalled, 'self', deadline - ms - 1)!;
    assert.equal(scytheFrame(final), 8, 'exact pickup-compatible grip before putting down');
    assert.deepEqual(advancePersonal(final, 'self', 1), { phase: 'putdown', elapsedMs: 0 });
    assert.equal(advancePersonal(recalled, 'self', 9000), undefined);
  }
});

test('cancel intent survives unknown/reduced freezes and newer idle; no resumed second turn or pose', () => {
  const target: LiveOfficeTarget = { id: 'self', identityKey: 'self/1', seatKey: 'owner', status: 'working', personalRole: 'self' };
  const actor: LiveOfficeActor = { ...target, identityKey: 'self/1', phase: 'personal', elapsedMs: 0, personal: { phase: 'scythe', elapsedMs: 450 } };
  let actors = reconcileLiveOffice([actor], [target]);
  const recalled = actors[0].personal!;
  assert.equal(recalled.scytheReturnAtMs, 1100);
  for (const reduced of [false, true]) {
    actors = reconcileLiveOffice(actors, [{ ...target, status: reduced ? 'working' : 'unknown' }], reduced);
    assert.deepEqual(advanceLiveOffice(actors, 20000)[0].personal, recalled);
  }
  actors = reconcileLiveOffice(actors, [{ ...target, status: 'idle' }]);
  assert.deepEqual(actors[0].personal, recalled);
  assert.equal(advanceLiveOffice(actors, 650)[0].personal?.phase, 'putdown');
});

test('actual RGBA atlas matches measured bounds, eight distinct directions, exact pickup grip and empty unused cells', async () => {
  const { readFileSync } = await import('node:fs');
  const { inflateSync } = await import('node:zlib');
  const { createHash } = await import('node:crypto');
  const { demoCharacters } = await import('../src/demoAssets.ts');
  // Decode the PNG pixels rather than trusting a hand-written dimensions claim.
  const decode = (path: string) => {
    const png = readFileSync(new URL(`../public/${path}`, import.meta.url));
    const width = png.readUInt32BE(16), height = png.readUInt32BE(20);
    assert.equal(png[24], 8); assert.equal(png[25], 6); assert.equal(png[28], 0);
    const chunks: Buffer[] = [];
    for (let offset = 8; offset < png.length;) {
      const size = png.readUInt32BE(offset);
      if (png.toString('ascii', offset + 4, offset + 8) === 'IDAT') chunks.push(png.subarray(offset + 8, offset + 8 + size));
      offset += size + 12;
    }
    const raw = inflateSync(Buffer.concat(chunks)), stride = width * 4, pixels = Buffer.alloc(stride * height);
    for (let y = 0; y < height; y++) {
      const filter = raw[y * (stride + 1)];
      assert.ok(filter <= 4);
      for (let x = 0; x < stride; x++) {
        const index = y * stride + x, a = x >= 4 ? pixels[index - 4] : 0, b = y > 0 ? pixels[index - stride] : 0, c = y > 0 && x >= 4 ? pixels[index - stride - 4] : 0;
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        const predictor = filter === 0 ? 0 : filter === 1 ? a : filter === 2 ? b : filter === 3 ? Math.floor((a + b) / 2) : pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
        pixels[index] = raw[y * (stride + 1) + 1 + x] + predictor;
      }
    }
    return { width, height, cell: (frame: number) => {
      const out = Buffer.alloc(512 * 512 * 4), columns = width / 512;
      for (let y = 0; y < 512; y++) pixels.copy(out, y * 2048, (Math.floor(frame / columns) * 512 + y) * stride + frame % columns * 2048, (Math.floor(frame / columns) * 512 + y) * stride + frame % columns * 2048 + 2048);
      return out;
    } };
  };
  const character = demoCharacters[0], atlas = decode(character.extra!.src), pickup = decode(character.pickup!.src);
  assert.equal(atlas.width, character.extra!.columns * 512); assert.equal(atlas.height, character.extra!.rows * 512);
  const fixture = JSON.parse(readFileSync(new URL('./fixtures/personal-alpha-bounds.json', import.meta.url), 'utf8')).self;
  const hashes = [];
  for (let i = 0; i < 12; i++) {
    const cell = atlas.cell(i), hash = createHash('sha256').update(cell).digest('hex'); hashes.push(hash);
    assert.equal(hash, fixture.rgbaFrameHashes[i]);
    let minX = 512, minY = 512, maxX = -1, maxY = -1;
    for (let y = 0; y < 512; y++) for (let x = 0; x < 512; x++) if (cell[(y * 512 + x) * 4 + 3]) { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); }
    if (i < 10) assert.deepEqual([minX, minY, maxX + 1, maxY + 1], fixture.frames[i]);
    else assert.equal(maxX, -1, 'unused cell is fully transparent');
  }
  assert.equal(new Set(hashes.slice(0, 10)).size, 10, 'real distinct image frames, not duplicated swing frames');
  assert.deepEqual(atlas.cell(8), pickup.cell(3), 'handoff is byte-for-byte the final pickup grip');
});
