import test from 'node:test';
import assert from 'node:assert/strict';
import { personalDemo, personalPose, personalRoute, personalRouteProgress, interruptPersonal, advancePersonal, personalPlacement, personalDuration } from '../src/personalIdle.ts';
import { advanceLiveOffice, reconcileLiveOffice, liveOfficePose } from '../src/liveOfficeMotion.ts';
import type { LiveOfficeTarget } from '../src/liveOfficeMotion.ts';
import { demoCharacters } from '../src/demoAssets.ts';
import { fixedOfficeSeats, OFFICE_WORLD } from '../src/wholeOfficeGeometry.ts';
const target = (status: LiveOfficeTarget['status'], role: 'self' | 'github' = 'self'): LiveOfficeTarget => ({ id: role, identityKey: `test/${role}/1`, seatKey: role, status, personalRole: role });
const seated = (role: 'self' | 'github') => advanceLiveOffice(reconcileLiveOffice([], [target('idle', role)]), 6000);
for (const role of ['self', 'github'] as const) {
  test(`${role}: bounded complete demo, extra action and stroll, seated at end`, () => {
    const phases = new Set<string>();
    for (let ms = 0; ms < (role === 'self' ? 11000 : 9000); ms += 100) { const action = personalDemo(role, ms)!; phases.add(action.phase); const pose = personalPose(action), atlas = demoCharacters.find(item => item.id === role)![pose.sheet]!; assert.ok(pose.frame < atlas.columns * atlas.rows); }
    assert.ok(phases.has('out')); assert.ok(phases.has('back')); assert.ok(phases.has(role === 'self' ? 'scythe' : 'game')); assert.ok(phases.has('settle'));
    assert.equal(personalDemo(role, role === 'self' ? 11000 : 9000), undefined);
    const seat = fixedOfficeSeats().find(item => item.kind === (role === 'self' ? 'owner' : 'github'))!;
    const route = personalRoute(seat, demoCharacters.find(item => item.id === role)!);
    for (const point of route) { assert.ok(point.x > 100 && point.x < OFFICE_WORLD.width - 100); assert.ok(point.y > (role === 'self' ? 200 : 550) && point.y < (role === 'self' ? 550 : 1000)); }
    assert.ok(Math.hypot(route.at(-1)!.x-route[0].x, route.at(-1)!.y-route[0].y) < 300);
  });
  test(`${role}: only five seconds continuous idle enables leisure; latest state wins`, () => {
    let actors = seated(role);
    actors = advanceLiveOffice(actors, 4999); assert.equal(actors[0].phase, 'seated');
    actors = advanceLiveOffice(actors, 1); assert.equal(actors[0].phase, 'personal');
    for (const status of ['unknown', 'waiting', 'working', 'stopping', 'offline'] as const) {
      for (let ms = 0; ms < (role === 'self' ? 11000 : 9000); ms += 300) {
        const personal = personalDemo(role, ms)!;
        const source = [{ ...actors[0], personal }];
        let changed = reconcileLiveOffice(source, [target(status, role)]);
        assert.equal(changed[0]?.status, status);
        if (status === 'unknown') { if (role === 'self') { assert.deepEqual(changed[0].personal, personal); assert.equal(changed[0].frozen, true); } else { assert.equal(changed[0].personal, undefined); assert.equal(liveOfficePose(changed[0]).sheet, 'seated'); } }
        else {
          assert.notEqual(changed[0]?.personal?.phase, 'game'); if (changed[0]?.personal?.phase === 'scythe') assert.ok(changed[0].personal.scytheReturnAtMs !== undefined);
          changed = advanceLiveOffice(changed, 9000);
          assert.ok(!changed[0]?.personal);
          if (status === 'working') assert.equal(changed[0].phase, 'seated');
        }
        assert.equal(reconcileLiveOffice(source, [], false).length, role === 'self' ? 1 : 0);
        assert.equal(reconcileLiveOffice(source, [target('idle', role)], true)[0].phase, role === 'self' ? 'personal' : 'seated');
      }
    }
    actors = reconcileLiveOffice(seated(role), [target('working', role)]);
    actors = advanceLiveOffice(actors, 40000);
    actors = reconcileLiveOffice(actors, [target('idle', role)]);
    assert.equal(advanceLiveOffice(actors, 4999)[0].phase, 'seated');
  });
}
test('interruption reverses precisely along traversed route; rapid newer idle cannot resume canceled leisure', () => {
  for (const elapsedMs of [0, 200, 600, 1199]) {
    const old = { phase: 'out' as const, elapsedMs };
    const back = interruptPersonal(old)!;
    assert.equal(personalRouteProgress(back), personalRouteProgress(old));
    assert.ok(personalRouteProgress(advancePersonal(back, 'self', 400)!) <= personalRouteProgress(old));
  }
  let actors = advanceLiveOffice(seated('self'), 5000);
  actors = [{ ...actors[0], personal: personalDemo('self', 4000) }];
  actors = reconcileLiveOffice(actors, [target('working')]);
  actors = reconcileLiveOffice(actors, [target('idle')]);
  assert.equal(actors[0].personal?.phase, 'putdown');
  actors = reconcileLiveOffice(actors, [{ ...target('working'), identityKey: 'test/self/2' }]);
  assert.equal(actors[0].phase, 'personal'); assert.equal(actors[0].visualOnly, true); assert.equal(actors[0].status, 'unknown');
  actors = advanceLiveOffice(actors, 9000); assert.equal(actors[0].phase, 'arrival'); assert.equal(actors[0].identityKey, 'test/self/2');
});

