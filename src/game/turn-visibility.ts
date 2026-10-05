import {type State} from './model.ts';
import type {Effect} from './simulation.ts';
export function observerEffects(s:State,effects:Effect[],observerId:string):Effect[]{
 const hidden=s.entities.filter(e=>e.kind==='character'&&!e.archived&&e.id!==observerId).flatMap(e=>{const identity=e.data.identityDisclosure as {concealed:boolean;knownByIds:string[];label:string}|null;return identity?.concealed&&!identity.knownByIds.includes(observerId)?[...new Set([e.name,e.data.legalName,...(e.data.aliases as string[]??[])].filter((value):value is string=>typeof value==='string'&&value.length>0))].map(name=>({name,label:identity.label})):[];});
 return effects.filter(e=>e.observers.includes(observerId)).map(e=>{let text=e.text;for(const identity of hidden)text=text.replaceAll(identity.name,identity.label);return {...e,text,observers:[observerId]};});
}
