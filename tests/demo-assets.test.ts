import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {demoCharacters} from '../src/demoAssets.ts';
test('all seven characters have independent complete 4x2 RGBA action sheets at declared dimensions',()=>{
 assert.deepEqual(demoCharacters.map(c=>c.id),['self','deepseek','chatgpt','grok','github','devops','hotspot']);
 const paths=new Set<string>();
 for(const character of demoCharacters){
  assert.equal(character.ready,true);
  for(const kind of ['locomotion','seated'] as const){
   const atlas=character[kind];assert.ok(!paths.has(atlas.src));paths.add(atlas.src);
   const bytes=readFileSync(new URL(`../public/${atlas.src}`,import.meta.url));
   assert.equal(bytes.subarray(1,4).toString(),'PNG');
   assert.equal(bytes.readUInt32BE(16),atlas.cellWidth*atlas.columns);assert.equal(bytes.readUInt32BE(20),atlas.cellHeight*atlas.rows);
   assert.equal(bytes[25],6,'PNG must be RGBA');
   assert.ok(atlas.anchor.x>=0&&atlas.anchor.x<=1&&atlas.anchor.y>=0&&atlas.anchor.y<=1);
  }
 }
 assert.equal(paths.size,14);
});
