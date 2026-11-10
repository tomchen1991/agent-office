import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcileOverflow, advanceOverflow, overflowPlacement } from '../src/overflowMotion.ts';
import { residentSeatReport } from '../src/residentLayout.ts';

const target = { id: 'child', identityKey: 'source/child/epoch', status: 'idle' as const };
test('overflow idles wander, work freezes feet, uncertainty and waiting do not invent activity', () => {
  const initial = reconcileOverflow([], [target]);
  const walking = advanceOverflow(initial, 1000);
  assert.notEqual(walking[0].distance, initial[0].distance);
  const working = reconcileOverflow(walking, [{ ...target, status: 'working' }]);
  const tablet = advanceOverflow(working, 1000);
  assert.deepEqual(overflowPlacement(tablet[0]), overflowPlacement(walking[0]));
  assert.equal(tablet[0].elapsedMs, 1000);
  for (const status of ['unknown', 'waiting', 'stopping'] as const) {
    const still = reconcileOverflow(tablet, [{ ...target, status }]);
    assert.deepEqual(advanceOverflow(still, 1000), still);
  }
  assert.deepEqual(reconcileOverflow(tablet, [{ ...target, status: 'offline' }]), []);
  assert.deepEqual(reconcileOverflow(tablet, []), []);
});
test('membership reorder preserves positions; epoch changes reset presentation', () => {
  const other = { ...target, id: 'team', identityKey: 'team/epoch' };
  const actors = advanceOverflow(reconcileOverflow([], [target, other]), 1000);
  assert.deepEqual(reconcileOverflow(actors, [other, target]).map(a => a.distance), [actors[1].distance, actors[0].distance]);
  const replacement = { ...target, identityKey: 'new/epoch' };
  assert.deepEqual(reconcileOverflow(actors, [replacement]), reconcileOverflow([], [replacement]));
});
test('overflow route remains in the clear bottom public aisle', () => {
  for (let index = 0; index < 128; index++) {
    const actor = reconcileOverflow([], [{ ...target, id: String(index), identityKey: String(index) }])[0];
    for (let distance = 0; distance < 2400; distance += 10) {
      const p = overflowPlacement({ ...actor, distance });
      assert.ok(p.x >= 870 && p.x <= 2070 && p.y >= 970 && p.y <= 1010);
    }
  }
});
test('both children and team overflow survive allocation without phantom furniture', () => {
  const members = Array.from({ length: 18 }, (_, i) => `team-${i}`);
  const report = residentSeatReport({ selfAgentId: 'self', childAgentIds: ['child-1', 'child-2'], team: { layout: 'peer-table', memberIds: members } });
  assert.equal(Object.keys(report.assignments).length, 17);
  assert.deepEqual(report.teamOverflowIds, ['team-16', 'team-17']);
  assert.deepEqual(report.childOverflowIds, ['child-1', 'child-2']);
});
