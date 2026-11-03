/** Short, planted-foot pose beats for the two seating transitions only. */
export interface SeatingPose { sheet:'locomotion'|'seated'; frame:number; seatFootProgress:number; mirrored:boolean }
const smooth = (value:number) => { const t=Math.max(0,Math.min(1,value)); return t*t*(3-2*t); };
export function seatingPose(stage:'sit'|'stand', elapsedMs:number, reducedMotion=false):SeatingPose {
  const t=Math.max(0,Math.min(2000,elapsedMs));
  const pose=(sheet:SeatingPose['sheet'],frame:number,seatFootProgress:number,mirrored=false):SeatingPose=>({sheet,frame,seatFootProgress,mirrored});
  if(stage==='sit') {
    if(reducedMotion) return pose('seated',0,1);
    if(t<100) return pose('locomotion',0,0); // Match the final arrival step.
    if(t<240) return pose('locomotion',7,0); // Stop before aligning with the chair.
    if(t<560) return pose('locomotion',Math.floor((t-240)/160)%2===0?1:3,smooth((t-240)/320));
    if(t<720) return pose('locomotion',7,1); // Feet planted before knees bend.
    if(t<920) return pose('locomotion',4,1);
    if(t<1120) return pose('locomotion',5,1);
    if(t<1680) return pose('seated',6,1);
    return pose('seated',0,1); // Exactly the unchanged work opening pose.
  }
  if(reducedMotion) return pose('locomotion',7,0,true);
  if(t<140) return pose('seated',5,1); // Preserve the ending error pose before recovering.
  if(t<320) return pose('seated',6,1);
  if(t<480) return pose('locomotion',5,1);
  if(t<700) return pose('locomotion',6,1);
  if(t<900) return pose('locomotion',7,1); // Rise without drifting an upright sprite.
  if(t<1240) return pose('locomotion',Math.floor((t-900)/170)%2===0?1:3,1-smooth((t-900)/340),true);
  if(t<1840) return pose('locomotion',7,0,true);
  return pose('locomotion',0,0,true); // Match the first exit step and its direction.
}
export const SEATED_CONTACT_Y = 64; // One scene-percent higher than the prior seated position.
export const DEMO_SPRITE_WIDTH_PERCENT = 22;
export const DEMO_SCENE_ASPECT = 1000/570;
export function seatingPlacement(pose:SeatingPose, feet:{x:number;y:number}, seat:{x:number;y:number}) {
  // All existing atlases share a registered feet baseline. Convert the seated endpoint
  // to that same physical contact instead of interpolating different body landmarks.
  const seatFeetX=68+(feet.x-seat.x)*DEMO_SPRITE_WIDTH_PERCENT;
  const seatFeetY=SEATED_CONTACT_Y+(feet.y-seat.y)*DEMO_SPRITE_WIDTH_PERCENT*DEMO_SCENE_ASPECT;
  return {
    x:68+(seatFeetX-68)*pose.seatFootProgress,
    y:67+(seatFeetY-67)*pose.seatFootProgress,
    contactX:pose.mirrored?1-feet.x:feet.x,
    contactY:feet.y,
  };
}
