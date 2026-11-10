import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {demoCharacters} from '../src/demoAssets.ts';
import {fixedOfficeSeats,officeRoute,OFFICE_WORLD,officeActorWidth} from '../src/wholeOfficeGeometry.ts';

// Pillow RGBA alpha.getbbox() measured the four actual walking cells. Hashes bind
// these opaque bounds to the unchanged approved PNGs, with no runtime dependency.
const bounds=JSON.parse(readFileSync(new URL('./fixtures/walking-alpha-bounds.json',import.meta.url),'utf8')) as Record<string,{sha256:string;frames:number[][]}>;
test('opaque walking pixels stay inside the compact world for every seat, persona, frame and route direction',()=>{
 let maximumRight=0;
 for(const character of demoCharacters){
  const atlas=character.locomotion, measured=bounds[character.id];
  assert.equal(createHash('sha256').update(readFileSync(new URL(`../public/${atlas.src}`,import.meta.url))).digest('hex'),measured.sha256,'Re-measure alpha bounds when changing an approved atlas');
  for(const seat of fixedOfficeSeats()){
   const route=officeRoute(seat,character),width=officeActorWidth(seat);
   for(let index=1;index<route.length;index++){
    const from=route[index-1],to=route[index];
    // Translations are linear, so endpoints bound world extrema. Intermediate
    // samples additionally exercise the conditional wall-height checks. Test
    // both directions, including the mirror change at corners.
    for(const mirrored of [to.x<from.x,!(to.x<from.x)])for(const [frame,box] of measured.frames.entries())for(const point of Array.from({length:33},(_,step)=>({x:from.x+(to.x-from.x)*step/32,y:from.y+(to.y-from.y)*step/32}))){
     const [x0,y0,x1,y1]=box;
     const left=mirrored?atlas.cellWidth-x1:x0,right=mirrored?atlas.cellWidth-x0:x1;
     const anchor=mirrored?1-atlas.anchor.x:atlas.anchor.x;
     const pixelLeft=point.x+(left/atlas.cellWidth-anchor)*width;
     const pixelRight=point.x+(right/atlas.cellWidth-anchor)*width;
     const pixelTop=point.y+(y0/atlas.cellHeight-atlas.anchor.y)*width;
     const pixelBottom=point.y+(y1/atlas.cellHeight-atlas.anchor.y)*width;
     const context=`${seat.id}/${character.id}/frame${frame}/segment${index}/mirror${mirrored}`;
     assert.ok(pixelLeft>=0&&pixelRight<=OFFICE_WORLD.width,`${context}: horizontal [${pixelLeft},${pixelRight}]`);
     assert.ok(pixelTop>=0&&pixelBottom<=OFFICE_WORLD.height,`${context}: vertical [${pixelTop},${pixelBottom}]`);
     maximumRight=Math.max(maximumRight,pixelRight);
     // The previous full-height partition no longer exists. Two stacked rooms
     // have separate doorways; test their ground-plane crossings below, not an
     // obsolete x650/y700 silhouette split. Sprite/wall occlusion needs browser QA.
     if(['owner','github','devops'].includes(seat.kind)) assert.ok(pixelLeft>=40,`${context}: room actor crosses left world wall`);
     if(Math.min(from.x,to.x)<700&&Math.max(from.x,to.x)>700){
      const doorY=seat.kind==='owner'?470:750;
      assert.equal(from.y,doorY);assert.equal(to.y,doorY);
     }
    }
   }
  }
 }
 // The rightmost public desks retain a measured world margin for all PNG frames.
 assert.ok(OFFICE_WORLD.width-maximumRight>=7,`Right boundary margin ${OFFICE_WORLD.width-maximumRight}`);
});
