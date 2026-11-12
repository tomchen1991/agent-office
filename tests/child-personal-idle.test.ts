import test from 'node:test';
import assert from 'node:assert/strict';
import { advanceLiveOffice, reconcileLiveOffice, liveOfficePose } from '../src/liveOfficeMotion.ts';
import type { LiveOfficeTarget } from '../src/liveOfficeMotion.ts';
import { personalAssets, personalAssetsReady, personalDemo } from '../src/personalIdle.ts';
import { demoCharacters } from '../src/demoAssets.ts';

for (const role of ['deepseek', 'chatgpt', 'grok'] as const) {
  test(`${role}: own seated leisure loops only during fresh daytime idle`, () => {
    const character = demoCharacters.find(item => item.id === role)!;
    assert.deepEqual(personalAssets(character), [character.seated.src]);
    assert.equal(personalAssetsReady(character, []), false);
    assert.equal(personalAssetsReady(character, [character.seated.src]), true);
    const target: LiveOfficeTarget = { id: role, identityKey: `${role}/1`, seatKey: role, status: 'idle', personalRole: role };
    const seated = advanceLiveOffice(reconcileLiveOffice([], [target]), 6000);
    assert.equal(advanceLiveOffice(seated, 4999)[0].phase, 'seated');
    const actors = advanceLiveOffice(seated, 5000);
    assert.equal(actors[0].personal?.phase, 'slack');
    assert.equal(liveOfficePose(actors[0]).sheet, 'seated');
    assert.equal(liveOfficePose(actors[0]).frame, 2);
    assert.equal(liveOfficePose(advanceLiveOffice(actors, 650)[0]).frame, 3);
    assert.equal(advanceLiveOffice(actors, 120000)[0].personal?.phase, 'slack');
    for (const status of ['working', 'waiting', 'stopping', 'unknown', 'offline'] as const) {
      const changed = reconcileLiveOffice(actors, [{ ...target, status }]);
      assert.equal(changed[0]?.personal, undefined);
    }
    assert.equal(reconcileLiveOffice(actors, [target], true)[0].personal, undefined);
    assert.equal(reconcileLiveOffice(actors, [{ ...target, personalRole: undefined }])[0].personal, undefined);
    assert.equal(reconcileLiveOffice(actors, [{ ...target, nightRest: true }])[0].personal, undefined);
    assert.equal(advanceLiveOffice([{ ...seated[0], nightRest: true }], 10000)[0].phase, 'seated');
    assert.equal(personalDemo(role, 11000), undefined);
  });
}
