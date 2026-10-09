import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {fixture,key} from './helpers.ts';
import {Game} from '../src/game/engine.ts';
import {attributes,data,settingsSchema,validateEntity,validateState} from '../src/game/model.ts';
import type {State} from '../src/game/model.ts';
import {validateStartingBuild,applyPlayerChoices} from '../src/game/creation.ts';
import {startingBudget,stockTrait,ORIGINS} from '../public/creation-rules.js';
import {resolveAction} from '../src/game/actions.ts';
const state=(entities:ReturnType<typeof validateEntity>[]):State=>({clock:'2012-06-01T12:00:00.000Z',settings:settingsSchema.parse({}),entities,facts:[],knowledge:[],beliefs:[],memories:[]});
const person=(extra:Record<string,unknown>={})=>validateEntity({id:randomUUID(),kind:'character',name:'Build',visibility:'campaign',data:{playable:true,...extra}});
test('starting budgets normalize campaign scales, cap refunds, and exempt NPCs',()=>{
 const skill=validateEntity({id:randomUUID(),kind:'skill',name:'Test skill',visibility:'campaign',data:{scale:{min:-10,max:30,step:.25}}});
 const positive=validateEntity({id:randomUUID(),kind:'trait',name:'Positive',visibility:'campaign',data:{mode:'costed',cost:10}}),negative=validateEntity({id:randomUUID(),kind:'trait',name:'Negative',visibility:'campaign',data:{mode:'costed',cost:-20}});
 const pc=person({attributes:Object.fromEntries(attributes.map(a=>[a,50])),skills:{[skill.id]:10},traits:[positive.id,negative.id]}),s=state([skill,positive,negative,pc]),c=data(pc,'character');
 const budget=validateStartingBuild(s,c)!;assert.equal(budget.attributes,35);assert.equal(budget.skills,2.5);assert.equal(budget.refund,6);assert.equal(budget.traits,4);
 c.attributes.Strength=60;assert.throws(()=>validateStartingBuild(s,c),/starting_attributes_budget_exceeded/);
 c.playable=false;assert.doesNotThrow(()=>validateStartingBuild(s,c));pc.data={...pc.data,playable:false,traits:[positive.id],attributes:Object.fromEntries(attributes.map(key=>[key,100]))};assert.doesNotThrow(()=>validateState(s));
 c.playable=true;c.attributes.Strength=50;c.traits=[positive.id];assert.throws(()=>validateStartingBuild(s,c),/starting_traits_budget_exceeded/);
 assert.equal(startingBudget({...c,traits:[]},s.entities,s.settings.attributeScale).traits,0);
 assert.ok(ORIGINS.every(origin=>Object.keys(origin.modifiers).length===0));
 assert.equal(stockTrait('Police training')?.skill,'Police procedure');
});
test('published starts enforce budgets on the server and reject private choices atomically',async()=>{
 const f=await fixture(),game=new Game(f.store);
 try{
  const t=await game.initialize(f.creator,f.campaign.id);await game.installCatalog(f.creator,t.id,1,key());
  const s=await game.load(t.id),strong=s.entities.find(e=>e.kind==='trait'&&e.name==='Strong')!,weak=s.entities.find(e=>e.kind==='trait'&&e.name==='Weak')!;
  assert.equal(strong.data.cost,4);assert.equal(weak.data.cost,-4);assert.deepEqual(strong.data.modifiers,{Strength:2});
  const hidden=validateEntity({id:randomUUID(),kind:'trait',name:'Secret trait',visibility:'creator',data:{}});
  await game.edit(f.creator,t.id,{revision:2,entity:hidden},key());
  const pkg=await game.createStartPackage(f.creator,t.id,{name:'Public start',slug:'public',kind:'guided',visibility:'campaign',status:'published',definition:{character:{name:'New player',description:'',data:{background:{history:'Keep authored history'}}},grantEntityIds:[],relationshipTemplates:[],reputation:[],plotHookIds:[],requiresSystems:[]}},key());
  const high=Object.fromEntries(attributes.map(a=>[a,100]));
  await assert.rejects(()=>game.start(f.player,t.id,{revision:3,packageId:pkg.id,choices:{attributes:high}},key()),/starting_attributes_budget_exceeded/);
  await assert.rejects(()=>game.start(f.player,t.id,{revision:3,packageId:pkg.id,choices:{traits:[hidden.id]}},key()),/creation_option_unavailable/);
  assert.equal((await game.roster(f.player,t.id)).length,0);
  const options=await game.creationOptions(f.player,t.id);assert.equal(options.entities.some(e=>e.id===hidden.id),false);
  const result=await game.start(f.player,t.id,{revision:3,packageId:pkg.id,choices:{attributes:Object.fromEntries(attributes.map(a=>[a,40])),traits:[strong.id],background:{originChoice:'laborer',history:'Do not overwrite'}}},key());
  const loaded=await game.load(t.id),pc=data(loaded.entities.find(e=>e.id===result.characterId)!,'character');
  assert.equal(pc.controllerUserId,f.player.id);assert.equal(pc.background.history,'Keep authored history');assert.equal(pc.background.originChoice,'laborer');
  const custom=structuredClone(strong);custom.data.modifiers={Strength:3};custom.data.description='Creator custom effects';
  await game.edit(f.creator,t.id,{revision:4,entity:custom},key());await game.installCatalog(f.creator,t.id,5,key());
  assert.deepEqual((await game.load(t.id)).entities.find(e=>e.id===strong.id)!.data.modifiers,{Strength:3});
 }finally{await f.close();}
});
test('background skill training does not add attribute check bonuses or rewrite base stats',()=>{
 const pc=person({background:{originChoice:'laborer'},attributes:Object.fromEntries(attributes.map(a=>[a,5]))});
 const check=validateEntity({id:randomUUID(),kind:'checkDefinition',name:'Strength test',visibility:'campaign',data:{attribute:'Strength',difficulty:1,formula:'additive-no-die'}});
 const s=state([pc,check]);s.settings.rules={dieSides:20,threshold:1,damage:1,treatmentMinutes:1,recoveryPerDay:1,unfamiliarPenalty:0,bleedPerMinute:0,formula:'additive-no-die',outcomeMode:'legacy-binary',outcomeBands:{criticalMargin:10,successAtCostMargin:2,partialFailureMargin:-2,failureInformationMargin:-10}};
 const before=structuredClone(pc.data.attributes);
 const result=resolveAction(s,pc.id,{type:'check',attribute:'Strength',skillId:null,checkId:check.id,context:''},randomUUID(),'a'.repeat(64));assert.equal(result.checks[0]!.total,5);assert.equal(result.checks[0]!.modifiers.filter(row=>row.name==='Background: Manual laborer').length,0);
 (pc.data.background as Record<string,string>).originChoice='student';const changed=resolveAction(s,pc.id,{type:'check',attribute:'Strength',skillId:null,checkId:check.id,context:''},randomUUID(),'a'.repeat(64));assert.equal(changed.checks[0]!.total,5);
 assert.equal(ORIGINS.find(row=>row.id==='laborer')!.skills.Athletics,.5);
 assert.deepEqual(pc.data.attributes,before);
 assert.throws(()=>applyPlayerChoices(state([pc]),{traits:[randomUUID()]},{traits:[]}),/authored_start_not_customizable/);
});
test('turning an unrestricted NPC into a playable character checks the starting budget',async()=>{
 const f=await fixture(),game=new Game(f.store);
 try{
  const t=await game.initialize(f.creator,f.campaign.id),npc=person({playable:false,attributes:Object.fromEntries(attributes.map(key=>[key,100]))});
  await game.edit(f.creator,t.id,{revision:1,entity:npc},key());
  const playable=structuredClone(npc);playable.data.playable=true;
  await assert.rejects(()=>game.edit(f.creator,t.id,{revision:2,entity:playable},key()),/starting_attributes_budget_exceeded/);
  assert.equal((await game.load(t.id)).entities.find(e=>e.id===npc.id)!.data.playable,false);
 }finally{await f.close();}
});
