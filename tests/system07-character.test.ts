import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {fixture,key} from './helpers.ts';
import {Game} from '../src/game/engine.ts';
import {validateEntity} from '../src/game/model.ts';
import type {Entity} from '../src/game/model.ts';

const characterData=(locationId:string|null,controllerUserId:string|null,extra:Record<string,unknown>={})=>({
 playable:!!controllerUserId,controllerUserId,locationId,legalName:'Alex Morgan',aliases:['Lex'],dob:'1990-02-03',sex:'',gender:'nonbinary',pronouns:'they/them',
 identity:{display:'Alex'},nationality:'American',cultureContext:'Authored family context',originLocationId:locationId,classContext:'working class',
 appearance:{style:'worn denim'},heightCm:175,build:'lean',hair:'brown',eyes:'green',complexion:'olive',features:['freckles'],scars:['left wrist'],tattoos:['small star'],disabilities:[],
 presentation:'quiet streetwear',socialPresentation:{context:'trusted by neighbors'},background:{childhood:'Authored history'},familyBackground:'A complicated family history.',
 employerOccupation:'Night clerk',education:'Community college',beliefsContext:'Personal beliefs authored by Creator',voice:'Low and measured',notes:'Creator note',
 attributes:{Strength:40,Agility:45,Endurance:40,Intellect:50,Perception:50,Presence:40,Will:50},skills:{},traits:[],condition:'conscious',cash:1200,bank:5000,
 sections:[{id:randomUUID(),name:'Identity',parentId:null,position:0,visibility:'campaign',helpText:'Core identity',editable:true,repeatable:false,archived:false,fields:[
  {id:randomUUID(),name:'Chosen presentation',type:'text',visibility:'campaign',value:'Night shift',helpText:'',repeatable:false,archived:false},
  {id:randomUUID(),name:'Creator secret',type:'text',visibility:'creator',value:'Not for player view',helpText:'',repeatable:false,archived:false}
 ]}],...extra
});

test('System 07 persists one validated character architecture for player and NPC records',async()=>{
 const f=await fixture(),game=new Game(f.store);
 try{
  const timeline=await game.initialize(f.creator,f.campaign.id),location=validateEntity({id:randomUUID(),kind:'location',name:'Shared neighborhood',visibility:'campaign',data:{category:'district'}});
  const player=validateEntity({id:randomUUID(),kind:'character',name:'Alex',visibility:'owner',data:characterData(location.id,f.player.id)});
  const npc=validateEntity({id:randomUUID(),kind:'character',name:'Morgan',visibility:'campaign',data:characterData(location.id,null,{playable:false,secrets:'Hidden plot truth',instructions:'Never expose this',goals:['private-goal'],fears:['private-fear'],cultureContext:'Private authored context'})});
  await game.bulkEdit(f.creator,timeline.id,{revision:1,entities:[location,player,npc]},key());
  const loaded=await game.load(timeline.id),saved=loaded.entities.find(e=>e.id===player.id)!;
  assert.equal(saved.data.legalName,'Alex Morgan');assert.equal(saved.data.heightCm,175);assert.equal(saved.data.characterSchemaVersion,2);
  assert.equal((await f.store.get<{n:number}>('SELECT count(*) n FROM character_profile_schema_versions WHERE timeline_id=?',timeline.id))!.n,2);
  const view=await game.view(f.player,timeline.id,player.id),seen=view.entities.find(e=>e.id===npc.id)!;
  assert.equal(seen.data.legalName,'Alex Morgan');assert.equal(seen.data.presentation,'quiet streetwear');
  assert.equal('secrets' in seen.data,false);assert.equal('instructions' in seen.data,false);assert.equal('goals' in seen.data,false);assert.equal('cultureContext' in seen.data,false);
  assert.equal((seen.data.sections as Array<{fields:Array<{name:string}>}>)[0]!.fields.some(field=>field.name==='Chosen presentation'),true);
  assert.equal((seen.data.sections as Array<{fields:Array<{name:string}>}>)[0]!.fields.some(field=>field.name==='Creator secret'),false);
 }finally{await f.close();}
});

test('System 07 custom section and field IDs survive rename, reorder, parent changes, and reload',async()=>{
 const f=await fixture(),game=new Game(f.store);
 try{
  const timeline=await game.initialize(f.creator,f.campaign.id),identityId=randomUUID(),fieldId=randomUUID(),character=validateEntity({id:randomUUID(),kind:'character',name:'Stable profile',visibility:'campaign',data:characterData(null,null,{sections:[
   {id:identityId,name:'Identity',parentId:null,position:0,visibility:'campaign',helpText:'',editable:true,repeatable:false,archived:false,fields:[{id:fieldId,name:'Original label',type:'text',visibility:'campaign',value:'Preserve me',helpText:'',repeatable:false,archived:false}]},
   {id:randomUUID(),name:'Appearance',parentId:identityId,position:1,visibility:'campaign',helpText:'',editable:true,repeatable:false,archived:false,fields:[]}
  ]})});
  await game.edit(f.creator,timeline.id,{revision:1,entity:character},key());
  const next=await game.load(timeline.id),draft=next.entities.find(e=>e.id===character.id)!;
  const sections=draft.data.sections as Array<{id:string;name:string;parentId:string|null;position:number;fields:Array<{id:string;name:string;value:unknown}>}>;
  sections[0]!.name='Renamed identity';sections[0]!.position=4;sections[0]!.fields[0]!.name='Renamed field';sections[1]!.parentId=null;sections[1]!.position=0;
  await game.edit(f.creator,timeline.id,{revision:2,entity:draft},key());
  const reloaded=(await game.load(timeline.id)).entities.find(e=>e.id===character.id)!;
  const result=reloaded.data.sections as typeof sections;
  assert.equal(result.find(s=>s.id===identityId)!.name,'Renamed identity');assert.equal(result.find(s=>s.id===identityId)!.fields.find(field=>field.id===fieldId)!.name,'Renamed field');
  assert.equal(result.find(s=>s.id===identityId)!.fields.find(field=>field.id===fieldId)!.value,'Preserve me');
  assert.equal((await f.store.get<{schema_version:number}>('SELECT schema_version FROM character_profile_schema_versions WHERE character_id=?',character.id))!.schema_version,2);
  const invalid=structuredClone(reloaded);const invalidSections=invalid.data.sections as Array<{id:string;parentId:string|null}>;invalidSections[0]!.parentId=invalidSections[1]!.id;invalidSections[1]!.parentId=invalidSections[0]!.id;
  assert.throws(()=>validateEntity(invalid),/section_cycle/);
 }finally{await f.close();}
});
