import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {fixture,key} from './helpers.ts';
import {Game} from '../src/game/engine.ts';
import {data,validateEntity} from '../src/game/model.ts';
import {skillNames} from '../src/game/catalog.ts';

const base=(locationId:string|null,controllerUserId:string|null,extra:Record<string,unknown>={})=>({
 playable:!!controllerUserId,controllerUserId,locationId,attributes:{Strength:20,Agility:20,Endurance:20,Intellect:20,Perception:20,Presence:20,Will:20},skills:{},traits:[],cash:1000,condition:'conscious',...extra
});
const catalogData=(extra:Record<string,unknown>={})=>({category:'skill',description:'Creator-authored mechanics record',...extra});
const checkData=(skillId:string,extra:Record<string,unknown>={})=>({description:'A bounded authored check',attribute:'Strength',skillId,difficulty:20,formula:'additive-no-die',rollMode:'roll',context:'door',requiredTraits:[],requiredEquipmentTags:[],equipmentModifier:0,contextModifiers:{door:0},conditionModifiers:{},outcomeMode:'configured-bands',outcomeBands:{criticalMargin:10,successAtCostMargin:2,partialFailureMargin:-2,failureInformationMargin:-10},...extra});
const rules={dieSides:6,threshold:20,damage:5,treatmentMinutes:5,recoveryPerDay:5,unfamiliarPenalty:0,bleedPerMinute:0,formula:'additive-no-die',outcomeMode:'configured-bands',outcomeBands:{criticalMargin:10,successAtCostMargin:2,partialFailureMargin:-2,failureInformationMargin:-10}};

test('System 08 records deterministic checks with named modifiers and no reroll on retry',async()=>{
 const f=await fixture(),game=new Game(f.store);
 try{
  const timeline=await game.initialize(f.creator,f.campaign.id),location=validateEntity({id:randomUUID(),kind:'location',name:'Mechanics room',visibility:'campaign',data:{category:'room'}});
  const skill=validateEntity({id:randomUUID(),kind:'skill',name:'Investigation',visibility:'campaign',data:catalogData({scale:{min:0,max:20,step:1,unit:'rating'},training:{minutesPerPoint:60,practiceMinutesPerPoint:0,costCentsPerHour:0,trainerRequired:false,requiresMilestone:false}})});
  const trait=validateEntity({id:randomUUID(),kind:'trait',name:'Focused',visibility:'campaign',data:{category:'personality',modifiers:{Strength:3}}});
  const definition=validateEntity({id:randomUUID(),kind:'checkDefinition',name:'Door check',visibility:'campaign',data:checkData(skill.id)});
  const player=validateEntity({id:randomUUID(),kind:'character',name:'Mechanic player',visibility:'owner',data:base(location.id,f.player.id,{skills:{[skill.id]:10},traits:[trait.id]})});
  await game.bulkEdit(f.creator,timeline.id,{revision:1,entities:[location,skill,trait,definition,player]},key());
  await game.configure(f.creator,timeline.id,2,{rules},key());
  const retryKey=key(),first=await game.turn(f.player,timeline.id,{revision:3,characterId:player.id,action:{type:'check',attribute:'Strength',skillId:skill.id,checkId:definition.id,context:'door'}},retryKey);
  const checks=await f.store.all<Record<string,unknown>>('SELECT * FROM check_records WHERE timeline_id=?',timeline.id);
  assert.equal(checks.length,1);assert.equal(checks[0]!.attribute,'Strength');assert.equal(checks[0]!.skill_id,skill.id);assert.equal(checks[0]!.outcome,'critical');assert.deepEqual(JSON.parse(String(checks[0]!.modifiers_json)),[{kind:'trait',name:'Trait: Focused',value:3,sourceId:trait.id}]);
  const retry=await game.turn(f.player,timeline.id,{revision:3,characterId:player.id,action:{type:'check',attribute:'Strength',skillId:skill.id,checkId:definition.id,context:'door'}},retryKey);
  assert.equal(retry.eventId,first.eventId);
  assert.equal((await f.store.get<{n:number}>('SELECT count(*) n FROM check_records WHERE timeline_id=?',timeline.id))!.n,1);
  const history=await game.checks(f.player,timeline.id,player.id) as unknown as {outcome:string}[];assert.equal(history.length,1);assert.equal(history[0]!.outcome,'critical');
 }finally{await f.close();}
});

