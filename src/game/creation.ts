import {randomUUID} from 'node:crypto';
import {WORKPLACES} from '../../public/city-content.js';
import {getEntity} from './model.ts';
import type {Data,State} from './model.ts';
import {startingBudget,originFor} from '../../public/creation-rules.js';
export function validateStartingBuild(s:State,character:Data<'character'>){
 if(!character.playable)return;
 if(character.background.originChoice&&!originFor(character.background.originChoice))throw new Error('unknown_creation_background');
 const budget=startingBudget(character,s.entities,s.settings.attributeScale);
 for(const category of ['attributes','skills','traits'] as const)if(budget.remaining[category]<-0.000001)throw new Error('starting_'+category+'_budget_exceeded');
 for(const id of character.traits)getEntity(s,id,'trait');
 return budget;
}
// Only public, campaign-published options may be added by a player at launch.
export function applyPlayerChoices(s:State,base:Record<string,unknown>,choices:Record<string,unknown>){
 const baseIds=[...(Array.isArray(base.traits)?base.traits:[]),...Object.keys((base.skills??{}) as object)];if(baseIds.some(id=>!s.entities.some(e=>e.id===id&&!e.archived&&e.visibility==='campaign')))throw new Error('authored_start_not_customizable');
 const next={...base};
 for(const key of ['attributes','skills','traits','background'] as const)if(choices[key]!==undefined)next[key]=key==='background'?{...((base.background??{}) as object),originChoice:(choices.background as Record<string,unknown>).originChoice??''}:choices[key];
 if(Array.isArray(choices.occupations)){next.occupations=choices.occupations.map((row:{placeOfWork:string;position:string})=>{if(!WORKPLACES.some(work=>work.name===row.placeOfWork&&work.positions.includes(row.position)))throw new Error('invalid_starting_occupation');return {...row,id:randomUUID()};});}
 const selected=[...(Array.isArray(next.traits)?next.traits:[]),...Object.keys((next.skills??{}) as object)];
 for(const id of selected){const row=s.entities.find(e=>e.id===id&&!e.archived&&['trait','skill'].includes(e.kind)&&e.visibility==='campaign');if(!row)throw new Error('creation_option_unavailable');}
 return next;
}
