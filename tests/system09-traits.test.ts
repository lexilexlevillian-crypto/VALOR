import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {fixture,key} from './helpers.ts';
import {Game} from '../src/game/engine.ts';
import {data,settingsSchema,validateEntity,validateState} from '../src/game/model.ts';
import type {State} from '../src/game/model.ts';
import {advance} from '../src/game/simulation.ts';
import {observerView} from '../src/game/epistemics.ts';
import {generateNpcTraitSelection,socialPresentationDescriptors} from '../src/game/traits.ts';
import {traitGroups} from '../src/game/catalog.ts';

const character=(locationId:string|null,extra:Record<string,unknown>={})=>({playable:false,controllerUserId:null,locationId,attributes:{Strength:0,Agility:0,Endurance:0,Intellect:0,Perception:0,Presence:0,Will:0},skills:{},traits:[],condition:'conscious',...extra});
const effect=(type:string,keyName:string,extra:Record<string,unknown>={})=>({id:randomUUID(),name:keyName,type,scope:{},stackingRule:'unique',conflictBehavior:'suppress',key:keyName,value:0,...extra});
const state=(entities:ReturnType<typeof validateEntity>[],settings:Record<string,unknown>={}):State=>({clock:'2012-06-01T12:00:00.000Z',settings:settingsSchema.parse(settings),entities,facts:[],knowledge:[],beliefs:[],memories:[]});

test('System 09 rejects opposing traits and overlapping reject-conflict effects',()=>{
 const firstId=randomUUID(),secondId=randomUUID(),first=validateEntity({id:firstId,kind:'trait',name:'First',visibility:'campaign',data:{category:'personality',opposes:[secondId]}}),second=validateEntity({id:secondId,kind:'trait',name:'Second',visibility:'campaign',data:{category:'personality',opposes:[firstId]}}),person=validateEntity({id:randomUUID(),kind:'character',name:'Contradiction',visibility:'campaign',data:character(null,{traits:[firstId,secondId]})});
 assert.throws(()=>validateState(state([first,second,person])),/trait_prerequisite_or_opposition/);
 const a=validateEntity({id:randomUUID(),kind:'trait',name:'A',visibility:'campaign',data:{category:'personality',effects:[effect('ai-priority','social drive',{scope:{planTypes:['socialize']},value:2,conflictBehavior:'reject'})]}}),b=validateEntity({id:randomUUID(),kind:'trait',name:'B',visibility:'campaign',data:{category:'personality',effects:[effect('ai-priority','social drive',{scope:{planTypes:['socialize']},value:-2})]}}),conflicted=validateEntity({id:randomUUID(),kind:'character',name:'Effect conflict',visibility:'campaign',data:character(null,{traits:[a.id,b.id]})});
 assert.throws(()=>validateState(state([a,b,conflicted])),/trait_effect_conflict/);
});

test('System 09 caps disadvantage credits and removes current-only credit with its source',()=>{
 const advantage=validateEntity({id:randomUUID(),kind:'trait',name:'Costed advantage',visibility:'campaign',data:{category:'personality',mode:'costed',balance:'advantage',cost:8}}),disadvantage=validateEntity({id:randomUUID(),kind:'trait',name:'Costed disadvantage',visibility:'campaign',data:{category:'personality',mode:'costed',balance:'disadvantage',cost:-10}}),extra=validateEntity({id:randomUUID(),kind:'trait',name:'Second disadvantage',visibility:'campaign',data:{category:'personality',mode:'costed',balance:'disadvantage',cost:-10}});
 const policy={traitBudget:5,traitBalance:{maxTraits:10,maxAdvantages:2,maxDisadvantages:1,disadvantageCreditCap:3,refundPolicy:'capped-current'}};
 const valid=validateEntity({id:randomUUID(),kind:'character',name:'Balanced',visibility:'campaign',data:character(null,{playable:true,traits:[advantage.id,disadvantage.id]})});
 assert.doesNotThrow(()=>validateState(state([advantage,disadvantage,extra,valid],policy)));
 const stacked=structuredClone(valid);stacked.data.traits=[advantage.id,disadvantage.id,extra.id];assert.throws(()=>validateState(state([advantage,disadvantage,extra,stacked],policy)),/trait_disadvantage_cap/);
 const removed=structuredClone(valid);removed.data.traits=[advantage.id];assert.throws(()=>validateState(state([advantage,disadvantage,extra,removed],policy)),/trait_budget_exceeded/);
});