test('System 08 supports impossible and no-roll outcomes without inventing success',async()=>{
 const f=await fixture(),game=new Game(f.store);
 try{
  const timeline=await game.initialize(f.creator,f.campaign.id),location=validateEntity({id:randomUUID(),kind:'location',name:'Uncertainty room',visibility:'campaign',data:{category:'room'}});
  const skill=validateEntity({id:randomUUID(),kind:'skill',name:'Lockpicking',visibility:'campaign',data:catalogData()});
  const impossible=validateEntity({id:randomUUID(),kind:'checkDefinition',name:'Requires pick',visibility:'campaign',data:checkData(skill.id,{requiredEquipmentTags:['lockpick']})});
  const noRoll=validateEntity({id:randomUUID(),kind:'checkDefinition',name:'No uncertainty',visibility:'campaign',data:checkData(skill.id,{rollMode:'no-roll'})});
  const player=validateEntity({id:randomUUID(),kind:'character',name:'No tool player',visibility:'owner',data:base(location.id,f.player.id,{skills:{[skill.id]:1}})});
  await game.bulkEdit(f.creator,timeline.id,{revision:1,entities:[location,skill,impossible,noRoll,player]},key());
  await game.configure(f.creator,timeline.id,2,{rules},key());
  await game.turn(f.player,timeline.id,{revision:3,characterId:player.id,action:{type:'check',attribute:'Strength',skillId:skill.id,checkId:impossible.id,context:'door'}},key());
  await game.turn(f.player,timeline.id,{revision:4,characterId:player.id,action:{type:'check',attribute:'Strength',skillId:skill.id,checkId:noRoll.id,context:'door'}},key());
  const rows=await f.store.all<{outcome:string;die_value:number|null}>('SELECT outcome,die_value FROM check_records WHERE timeline_id=? ORDER BY rowid',timeline.id);
  assert.deepEqual(rows.map(row=>row.outcome),['impossible','no-roll']);assert.equal(rows[0]!.die_value,null);assert.equal(rows[1]!.die_value,null);
 }finally{await f.close();}
});

test('System 08 training enforces prerequisites, trainer presence, time, cost, and one-point advancement',async()=>{
 const f=await fixture(),game=new Game(f.store);
 try{
  const timeline=await game.initialize(f.creator,f.campaign.id),location=validateEntity({id:randomUUID(),kind:'location',name:'Training room',visibility:'campaign',data:{category:'room'}});
  const prerequisite=validateEntity({id:randomUUID(),kind:'skill',name:'Basics',visibility:'campaign',data:catalogData()});
  const advanced=validateEntity({id:randomUUID(),kind:'skill',name:'Advanced mechanics',visibility:'campaign',data:catalogData({prerequisites:[prerequisite.id],scale:{min:0,max:5,step:1,unit:'rank'},training:{minutesPerPoint:60,practiceMinutesPerPoint:0,costCentsPerHour:100,trainerRequired:true,requiresMilestone:false}})});
  const locked=validateEntity({id:randomUUID(),kind:'skill',name:'Locked specialization',visibility:'campaign',data:catalogData({prerequisites:[advanced.id]})});
  const trainer=validateEntity({id:randomUUID(),kind:'character',name:'Trainer',visibility:'campaign',data:base(location.id,null,{playable:false})});
  const player=validateEntity({id:randomUUID(),kind:'character',name:'Student',visibility:'owner',data:base(location.id,f.player.id,{skills:{[prerequisite.id]:1},cash:500})});
  await game.bulkEdit(f.creator,timeline.id,{revision:1,entities:[location,prerequisite,advanced,locked,trainer,player]},key());
  await assert.rejects(()=>game.turn(f.player,timeline.id,{revision:2,characterId:player.id,action:{type:'train',skillId:locked.id,attribute:null,trainerId:trainer.id,source:'',mode:'instruction',minutes:60,milestoneReached:false}},key()),/skill_prerequisite_required/);
  await assert.rejects(()=>game.turn(f.player,timeline.id,{revision:2,characterId:player.id,action:{type:'train',skillId:advanced.id,attribute:null,trainerId:null,source:'',mode:'instruction',minutes:60,milestoneReached:false}},key()),/trainer_required/);
  const result=await game.turn(f.player,timeline.id,{revision:2,characterId:player.id,action:{type:'train',skillId:advanced.id,attribute:null,trainerId:trainer.id,source:'',mode:'instruction',minutes:60,milestoneReached:false}},key());
  assert.match(result.narration,/advanced to 1/);
  const state=await game.load(timeline.id),saved=state.entities.find(e=>e.id===player.id)!;const savedData=saved.data as unknown as {skills:Record<string,number>;cash:number;training:{status:string;minutesInvested:number}[]};
  assert.equal(savedData.skills[advanced.id],1);assert.equal(savedData.cash,400);assert.equal(savedData.training[0]!.status,'completed');assert.equal(savedData.training[0]!.minutesInvested,60);
  assert.equal((await f.store.get<{clock:string}>('SELECT clock FROM timelines WHERE id=?',timeline.id))!.clock,'2012-06-01T13:00:00.000Z');
 }finally{await f.close();}
});

