import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {fixture,key} from './helpers.ts';
import {Game} from '../src/game/engine.ts';
import {data,settingsSchema,validateEntity,validateState} from '../src/game/model.ts';
import type {State} from '../src/game/model.ts';
import {startingBudget,applyStartingGrants,skillGrants,skillStatus,stockSkill,ORIGINS,selectedBackgrounds} from '../public/creation-rules.js';
import {applyPlayerChoices} from '../src/game/creation.ts';
import {resolveAction} from '../src/game/actions.ts';
import {advance} from '../src/game/simulation.ts';
const skill=(name:string,extra:Record<string,unknown>={})=>validateEntity({id:randomUUID(),kind:'skill',name,visibility:'campaign',data:{description:stockSkill(name)?.description??'',...extra}});
const character=(extra:Record<string,unknown>={})=>validateEntity({id:randomUUID(),kind:'character',name:'Subject',visibility:'campaign',data:{playable:true,...extra}});
const state=(entities:ReturnType<typeof validateEntity>[]):State=>({clock:'2012-06-01T12:00:00.000Z',settings:settingsSchema.parse({}),entities,facts:[],knowledge:[],beliefs:[],memories:[]});
test('four background slots grant free training, deduplicate, retain legacy history and obey skill scales',()=>{
 const athletics=skill('Athletics'),rifle=skill('Firearms: rifles',{scale:{min:-10,max:30,step:.25}});
 const pc=character({background:{option1:'veteran',option2:'marine',option3:'veteran',option4:'college',history:'Preserved'}}),d=data(pc,'character');
 const entities=[athletics,rifle,pc];applyStartingGrants(d,entities);
 assert.equal(d.skills[athletics.id],50);assert.equal(d.skills[rifle.id],10);
 assert.equal(startingBudget(d,entities).skills,0);d.skills[athletics.id]=70;assert.equal(startingBudget(d,entities).skills,1);
 assert.equal(selectedBackgrounds(d).length,3);assert.equal(d.background.history,'Preserved');
 assert.equal(selectedBackgrounds({background:{option1:'',originChoice:'local'}})[0]?.id,'local');
 assert.ok(ORIGINS.length>=30);assert.ok(ORIGINS.every(row=>row.description&&Object.keys(row.skills).length&&Object.keys(row.modifiers).length));
 const hidden={...athletics,id:randomUUID(),visibility:'creator' as const};
 assert.equal(Object.hasOwn(skillGrants(d,[hidden,rifle]),hidden.id),false);
 assert.throws(()=>applyPlayerChoices(state(entities),{}, {background:{option1:'invented-bonus'}}),/unknown_creation_background/);
 assert.doesNotThrow(()=>applyPlayerChoices(state(entities),{background:{option2:'Old written history'}},{background:{option2:'Old written history'}}));
});
test('published life persists four backgrounds and trait training with server-calculated free ratings',async()=>{
 const f=await fixture(),game=new Game(f.store);
 try{
  const timeline=await game.initialize(f.creator,f.campaign.id);await game.installCatalog(f.creator,timeline.id,1,key());
  const s=await game.load(timeline.id),medic=s.entities.find(e=>e.name==='Medic'&&e.kind==='trait')!,firstAid=s.entities.find(e=>e.name==='First aid'&&e.kind==='skill')!,rifle=s.entities.find(e=>e.name==='Firearms: rifles'&&e.kind==='skill')!;
  assert.deepEqual(medic.data.skillGrants,[{skillId:firstAid.id,fraction:.5}]);
  const pkg=await game.createStartPackage(f.creator,timeline.id,{name:'Background test',slug:'background-test',kind:'guided',visibility:'campaign',status:'published',definition:{character:{name:'Recruit',description:'',data:{}},grantEntityIds:[],relationshipTemplates:[],reputation:[],plotHookIds:[],requiresSystems:[]}},key());
  const result=await game.start(f.player,timeline.id,{revision:2,packageId:pkg.id,choices:{traits:[medic.id],background:{option1:'marine',option2:'veteran',option3:'college',option4:'police'},skills:{[rifle.id]:70}}},key());
  const saved=await game.load(timeline.id),pc=data(saved.entities.find(e=>e.id===result.characterId)!,'character');
  assert.equal(pc.background.option4,'police');assert.equal(pc.skills[rifle.id],70);assert.equal(pc.skills[firstAid.id],50);assert.equal(startingBudget(pc,saved.entities).skills,1);
  assert.doesNotThrow(()=>validateState(saved));assert.equal((await game.startPackages(f.player,timeline.id))[0]?.build?.background.option1,'');
 }finally{await f.close();}
});
test('skill Trained status affects only its checks and Athletics fatigue; custom definitions stay untouched',()=>{
 const athletics=skill('Athletics'),pc=character({skills:{[athletics.id]:50}}),s=state([athletics,pc]);
 s.settings.rules={dieSides:20,threshold:1,damage:1,treatmentMinutes:1,recoveryPerDay:1,unfamiliarPenalty:0,bleedPerMinute:0,formula:'additive-no-die',outcomeMode:'legacy-binary',outcomeBands:{criticalMargin:10,successAtCostMargin:2,partialFailureMargin:-2,failureInformationMargin:-10}};
 const result=resolveAction(s,pc.id,{type:'check',attribute:'Strength',skillId:athletics.id,checkId:null,context:''},randomUUID(),'a'.repeat(64));
 assert.equal(result.checks[0]!.modifiers.find(m=>m.name==='Skill: Athletics / Trained')?.value,2);
 const other=resolveAction(s,pc.id,{type:'check',attribute:'Strength',skillId:null,checkId:null,context:''},randomUUID(),'a'.repeat(64));assert.equal(other.checks[0]!.modifiers.some(m=>m.name.includes('/ Trained')),false);
 s.settings.needs=true;const control=structuredClone(s);(control.entities.find(e=>e.id===pc.id)!.data.skills as Record<string,number>)[athletics.id]=49;
 const start=data(pc,'character').fatigue,controlStart=data(control.entities.find(e=>e.id===pc.id)!,'character').fatigue;
 advance(s,60,randomUUID(),[],pc.id);advance(control,60,randomUUID(),[],pc.id);
 const gain=data(pc,'character').fatigue-start,plain=data(control.entities.find(e=>e.id===pc.id)!,'character').fatigue-controlStart;
 assert.ok(plain>0);assert.ok(Math.abs(gain/plain-.85)<1e-7);
 assert.equal(skillStatus({...athletics,data:{...athletics.data,description:'Custom mechanics'}},100).trained,false);
 assert.equal(skillStatus(athletics,49).trained,false);
 assert.doesNotThrow(()=>validateState(s));
});