test('new exact alpha assets and every walking frame stay within world and private walls along personal routes', async () => {
  const { readFileSync } = await import('node:fs'); const { createHash } = await import('node:crypto');
  const { officeActorWidth } = await import('../src/wholeOfficeGeometry.ts');
  const extras = JSON.parse(readFileSync(new URL('./fixtures/personal-alpha-bounds.json', import.meta.url), 'utf8'));
  const walks = JSON.parse(readFileSync(new URL('./fixtures/walking-alpha-bounds.json', import.meta.url), 'utf8'));
  for (const role of ['self', 'github'] as const) {
    const character = demoCharacters.find(item => item.id === role)!;
    const seat = fixedOfficeSeats().find(item => item.kind === (role === 'self' ? 'owner' : 'github'))!;
    const route = personalRoute(seat, character), width = officeActorWidth(seat);
    assert.equal(createHash('sha256').update(readFileSync(new URL(`../public/${character.extra!.src}`, import.meta.url))).digest('hex'), extras[role].sha256);
    const spinPlacement = personalPlacement(seat, character, { phase: 'scythe', elapsedMs: 0 });
    // Walking can face either way. Self's held weapon uses the actual stand
    // placement, which is explicitly locked by the exhaustive regression below.
    for (const [atlas, boxes, points, facings] of [[character.locomotion, walks[role].frames, route, [false, true]], [character.extra!, extras[role].frames, role === 'self' ? [spinPlacement] : [seat], role === 'self' ? [spinPlacement.mirrored] : [false, true]]] as const) {
      for (const point of points) for (const box of boxes) for (const mirrored of facings) {
        const [x0,y0,x1,y1] = box, a = mirrored ? 1-atlas.anchor.x : atlas.anchor.x;
        const left = point.x+((mirrored ? 512-x1 : x0)/512-a)*width;
        const right = point.x+((mirrored ? 512-x0 : x1)/512-a)*width;
        const top = point.y+(y0/512-atlas.anchor.y)*width, bottom=point.y+(y1/512-atlas.anchor.y)*width;
        assert.ok(left >= 49 && right <= 690, `${role}: personal action stays inside its left-hand room`);
        assert.ok(top >= 0 && bottom <= OFFICE_WORLD.height);
      }
    }
  }
});

test('registered pickup and parked prop alpha stays within private room at the exact shared contact', async () => {
  const { readFileSync } = await import('node:fs'); const { createHash } = await import('node:crypto');
  const { officeActorWidth } = await import('../src/wholeOfficeGeometry.ts');
  const bounds = JSON.parse(readFileSync(new URL('./fixtures/scythe-alpha-bounds.json', import.meta.url), 'utf8'));
  const character = demoCharacters.find(item => item.id === 'self')!;
  const seat = fixedOfficeSeats().find(item => item.kind === 'owner')!;
  const point = personalRoute(seat, character).at(-1)!, width = officeActorWidth(seat);
  for (const key of ['pickup', 'parkedScythe'] as const) {
    const atlas = character[key]!;
    assert.equal(createHash('sha256').update(readFileSync(new URL(`../public/${atlas.src}`, import.meta.url))).digest('hex'), bounds[key].sha256);
    assert.deepEqual(atlas.anchor, character.extra!.anchor);
    for (const [x0, y0, x1, y1] of bounds[key].frames) {
      assert.ok(point.x + (x0 / 512 - atlas.anchor.x) * width >= 49);
      assert.ok(point.x + (x1 / 512 - atlas.anchor.x) * width <= 650);
      assert.ok(point.y + (y0 / 512 - atlas.anchor.y) * width >= 0);
      assert.ok(point.y + (y1 / 512 - atlas.anchor.y) * width <= OFFICE_WORLD.height);
    }
  }
});

test('pickup, spin and putdown always use the unmirrored stand placement, including recalled actions', () => {
  const character = demoCharacters.find(item => item.id === 'self')!;
  const seat = fixedOfficeSeats().find(item => item.kind === 'owner')!;
  const stand = personalRoute(seat, character).at(-1)!;
  for (const phase of ['pickup', 'scythe', 'putdown'] as const) {
    for (let elapsedMs = 0; elapsedMs < personalDuration[phase]; elapsedMs++) {
      const original = { phase, elapsedMs };
      for (const action of [original, interruptPersonal(original)!]) {
        const placement = personalPlacement(seat, character, action);
        assert.equal(placement.mirrored, false, `${phase}/${elapsedMs}: held weapon must not mirror`);
        assert.equal(placement.x, stand.x); assert.equal(placement.y, stand.y);
        assert.equal(placement.contactX, character.extra!.anchor.x);
        assert.equal(placement.contactY, character.extra!.anchor.y);
      }
    }
  }
});
