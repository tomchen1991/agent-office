import test from 'node:test';
import assert from 'node:assert/strict';
import { fixedOfficeSeats, officeRoute, officeLocalPoint, OFFICE_DESK, OFFICE_WORLD } from '../src/wholeOfficeGeometry.ts';
import { residentSeatReport } from '../src/residentLayout.ts';

test('left rooms are vertically stacked and hotspot occupies the upper right', () => {
  const seats = fixedOfficeSeats();
  const owner = seats.find(s => s.id === 'self')!;
  const ops = seats.filter(s => s.kind === 'github' || s.kind === 'devops');
  const hotspot = seats.find(s => s.kind === 'hotspot')!;
  assert.equal(seats.length, 20);
  assert.ok(!seats.some(s => s.kind === 'simulated-child'));
  assert.ok(ops.every(s => s.x < 700 && s.y > owner.y));
  assert.deepEqual({ x: hotspot.x, y: hotspot.y }, { x: 1840, y: 300 });
  for (const seat of ops) {
    const left = officeLocalPoint(seat, OFFICE_DESK.frontX, 376.2);
    const right = left.x + OFFICE_DESK.frontWidth * seat.scale;
    const bottom = officeLocalPoint(seat, OFFICE_DESK.frontX, 495.9).y;
    assert.ok(left.x >= 80 && right <= 660, 'desks leave at least 40px inside both room walls');
    assert.ok(bottom <= 960, 'desk legs remain inside the bottom wall');
  }
  for (const seat of [owner, ...ops]) {
    const route = officeRoute(seat);
    assert.ok(route.some(p => p.x === 690), 'uses the right-hand room doorway');
  }
});

test('compact public floor retains all desks inside its bounds', () => {
  assert.equal(OFFICE_WORLD.width, 2250);
  const desks = fixedOfficeSeats().filter(s => s.id.startsWith('public-desk-'));
  assert.equal(desks.length, 10);
  assert.deepEqual([...new Set(desks.map(s => s.y))], [570, 795]);
  for (const seat of desks) {
    const left = officeLocalPoint(seat, OFFICE_DESK.frontX, 376.2);
    assert.ok(left.x + OFFICE_DESK.frontWidth * seat.scale < OFFICE_WORLD.width - 40);
  }
});

test('child agents use free public furniture without overriding explicit team seats', () => {
  const children = ['pi-1', 'pi-2', 'pi-3', 'pi-4', 'pi-5'];
  const report = residentSeatReport({ selfAgentId: 'owner', childAgentIds: children,
    team: { layout: 'independent-desks', memberIds: ['team'], seatAssignments: { team: 'public-table-1-seat-1' } } });
  assert.equal(report.assignments.team, 'public-table-1-seat-1');
  assert.ok(children.every(id => report.assignments[id]?.startsWith('public-')));
  assert.equal(new Set(Object.values(report.assignments)).size, Object.keys(report.assignments).length);
  assert.deepEqual(report.childOverflowIds, []);
});

test('children exceeding public capacity are reported instead of reserving private seats', () => {
  const report = residentSeatReport({ selfAgentId: 'owner', childAgentIds: Array.from({length: 18}, (_, i) => `pi-${i}`), team: { layout: 'peer-table', memberIds: [] } });
  assert.equal(report.childOverflowIds.length, 2);
  assert.equal(Object.keys(report.assignments).length, 17);
});
