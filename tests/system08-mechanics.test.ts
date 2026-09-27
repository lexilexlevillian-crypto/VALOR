import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {fixture,key} from './helpers.ts';
import {Game} from '../src/game/engine.ts';
import {validateEntity} from '../src/game/model.ts';

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
  assert.equal(checks.length,1);assert.equal(checks[0]!.attribute,'Strength');assert.equal(checks[0]!.skill_id,skill.id);assert.equal(checks[0]!.outcome,'critical');assert.deepEqual(JSON.parse(String(checks[0]!.modifiers_json)),[{name:'Trait: Focused',value:3,sourceId:trait.id}]);
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
  await assert.rejects(()=>game.turn(f.player,timeline.id,{revision:2,characterId:player.id,action:{type:'train',skillId:locked.id,attribute:null,trainerId:trainer.id,minutes:60,milestoneReached:false}},key()),/skill_prerequisite_required/);
  await assert.rejects(()=>game.turn(f.player,timeline.id,{revision:2,characterId:player.id,action:{type:'train',skillId:advanced.id,attribute:null,trainerId:null,minutes:60,milestoneReached:false}},key()),/trainer_required/);
  const result=await game.turn(f.player,timeline.id,{revision:2,characterId:player.id,action:{type:'train',skillId:advanced.id,attribute:null,trainerId:trainer.id,minutes:60,milestoneReached:false}},key());
  assert.match(result.narration,/advanced to 1/);
  const state=await game.load(timeline.id),saved=state.entities.find(e=>e.id===player.id)!;const savedData=saved.data as unknown as {skills:Record<string,number>;cash:number;training:{status:string;minutesInvested:number}[]};
  assert.equal(savedData.skills[advanced.id],1);assert.equal(savedData.cash,400);assert.equal(savedData.training[0]!.status,'completed');assert.equal(savedData.training[0]!.minutesInvested,60);
  assert.equal((await f.store.get<{clock:string}>('SELECT clock FROM timelines WHERE id=?',timeline.id))!.clock,'2012-06-01T13:00:00.000Z');
 }finally{await f.close();}
});
