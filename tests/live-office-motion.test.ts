import test from 'node:test';
import assert from 'node:assert/strict';
import { advanceLiveOffice, liveOfficeNeedsClock, liveOfficePose, reconcileLiveOffice } from '../src/liveOfficeMotion.ts';
import type { LiveOfficeActor, LiveOfficeTarget } from '../src/liveOfficeMotion.ts';
import { liveOfficeSeats } from '../src/liveOfficeSeats.ts';
import type { OfficeAgent, OfficeTopology } from '../src/core.ts';
const target = (status: LiveOfficeTarget['status'] = 'working', patch: Partial<LiveOfficeTarget> = {}): LiveOfficeTarget => ({ id: 'self', identityKey: 'source/self/epoch1', seatKey: 'private', status, ...patch });
const seated = (): LiveOfficeActor[] => [...advanceLiveOffice(reconcileLiveOffice([], [target()]), 6000)];

test('fresh active presence arrives and sits once, then follows current status without script loops', () => {
  let actors = reconcileLiveOffice([], [target()]);
  assert.equal(actors[0].phase, 'arrival');
  actors = advanceLiveOffice(actors, 4000); assert.equal(actors[0].phase, 'sit');
  actors = reconcileLiveOffice(actors, [target('idle')]);
  actors = advanceLiveOffice(actors, 1800); assert.equal(liveOfficePose(actors[0]).frame, 6);
  actors = advanceLiveOffice(actors, 200); assert.equal(actors[0].phase, 'seated');
  assert.equal(liveOfficePose(actors[0]).frame, 6);
  actors = advanceLiveOffice(actors, 900); assert.equal(liveOfficePose(actors[0]).frame, 7);
  actors = reconcileLiveOffice(actors, [target('working')]);
  assert.ok([0, 1].includes(liveOfficePose(actors[0]).frame!));
  actors = advanceLiveOffice(actors, 120_000); assert.equal(actors[0].phase, 'seated');
  assert.ok([0, 1].includes(liveOfficePose(actors[0]).frame!));
  actors = reconcileLiveOffice(actors, [target('stopping')]);
  assert.equal(liveOfficePose(actors[0]).frame, 6); assert.equal(liveOfficeNeedsClock(actors), false);
});

test('unknown, stale or missing data never starts or continues work and missing never asserts exit', () => {
  assert.deepEqual(reconcileLiveOffice([], [target('unknown')]), []);
  assert.deepEqual(reconcileLiveOffice([], [target('unknown', { identityKey: null })]), []);
  for (const identityKey of ['source/self/epoch1', null]) {
    const actors = reconcileLiveOffice(seated(), [target('unknown', { identityKey })]);
    assert.equal(actors[0].phase, 'seated'); assert.equal(actors[0].status, 'unknown');
    assert.equal(liveOfficePose(actors[0]).frame, 6); assert.equal(liveOfficeNeedsClock(actors), false);
  }
});

test('only explicit offline stands and exits; interruption, identity replacement and removed topology cancel ghosts', () => {
  let actors = reconcileLiveOffice(seated(), [target('offline')]);
  assert.equal(actors[0].phase, 'stand'); assert.equal(liveOfficePose(actors[0]).frame, 6);
  actors = advanceLiveOffice(actors, 2000); assert.equal(actors[0].phase, 'exit');
  assert.equal(advanceLiveOffice(actors, 4000).length, 0);
  assert.equal(reconcileLiveOffice(actors, [target('working')])[0].phase, 'seated');
  actors = reconcileLiveOffice(actors, [target('working', { identityKey: 'source/self/epoch2' })]);
  assert.equal(actors.length, 1); assert.equal(actors[0].phase, 'arrival');
  assert.equal(actors[0].identityKey, 'source/self/epoch2');
  assert.equal(reconcileLiveOffice(actors, []).length, 0);
  assert.equal(reconcileLiveOffice(actors, [target('working', { identityKey: 'source/self/epoch2', seatKey: 'new-seat' })])[0].phase, 'seated');
});

test('reduced motion settles at actual neutral/work status and drops explicit departure', () => {
  for (const status of ['working', 'idle', 'waiting', 'stopping'] as const) {
    const actors = reconcileLiveOffice([], [target(status)], true);
    assert.equal(actors[0].phase, 'seated');
    assert.equal(liveOfficePose(actors[0], true).frame, status === 'working' ? 0 : 6);
    assert.equal(reconcileLiveOffice(actors, [target('offline')], true).length, 0);
  }
});

test('explicit topology uses public child seats, isolates self privileges, and never infers persona', () => {
  const topology: OfficeTopology = { selfAgentId: 'owner', childAgentIds: ['c1', 'c2', 'c3', 'c4', 'c5'], team: { layout: 'leader-desks', memberIds: ['a', 'b', 'c'], leaderId: 'b' } };
  const agents: OfficeAgent[] = [{ id: 'a', name: 'host-chatgpt', character: 'unknown', status: 'working', source: 'host', observedAt: null, latestUserRequest: null }];
  const seats = liveOfficeSeats(topology, agents);
  assert.equal(seats.filter(seat => topology.childAgentIds.includes(seat.id)).length, 5);
  assert.equal(seats.find(seat => seat.kind === 'owner')?.id, 'owner');
  assert.equal(seats.find(seat => seat.isLeader)?.id, 'b');
  assert.equal(seats.length, 20);
  assert.equal(seats.find(seat => seat.id === 'b')?.geometryId, 'public-desk-2');
  assert.equal(seats.find(seat => seat.id === 'a')?.persona, 'unknown');
  const peer = liveOfficeSeats({ ...topology, team: { layout: 'peer-table', memberIds: ['a', 'b', 'c'] } }, agents);
  assert.ok(peer.filter(seat => topology.team.memberIds.includes(seat.id)).every(seat => seat.sharedTable));
  assert.equal(peer.find(seat => seat.id === 'c')?.mirrored, true);
});
