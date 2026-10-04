import {z} from 'zod';
import {randomUUID} from 'node:crypto';
import {ensure} from '../contracts.ts';
import {data,validateEntity,validateState,type State,type Entity} from './model.ts';
import {fact,observerView} from './epistemics.ts';

// The model may propose modest scene additions, never arbitrary entity data or commands.
export const storyAdditionSchema=z.strictObject({kind:z.enum(['npc','street','place','detail']),name:z.string().trim().min(2).max(80),description:z.string().trim().min(1).max(600)});
export const storyAdditionsSchema=z.array(storyAdditionSchema).max(3);
export type StoryAddition=z.infer<typeof storyAdditionSchema>;
export function applyStoryAdditions(s:State,characterId:string,turnId:string,raw:unknown){
 const additions=storyAdditionsSchema.parse(raw),pc=s.entities.find(e=>e.id===characterId&&e.kind==='character'&&!e.archived);
 ensure(pc,404,'character_unavailable');
 const location=s.entities.find(e=>e.id===pc.data.locationId&&e.kind==='location'&&!e.archived);
 ensure(!additions.length||location,400,'story_location_required');
 ensure(s.entities.filter(e=>Array.isArray(e.data.tags)&&e.data.tags.includes('story-generated')).length+s.facts.filter(f=>f.source==='story-expansion'&&f.predicate==='scene-detail').length+additions.length<=500,400,'story_world_limit');
 const normalized=(name:string)=>name.toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
 const names=new Set(s.entities.map(e=>normalized(e.name)));
 const effects=[];
 for(const addition of additions){
  ensure(!names.has(normalized(addition.name)),400,'story_name_already_exists');names.add(normalized(addition.name));
  if(addition.kind==='detail'){
   ensure(!s.facts.some(f=>f.subjectId===location!.id&&f.predicate==='scene-detail'&&(f.value as {name?:string})?.name===addition.name),400,'story_detail_already_exists');
   fact(s,location!.id,'scene-detail',addition,turnId,[characterId],{source:'story-expansion',audience:[characterId]});continue;
  }
  if(addition.kind==='npc')ensure(!location!.data.ownerId&&data(location!,'location').access.policy==='public',400,'story_npc_requires_public_scene');
  const tags=['story-generated','story-turn:'+turnId],id=randomUUID();
  const entity=validateEntity({id,kind:addition.kind==='npc'?'character':'location',name:addition.name,visibility:'knowledge',data:addition.kind==='npc'?{description:addition.description,tags,locationId:location!.id,playable:false,ageYears:null}:{description:addition.description,tags,parentId:location!.id,category:addition.kind==='street'?'street':'business',discoverable:false}});
  if(entity.kind==='location'){
   const origin=data(location!,'location');
   // Never turn a private apartment into a shortcut, or bypass a locked/authored entrance.
   ensure(['city','district','neighborhood','street','block','road','outside'].includes(origin.category)&&origin.access.policy==='public',400,'story_place_requires_public_outdoors');
   origin.exits.push({to:id,minutes:2,modes:['walk'],locked:false,keyId:null,fare:0,interruption:null,terrainPenalty:0,trafficPenalty:0});
   entity.data.exits=[{to:location!.id,minutes:2,modes:['walk'],locked:false,keyId:null,fare:0,interruption:null,terrainPenalty:0,trafficPenalty:0}];
   location!.data=origin as Entity['data'];location!.revision++;
  }
  s.entities.push(entity);fact(s,id,'introduced',addition.description,turnId,[characterId],{source:'story-expansion',audience:[characterId]});effects.push(id);
 }
 validateState(s);return effects;
}
export function storyScene(s:State,characterId:string){
 const view=observerView(s,characterId),pc=view.entities.find(e=>e.id===characterId),place=view.entities.find(e=>e.id===pc?.data.locationId);
 return {clock:view.clock,weather:view.weather.actual,character:pc?{name:pc.name}:null,place:place?{name:place.name,category:place.data.category,allowNewPeople:!place.data.ownerId&&data(place,'location').access.policy==='public',description:String(place.data.description).slice(0,120)}:null,
  people:view.entities.filter(e=>e.kind==='character'&&e.id!==characterId&&e.data.locationId===pc?.data.locationId).slice(0,3).map(e=>({name:e.name,description:String(e.data.description).slice(0,80)})),
  details:view.facts.filter(f=>f.predicate==='scene-detail'&&f.subjectId===place?.id).slice(-3).map(f=>{const detail=storyAdditionSchema.safeParse(f.value);return detail.success?{name:detail.data.name,description:detail.data.description.slice(0,100)}:null;}),
  knownNames:view.entities.filter(e=>['character','location'].includes(e.kind)).slice(0,8).map(e=>e.name)};
}
