import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { OFFICE_ROOMS, fixedOfficeSeats, officeRoute } from '../src/wholeOfficeGeometry.ts';

test('stacked room door gaps contain every private route crossing', () => {
  for (const seat of fixedOfficeSeats().filter(seat => ['owner', 'github', 'devops'].includes(seat.kind))) {
    const room = seat.kind === 'owner' ? OFFICE_ROOMS.main : OFFICE_ROOMS.devops;
    const right = room.x + room.width;
    assert.ok(room.doorTop >= room.y && room.doorBottom <= room.y + room.height);
    assert.equal(room.doorBottom - room.doorTop, 100);
    assert.equal(room.doorCenter, (room.doorTop + room.doorBottom) / 2);
    const route = officeRoute(seat);
    const crossings = route.slice(1).flatMap((b, i) => {
      const a = route[i];
      return Math.min(a.x, b.x) < right && Math.max(a.x, b.x) > right ? [[a, b]] : [];
    });
    assert.equal(crossings.length, 1);
    assert.ok(crossings.every(([a, b]) => a.y === room.doorCenter && b.y === room.doorCenter));
  }
});
test('windows live on visible wall band; doors no longer render obsolete skewed panels', () => {
  const source = readFileSync(new URL('../src/WholeOfficeScene.tsx', import.meta.url), 'utf8');
  assert.match(source, /Object\.entries\(OFFICE_ROOMS\)/);
  assert.match(source, /data-office-window/);
  assert.match(source, /position\(window\.x, 135, window\.width, 64, 23, 135\)/);
  assert.doesNotMatch(source, /className="wo-glass-wall"/);
  assert.doesNotMatch(source, /className="wo-window wo-window-private"/);
  assert.doesNotMatch(source, /DEVOPS \/ 运维办公室/);
  assert.doesNotMatch(source, /wo-coffee-corner|<span>☕<\/span>/);
  assert.match(source, /position\(70, 585, 600, 110, 100, 585\)/);
});
