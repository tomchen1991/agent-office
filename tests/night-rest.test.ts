import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_NIGHT_REST, isNightRestTime, parseNightRestConfig } from '../src/nightRest.ts';
import { advanceLiveOffice, reconcileLiveOffice, liveOfficePose } from '../src/liveOfficeMotion.ts';
import type { LiveOfficeActor, LiveOfficeTarget } from '../src/liveOfficeMotion.ts';
import { actorHasScythe } from '../src/personalIdle.ts';
const target = (patch: Partial<LiveOfficeTarget> = {}): LiveOfficeTarget => ({ id: 'self', identityKey: 'e1', seatKey: 'owner', status: 'idle', personalRole: 'self', nightRest: true, nightEligible: true, nightArtReady: true, ...patch });
const seated = (patch: Partial<LiveOfficeTarget> = {}): LiveOfficeActor[] => [{ ...target(patch), identityKey: 'e1', phase: 'seated', elapsedMs: 0 }];
const sleeping = () => advanceLiveOffice(advanceLiveOffice(seated(), 5000), 900);
test('local configurable cross-midnight window is start-inclusive/end-exclusive; daytime, disabled, invalid', () => {
  for (const [hour, min, expected] of [[21,59,false],[22,0,true],[23,59,true],[0,0,true],[6,59,true],[7,0,false],[12,0,false]] as const) assert.equal(isNightRestTime(new Date(2026, 10, 3, hour, min)), expected);
  assert.equal(isNightRestTime(new Date(2026, 10, 3, 12), { ...DEFAULT_NIGHT_REST, start: '10:00', end: '14:00' }), true);
  assert.equal(isNightRestTime(new Date(2026, 10, 3, 23), { ...DEFAULT_NIGHT_REST, enabled: false }), false);
  assert.equal(isNightRestTime(new Date(NaN)), false);
  for (const bad of [{ ...DEFAULT_NIGHT_REST, start: '24:00' }, { ...DEFAULT_NIGHT_REST, end: '22:00' }, { ...DEFAULT_NIGHT_REST, version: 2 }, { ...DEFAULT_NIGHT_REST, secret: true }]) assert.throws(() => parseNightRestConfig(bad));
});
test('sleep is bounded fresh-idle presentation after five seconds, with short lowering and breathing', () => {
  assert.equal(advanceLiveOffice(seated(), 4999)[0].phase, 'seated');
  const lower = advanceLiveOffice(seated(), 5000);
  assert.equal(lower[0].phase, 'drowse'); assert.equal(liveOfficePose(lower[0]).frame, 0);
  assert.equal(advanceLiveOffice(lower, 899)[0].phase, 'drowse');
  const asleep = advanceLiveOffice(lower, 900);
  assert.equal(asleep[0].phase, 'sleep'); assert.equal(liveOfficePose(asleep[0]).frame, 3);
  assert.equal(liveOfficePose(advanceLiveOffice(asleep, 1200)[0]).frame, 4);
  assert.equal(asleep[0].status, 'idle');
  for (const status of ['working', 'waiting', 'stopping', 'unknown'] as const) assert.notEqual(advanceLiveOffice(seated({status, nightEligible: false}), 20000)[0]?.phase, 'sleep');
});
test('work and daylight latch short wake before work frames; pause is zero advance; repeated updates never restart wake', () => {
  for (const change of [{ status: 'working' as const, nightEligible: false }, { nightRest: false, nightEligible: false }]) {
    let actors = reconcileLiveOffice(sleeping(), [target(change)]);
    assert.equal(actors[0].phase, 'wake'); assert.equal(liveOfficePose(actors[0]).sheet, 'sleep');
    assert.equal(advanceLiveOffice(actors, 0), actors);
    actors = advanceLiveOffice(actors, 300);
    actors = reconcileLiveOffice(actors, [target(change)]);
    assert.equal(actors[0].elapsedMs, 300);
    assert.equal(advanceLiveOffice(actors, 299)[0].phase, 'wake');
    assert.equal(advanceLiveOffice(actors, 300)[0].phase, 'seated');
  }
});
test('uncertainty/art failure immediately replaces sleep with neutral; reduced motion cannot keep sleep claims', () => {
  for (const change of [{ status: 'unknown' as const }, { status: 'unknown' as const, identityKey: null }, { nightArtReady: false, nightEligible: false }, { nightArtKey: 'replacement' }]) {
    const actor = reconcileLiveOffice(sleeping(), [target(change)])[0];
    assert.equal(actor.phase, 'seated'); assert.equal(liveOfficePose(actor).sheet, 'seated'); assert.equal(liveOfficePose(actor).frame, 6);
  }
  const actor = reconcileLiveOffice(sleeping(), [target({ status: 'working', nightEligible: false })], true)[0];
  assert.equal(actor.phase, 'seated'); assert.equal(liveOfficePose(actor, true).frame, 0);
  assert.equal(reconcileLiveOffice(sleeping(), [target({ identityKey: 'e2' })])[0].phase, 'arrival');
});
test('night missing optional assets suppresses new daytime leisure; current scythe returns safely first', () => {
  assert.equal(advanceLiveOffice(seated({ nightEligible: false }), 20000)[0].phase, 'seated');
  let actors: readonly LiveOfficeActor[] = [{ ...seated()[0], phase: 'personal', personal: { phase: 'scythe', elapsedMs: 450 } }];
  actors = reconcileLiveOffice(actors, [target()]);
  assert.equal(actorHasScythe(actors[0].personal), true);
  assert.equal(actors[0].personal?.scytheReturnAtMs, 1100);
  actors = advanceLiveOffice(actors, 650); assert.equal(actors[0].personal?.phase, 'putdown');
  actors = advanceLiveOffice(actors, 1000); assert.equal(actors[0].personal?.phase, 'back'); assert.equal(actorHasScythe(actors[0].personal), false);
  actors = advanceLiveOffice(actors, 3200); assert.equal(actors[0].phase, 'seated');
  actors = advanceLiveOffice(actors, 5000); assert.equal(actors[0].phase, 'drowse');
});
