import {data,getEntity} from './model.ts';
import type {State} from './model.ts';

export function authoredCompatibility(s:State,fromId:string,toId:string){
 const from=data(getEntity(s,fromId,'character'),'character'),to=data(getEntity(s,toId,'character'),'character');
 if(from.compatibility.requiredTraits.some(traitId=>!to.traits.includes(traitId)))return -100;
 const score=Object.entries(from.compatibility.traitWeights).reduce((total,[traitId,weight])=>to.traits.includes(traitId)?total+weight:total,0);
 return Math.max(-100,Math.min(100,score));
}
