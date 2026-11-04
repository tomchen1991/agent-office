import test from 'node:test';
import assert from 'node:assert/strict';
import { advanceLiveOffice, reconcileLiveOffice } from '../src/liveOfficeMotion.ts';
import type { LiveOfficeActor } from '../src/liveOfficeMotion.ts';

test('live idle remains at desk and work interrupts immediately', () => {
  for (const personalRole of ['github'] as const) {
    const actor: LiveOfficeActor = { id: personalRole, identityKey: personalRole, seatKey: personalRole, status: 'idle', personalRole, phase: 'seated', elapsedMs: 0 };
    let actors = advanceLiveOffice([actor], 120000);
    assert.equal(actors[0].personal?.phase, 'game');
    actors = advanceLiveOffice(actors, 120000);
    assert.equal(actors[0].personal?.phase, 'game');
    actors = reconcileLiveOffice(actors, [{ ...actor, status: 'working' }]);
    assert.equal(actors[0].phase, 'seated');
    assert.equal(actors[0].personal, undefined);
  }
});