test('System 08 exposes every configured result category with complete provenance',async()=>{
 const f=await fixture(),game=new Game(f.store);
 try{
  const timeline=await game.initialize(f.creator,f.campaign.id),location=validateEntity({id:randomUUID(),kind:'location',name:'Outcome room',visibility:'campaign',data:{category:'room'}});
  const skill=validateEntity({id:randomUUID(),kind:'skill',name:'Search',visibility:'campaign',data:catalogData()});
  const cases=[['critical',10],['success',15],['success-at-cost',19],['partial',21],['failure-with-information',25],['failure-with-consequence',31]] as const;
  const definitions=cases.map(([outcome,difficulty])=>validateEntity({id:randomUUID(),kind:'checkDefinition',name:outcome,visibility:'campaign',data:checkData(skill.id,{difficulty})}));
  const player=validateEntity({id:randomUUID(),kind:'character',name:'Outcome player',visibility:'owner',data:base(location.id,f.player.id,{skills:{[skill.id]:0}})});
  await game.bulkEdit(f.creator,timeline.id,{revision:1,entities:[location,skill,...definitions,player]},key());await game.configure(f.creator,timeline.id,2,{rules},key());
  for(let index=0;index<definitions.length;index++)await game.turn(f.player,timeline.id,{revision:3+index,characterId:player.id,action:{type:'check',attribute:'Strength',skillId:skill.id,checkId:definitions[index]!.id,context:'door'}},key());
  const rows=await f.store.all<{outcome:string;provenance_json:string}>('SELECT outcome,provenance_json FROM check_records WHERE timeline_id=? ORDER BY rowid',timeline.id);
  assert.deepEqual(rows.map(row=>row.outcome),cases.map(([outcome])=>outcome));
  const provenance=JSON.parse(rows[3]!.provenance_json);assert.equal(provenance.margin,-1);assert.equal(provenance.attribute.name,'Strength');assert.equal(provenance.skill.name,'Search');assert.equal(provenance.resolutionReason,'authored-formula');
 }finally{await f.close();}
});

test('System 08 scopes experience modifiers to the authored skill and context',async()=>{
 const f=await fixture(),game=new Game(f.store);
 try{
  assert.throws(()=>validateEntity({id:randomUUID(),kind:'trait',name:'Blanket police bonus',visibility:'campaign',data:{category:'experience',modifiers:{Intellect:5}}}),/experience_modifiers_require_scope/);
  const timeline=await game.initialize(f.creator,f.campaign.id),location=validateEntity({id:randomUUID(),kind:'location',name:'Scope room',visibility:'campaign',data:{category:'room'}});
  const procedure=validateEntity({id:randomUUID(),kind:'skill',name:'Police procedure',visibility:'campaign',data:catalogData()}),forensics=validateEntity({id:randomUUID(),kind:'skill',name:'Investigation',visibility:'campaign',data:catalogData()});
  const experience=validateEntity({id:randomUUID(),kind:'trait',name:'Police academy',visibility:'creator',data:{category:'experience',scopedCheckModifiers:[{name:'Patrol procedure',value:5,attribute:'Intellect',skillId:procedure.id,contexts:['patrol']}]}});
  const patrol=validateEntity({id:randomUUID(),kind:'checkDefinition',name:'Patrol check',visibility:'campaign',data:checkData(procedure.id,{attribute:'Intellect',context:'patrol'})}),lab=validateEntity({id:randomUUID(),kind:'checkDefinition',name:'Lab check',visibility:'campaign',data:checkData(forensics.id,{attribute:'Intellect',context:'lab'})});
  const player=validateEntity({id:randomUUID(),kind:'character',name:'Scoped player',visibility:'owner',data:base(location.id,f.player.id,{skills:{[procedure.id]:1,[forensics.id]:1},traits:[experience.id]})});
  await game.bulkEdit(f.creator,timeline.id,{revision:1,entities:[location,procedure,forensics,experience,patrol,lab,player]},key());await game.configure(f.creator,timeline.id,2,{rules},key());
  await game.turn(f.player,timeline.id,{revision:3,characterId:player.id,action:{type:'check',attribute:'Intellect',skillId:procedure.id,checkId:patrol.id,context:'patrol'}},key());
  await game.turn(f.player,timeline.id,{revision:4,characterId:player.id,action:{type:'check',attribute:'Intellect',skillId:forensics.id,checkId:lab.id,context:'lab'}},key());
  const rows=await f.store.all<{modifiers_json:string}>('SELECT modifiers_json FROM check_records WHERE timeline_id=? ORDER BY rowid',timeline.id);
  assert.deepEqual(JSON.parse(rows[0]!.modifiers_json),[{kind:'trait',name:'Trait: Police academy / Patrol procedure',value:5,sourceId:experience.id}]);assert.deepEqual(JSON.parse(rows[1]!.modifiers_json),[]);
  const playerHistory=await game.checks(f.player,timeline.id,player.id) as Array<{modifiers:Array<{name:string;sourceId?:string}>}>,creatorHistory=await game.checks(f.creator,timeline.id,player.id) as Array<{modifiers:Array<{name:string;sourceId?:string}>}>;
  assert.deepEqual(playerHistory[1]!.modifiers,[]);assert.doesNotMatch(JSON.stringify(playerHistory),/Police academy|modifiers_json|provenance_json/);assert.match(creatorHistory[1]!.modifiers[0]!.name,/Police academy/);
 }finally{await f.close();}
});

