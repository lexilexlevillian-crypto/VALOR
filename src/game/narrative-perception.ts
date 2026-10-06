import {perceptionSchema} from './perception-contract.ts';
export {perceptionSchema} from './perception-contract.ts';
import {getEntity,type State} from './model.ts';

export function perception(s:State,id:string){return perceptionSchema.parse(getEntity(s,id,'character').data.perception??{});}
// A known person can remain known while being inaudible or out of sight.
export function reception(s:State,speakerId:string,listenerId:string,method:'say'|'sign'|'write',volume='normal'){
 if(speakerId===listenerId)return 100;
 const speaker=getEntity(s,speakerId,'character').data,listener=getEntity(s,listenerId,'character').data;
 if(listener.condition!=='conscious'||typeof speaker.locationId!=='string'||speaker.locationId!==listener.locationId)return 0;
 const from=perception(s,speakerId),to=perception(s,listenerId),distance=Math.abs(from.position-to.position),wall=from.partition!==to.partition;
 if(method!=='say')return wall||!to.vision||to.attention==='unaware'||distance>(method==='write'?2:15)?0:to.vision;
 const noise=Number(getEntity(s,speaker.locationId,'location').data.noise??0),strength=volume==='whisper'?25:volume==='shout'?100:70;
 const attention=to.attention==='unaware'?50:to.attention==='distracted'?30:to.attention==='partial'?10:0;
 const margin=strength-noise-distance*2-(wall?55:0)-attention-(100-to.hearing);
 return !to.hearing||margin<=0?0:margin<10?40:margin<20?70:100;
}
