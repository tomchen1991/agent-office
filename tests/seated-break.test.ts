import test from 'node:test';
import assert from 'node:assert/strict';
import { demoCharacters } from '../src/demoAssets.ts';
import { seatedBreakAnimations, seatedBreakDuration, seatedBreakFrame, seatedBreakRole } from '../src/seatedBreak.ts';
import { advanceLiveOffice, reconcileLiveOffice, liveOfficePose } from '../src/liveOfficeMotion.ts';
import type { LiveOfficeActor, LiveOfficeTarget } from '../src/liveOfficeMotion.ts';

const approved = {
  chatgpt: { frames: [0,1,2,3,4,5,4,3,2,6,1,7], durationsMs: [600,200,260,350,350,180,350,300,260,260,180,600] },
  deepseek: { frames: [0,1,2,3,4,3,4,3,4,5,6,1,7], durationsMs: [600,240,300,170,170,170,170,170,170,650,250,180,600] },
  grok: { frames: [0,1,2,3,4,3,5,2,6,1,7], durationsMs: [600,300,400,500,700,250,600,300,300,200,600] },
};
const roles = ['chatgpt','deepseek','grok'] as const;
const target = (patch: Partial<LiveOfficeTarget> = {}): LiveOfficeTarget => ({ id: 'child', identityKey: 'epoch-1', seatKey: 'desk-1', status: 'idle', seatedBreakRole: 'deepseek', seatedBreakArtKey: 'deepseek.png', ...patch });
const seated = (patch: Partial<LiveOfficeTarget> = {}): LiveOfficeActor[] => [{ ...target(patch), identityKey: 'epoch-1', phase: 'seated', elapsedMs: 0 }];
const resting = () => advanceLiveOffice(seated(), 5000);

test('approved seated break sequences preserve every frame and exact timing boundary', () => {
  assert.deepEqual(Object.keys(seatedBreakAnimations).sort(), [...roles].sort());
  for (const role of roles) {
    const animation = seatedBreakAnimations[role], expected = approved[role];
    assert.deepEqual(animation.frames, expected.frames); assert.deepEqual(animation.durationsMs, expected.durationsMs);
    assert.ok(animation.label.length > 0);
    const duration = expected.durationsMs.reduce((a,b) => a+b, 0);
    assert.equal(seatedBreakDuration(role), duration);
    let elapsed = 0;
    expected.frames.forEach((frame, index) => {
      assert.equal(seatedBreakFrame(role, elapsed), frame);
      assert.equal(seatedBreakFrame(role, elapsed + expected.durationsMs[index] - 1), frame);
      assert.equal(seatedBreakFrame(role, duration * 200 + elapsed), frame);
      elapsed += expected.durationsMs[index];
    });
    assert.equal(seatedBreakFrame(role, duration), 0);
    for (const invalid of [-1, NaN, Infinity]) assert.equal(seatedBreakFrame(role, invalid), 0);
  }
});

test('only a supported identity with its own optional atlas loaded may enter a seated break', () => {
  const all = demoCharacters.flatMap(character => character.seatedBreak ? [character.seatedBreak.src] : []);
  for (const character of demoCharacters) {
    const supported = roles.some(role => role === character.id);
    assert.equal(seatedBreakRole(character, all), supported ? character.id : undefined);
    assert.equal(seatedBreakRole(character, []), undefined);
    if (character.seatedBreak) {
      assert.equal(seatedBreakRole(character, all.filter(src => src !== character.seatedBreak!.src)), undefined);
      assert.equal(seatedBreakRole({ ...character, seatedBreak: undefined }, all), undefined);
    }
  }
});

test('fresh idle admission waits five seconds, loops at the seated anchor, and preserves truthful idle status', () => {
  assert.equal(advanceLiveOffice(seated(), 4999)[0].phase, 'seated');
  const actors = resting(), actor = actors[0];
  assert.equal(actor.phase, 'seated-break'); assert.equal(actor.elapsedMs, 0);
  const pose = liveOfficePose(actor);
  assert.equal(pose.sheet, 'seatedBreak'); assert.equal(pose.frame, 0); assert.equal(pose.progress, 0); assert.equal(pose.status, 'idle');
  assert.equal(liveOfficePose(advanceLiveOffice(actors, 600)[0]).frame, 1);
  const later = advanceLiveOffice(actors, seatedBreakDuration('deepseek') * 100 + 600)[0];
  assert.equal(later.phase, 'seated-break'); assert.equal(liveOfficePose(later).frame, 1);
  for (const delta of [0, -1, NaN, Infinity]) assert.equal(advanceLiveOffice(actors, delta), actors);
  for (const status of ['working','waiting','stopping','unknown'] as const) assert.notEqual(advanceLiveOffice(seated({status}), 30000)[0]?.phase, 'seated-break');
  assert.equal(advanceLiveOffice(seated({seatedBreakRole: undefined}), 30000)[0].phase, 'seated');
});

test('new work, uncertainty, own-art changes, remapping and reduced motion interrupt seated props immediately', () => {
  const changes: Partial<LiveOfficeTarget>[] = [
    ...(['working','waiting','stopping','unknown'] as const).map(status => ({status})),
    { identityKey: null }, { seatedBreakRole: undefined }, { seatedBreakRole: 'grok' },
    { seatedBreakArtKey: 'replacement.png' }, { seatKey: 'desk-2' },
  ];
  for (const change of changes) {
    const actor = reconcileLiveOffice(resting(), [target(change)])[0];
    assert.equal(actor.phase, 'seated', JSON.stringify(change));
    assert.equal(liveOfficePose(actor).sheet, 'seated'); assert.equal(actor.elapsedMs, 0);
  }
  assert.equal(reconcileLiveOffice(resting(), [target()], true)[0].phase, 'seated');
  assert.equal(reconcileLiveOffice(resting(), [target({identityKey:'epoch-2'})])[0].phase, 'arrival');
  assert.equal(reconcileLiveOffice(resting(), [target({status:'offline'})])[0].phase, 'stand');
  assert.deepEqual(reconcileLiveOffice(resting(), [target({status:'offline'})], true), []);
  const partial = advanceLiveOffice(seated(), 4000);
  const changed = reconcileLiveOffice(partial, [target({seatedBreakRole:'grok', seatedBreakArtKey:'grok.png'})]);
  assert.equal(advanceLiveOffice(changed, 4999)[0].phase, 'seated', 'new persona must earn a fresh idle delay');
});
