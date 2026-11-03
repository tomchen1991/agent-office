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
 assert.ok(css.includes('aspect-ratio:2250/1100'));
 assert.ok(css.includes('width:min(100%,159.5454545vh)'));
 assert.ok(css.includes('.wo-fixed-world .wo-glass-wall{left:28.888889%;top:10.909091%;width:.4%;height:59.545455%;z-index:775'));
 assert.ok(css.includes('.wo-fixed-world .wo-private-bottom{left:1.777778%;top:94.545455%;'));
 assert.ok(!css.includes('aspect-ratio:2400/1600'));
});