test('authored starts without customization and newly saved NPCs persist free training',async()=>{
 const f=await fixture(),game=new Game(f.store);
 try{
  const timeline=await game.initialize(f.creator,f.campaign.id);await game.installCatalog(f.creator,timeline.id,1,key());
  const rifle=(await game.load(timeline.id)).entities.find(e=>e.kind==='skill'&&e.name==='Firearms: rifles')!;
  const npc=character({playable:false,background:{option1:'marine'}});
  await game.edit(f.creator,timeline.id,{revision:2,entity:npc},key());
  assert.equal(data((await game.load(timeline.id)).entities.find(e=>e.id===npc.id)!,'character').skills[rifle.id],50);
  const pkg=await game.createStartPackage(f.creator,timeline.id,{name:'Authored soldier',slug:'authored-soldier',kind:'guided',visibility:'campaign',status:'published',definition:{character:{name:'Soldier',description:'',data:{background:{option1:'army'}}},grantEntityIds:[],relationshipTemplates:[],reputation:[],plotHookIds:[],requiresSystems:[]}},key());
  const result=await game.start(f.player,timeline.id,{revision:3,packageId:pkg.id},key());
  assert.equal(data((await game.load(timeline.id)).entities.find(e=>e.id===result.characterId)!,'character').skills[rifle.id],50);
 }finally{await f.close();}
});
test('legacy stock trait grants are supported without changing customized traits',()=>{
 const firstAid=skill('First aid'),legacy=validateEntity({id:randomUUID(),kind:'trait',name:'Medic',visibility:'campaign',data:{category:'experience',mode:'costed',cost:2,description:'Training grants +2 only on checks using First aid. It does not grant unrelated expertise.',scopedCheckModifiers:[{name:'Medic',value:2,skillId:firstAid.id,contexts:[]}]}});
 const pc=character({traits:[legacy.id]}),d=data(pc,'character');
 assert.equal(skillGrants(d,[firstAid,legacy])[firstAid.id]?.value,50);
 const changed={...legacy,data:{...legacy.data,cost:3}};
 assert.equal(skillGrants(d,[firstAid,changed])[firstAid.id],undefined);
});