test('System 08 separates instruction, practice, source, milestone, cost, and authored scale step',async()=>{
 const f=await fixture(),game=new Game(f.store);
 try{
  const timeline=await game.initialize(f.creator,f.campaign.id),location=validateEntity({id:randomUUID(),kind:'location',name:'Practice room',visibility:'campaign',data:{category:'room'}});
  const skill=validateEntity({id:randomUUID(),kind:'skill',name:'Trade craft',visibility:'campaign',data:catalogData({scale:{min:0,max:20,step:5,unit:'rank'},ranks:[{name:'Novice',min:0,max:5},{name:'Practiced',min:5,max:10}],training:{minutesPerPoint:60,practiceMinutesPerPoint:30,costCentsPerHour:120,trainerRequired:true,requiresMilestone:true}})});
  const trainer=validateEntity({id:randomUUID(),kind:'character',name:'Journeyman',visibility:'campaign',data:base(location.id,null,{playable:false})}),player=validateEntity({id:randomUUID(),kind:'character',name:'Apprentice',visibility:'owner',data:base(location.id,f.player.id,{skills:{[skill.id]:0},cash:500})});
  await game.bulkEdit(f.creator,timeline.id,{revision:1,entities:[location,skill,trainer,player]},key());
  await game.turn(f.player,timeline.id,{revision:2,characterId:player.id,action:{type:'train',skillId:skill.id,attribute:null,trainerId:trainer.id,source:'Union apprenticeship',mode:'instruction',minutes:60,milestoneReached:false}},key());
  let saved=(await game.load(timeline.id)).entities.find(entity=>entity.id===player.id)!,savedData=data(saved,'character');assert.equal(savedData.skills[skill.id],0);assert.equal(savedData.cash,380);
  await game.turn(f.player,timeline.id,{revision:3,characterId:player.id,action:{type:'train',skillId:skill.id,attribute:null,trainerId:null,source:'Workshop practice',mode:'practice',minutes:30,milestoneReached:true}},key());
  saved=(await game.load(timeline.id)).entities.find(entity=>entity.id===player.id)!;savedData=data(saved,'character');const record=savedData.training[0]!;
  assert.equal(savedData.skills[skill.id],5);assert.equal(savedData.cash,380);assert.equal(record.source,'Union apprenticeship');assert.equal(record.trainerId,trainer.id);assert.equal(record.minutesInvested,60);assert.equal(record.practiceMinutes,30);assert.equal(record.costPaidCents,120);assert.equal(record.milestoneReached,true);
  const invalid=structuredClone(saved),invalidData=data(invalid,'character');invalidData.skills[skill.id]=7;invalid.data=invalidData;await assert.rejects(()=>game.edit(f.creator,timeline.id,{revision:4,entity:invalid},key()),/skill_step_mismatch/);
 }finally{await f.close();}
});

test('System 08 editable catalog includes the grounded skill families',()=>{
 for(const required of ['Hand-to-hand','Firearms: handguns','Firearms: rifles','Firearms: shotguns','Melee','Improvised weapons','Driving','Athletics','Stealth','Lockpicking','Pickpocketing','Burglary','Streetwise','Deception','Persuasion','Intimidation','Empathy / insight','Investigation','Search','First aid','Mechanics','2012 electronics / computers','Cooking','Trade / occupation','Academics','Literacy','Languages','Police procedure','Law','Criminal knowledge'])assert.equal(skillNames.includes(required),true,required);
});
