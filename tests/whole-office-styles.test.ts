import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('shared-table changes retain core sprite anchoring and furniture positioning rules',()=>{
 const css=readFileSync(new URL('../src/whole-office.css',import.meta.url),'utf8');
 const rules=[...css.matchAll(/([^{}]+)\{([^{}]+)\}/g)].map(match=>({selectors:match[1].trim().split(',').map(s=>s.trim()),body:match[2]}));
 for(const selector of ['.wo-actor','.wo-chair','.wo-monitor','.wo-desk-front','.wo-keyboard']){
  assert.ok(rules.some(rule=>rule.selectors.includes(selector)&&rule.body.includes('position:absolute')),`${selector} needs spatial positioning`);
 }
 const actor=rules.find(rule=>rule.selectors.includes('.wo-actor')&&rule.body.includes('--contact-x'));
 assert.ok(actor?.body.includes('--contact-y'));assert.ok(actor?.body.includes('transform:translate'));
 assert.ok(rules.some(rule=>rule.selectors.includes('.wo-sprite')&&rule.body.includes('image-rendering:pixelated')));
});

test('compact architecture and fit aspect match the logical floor without a default zoom crop',()=>{
 const css=readFileSync(new URL('../src/whole-office.css',import.meta.url),'utf8');
 assert.ok(css.includes('aspect-ratio:2250/1050'));
 assert.ok(css.includes('width:min(100%,167.1428571vh)'));
 const resident=readFileSync(new URL('../src/resident-office.css',import.meta.url),'utf8');
 assert.ok(resident.includes('.wo-room .wo-room-door{position:absolute;left:auto;right:-.65cqw;width:1.65cqw;transform:none;border:0'));
 assert.ok(resident.includes('.wo-room-window{position:absolute;display:grid;grid-template-columns:1fr 1fr'));
 const display=readFileSync(new URL('../src/display-only.css',import.meta.url),'utf8');
 assert.ok(display.includes('width:100%;min-width:1100px;height:max(112.903226dvh,46.666667vw,513.333334px);aspect-ratio:auto'));
 assert.ok(display.includes('left:0;top:0;transform:translateY(-11.428571%)'));
 assert.ok(display.includes('max-height:none;overflow:auto'));
 assert.ok(!display.includes('width:min(100vw'));
 assert.ok(!display.includes('translate(-50%'));
 assert.ok(!css.includes('aspect-ratio:2400/1600'));
});