test('System 09 weighted templates are deterministic, background-gated, and contradiction-safe',async()=>{
 const f=await fixture(),game=new Game(f.store);
 try{
  const timeline=await game.initialize(f.creator,f.campaign.id);await game.installCatalog(f.creator,timeline.id,1,key());
  let loaded=await game.load(timeline.id),civilian=loaded.entities.find(entity=>entity.kind==='traitTemplate'&&entity.name==='Grounded civilian traits')!,police=loaded.entities.find(entity=>entity.kind==='trait'&&entity.name==='Police training')!;
  const one=generateNpcTraitSelection(loaded,civilian.id,'fixed-seed'),two=generateNpcTraitSelection(loaded,civilian.id,'fixed-seed');assert.deepEqual(one.traitIds,two.traitIds);assert.ok(one.traitIds.length>=4&&one.traitIds.length<=7);assert.equal(one.traitIds.includes(police.id),false);
  const selected=one.traitIds.map(id=>data(loaded.entities.find(entity=>entity.id===id)!,'trait'));for(const trait of selected)assert.equal(trait.opposes.some(id=>one.traitIds.includes(id)),false);
  const npc=validateEntity({id:randomUUID(),kind:'character',name:'Generated NPC',visibility:'campaign',data:character(null)});await game.edit(f.creator,timeline.id,{revision:2,entity:npc},key());
  const result=await game.generateNpcTraits(f.creator,timeline.id,{revision:3,characterId:npc.id,templateId:civilian.id,seed:'fixed-seed'},key());assert.deepEqual(result.traitIds,one.traitIds);
  loaded=await game.load(timeline.id);assert.deepEqual(data(loaded.entities.find(entity=>entity.id===npc.id)!,'character').traits,one.traitIds);
 }finally{await f.close();}
});

test('System 09 trait-driven NPC priorities retain Creator-only source traces',()=>{
 const location=validateEntity({id:randomUUID(),kind:'location',name:'Workplace',visibility:'campaign',data:{category:'room'}}),business=validateEntity({id:randomUUID(),kind:'business',name:'Shop',visibility:'campaign',data:{locationId:location.id,ownerId:null,cash:100000}}),hidden=validateEntity({id:randomUUID(),kind:'trait',name:'Private work ethic',visibility:'creator',data:{category:'personality',effects:[effect('ai-priority','work ethic',{scope:{planTypes:['work']},value:10})]}}),player=validateEntity({id:randomUUID(),kind:'character',name:'Player',visibility:'owner',data:character(location.id,{playable:true,traits:[hidden.id]})}),npcId=randomUUID(),jobId=randomUUID(),npc=validateEntity({id:npcId,kind:'character',name:'Worker',visibility:'campaign',data:character(location.id,{traits:[hidden.id],plans:[{id:randomUUID(),type:'work',targetId:jobId,priority:0,cooldownMinutes:15},{id:randomUUID(),type:'socialize',targetId:player.id,priority:5,cooldownMinutes:15}]})}),job=validateEntity({id:jobId,kind:'job',name:'Shift',visibility:'campaign',data:{employerId:business.id,employeeId:npc.id,locationId:location.id,hourlyCents:1200,minutesPerShift:60}});
 const s=state([location,business,hidden,player,npc,job]);validateState(s);advance(s,60,randomUUID(),[],player.id);validateState(s);
 const saved=data(s.entities.find(entity=>entity.id===npc.id)!,'character');assert.equal(saved.cash,1200);assert.equal(saved.traitEffectTrace.some(trace=>trace.traitId===hidden.id&&trace.type==='ai-priority'&&trace.target==='work'),true);
 const view=observerView(s,player.id),own=data(view.entities.find(entity=>entity.id===player.id)!,'character');assert.equal(own.traits.includes(hidden.id),false);assert.equal('traitEffectTrace' in view.entities.find(entity=>entity.id===npc.id)!.data,false);
});

test('System 09 first impressions remain contextual descriptors and the seed catalog is complete',()=>{
 const contextual=validateEntity({id:randomUUID(),kind:'trait',name:'Intimidating appearance',visibility:'campaign',data:{category:'physical',effects:[effect('first-impression','local-reading',{scope:{observerContexts:['nightclub']},operation:'describe',description:'Some nightclub patrons read the presentation as intimidating.'})]}}),person=validateEntity({id:randomUUID(),kind:'character',name:'Subject',visibility:'campaign',data:character(null,{traits:[contextual.id]})}),s=state([contextual,person]);
 assert.deepEqual(socialPresentationDescriptors(s,person.id,'street'),[]);assert.equal(socialPresentationDescriptors(s,person.id,'nightclub')[0]!.descriptor,'Some nightclub patrons read the presentation as intimidating.');
 const names=Object.values(traitGroups).flat();for(const required of ['Short','Tall','Slim','Stocky','Overweight','Observant','Calculating','Suspicious','Trusting','Compassionate','Callous','Disciplined','Vindictive','Deceptive','Police training','Military training','Criminal experience','Affiliated','Poor','Working class','Snitch reputation'])assert.equal(names.includes(required),true,required);
});
