import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {advance,npcSimulationTier,simulationTiers} from '../src/game/simulation.ts';
import {data,settingsSchema,validateEntity,validateState} from '../src/game/model.ts';
import type {Effect} from '../src/game/simulation.ts';
import type {Entity,State} from '../src/game/model.ts';

const eventId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const make=(kind:Entity['kind'],name:string,raw:Record<string,unknown>={}):Entity=>validateEntity({id:randomUUID(),kind,name,visibility:'campaign',data:raw});
const state=(entities:Entity[],settings:Record<string,unknown>={}):State=>({clock:'2012-06-01T12:00:00.000Z',settings:settingsSchema.parse({deterministicCatchup:true,npcBudget:2000,...settings}),entities,facts:[],knowledge:[],beliefs:[],memories:[],eventIds:[]});

test('System 16 declares complete tier contracts and deterministic promotion triggers',()=>{
 for(const [name,tier] of Object.entries(simulationTiers)){assert.ok(tier.updateFrequencyMinutes>0,name);assert.ok(tier.deterministicInputs.length,name);assert.ok(tier.permittedOutputs.length,name);assert.ok(tier.escalationCondition,name);}
 const room=make('location','Room'),near=make('location','Hall'),far=make('location','Far');
 room.data.exits=[{to:near.id,minutes:1,modes:['walk'],locked:false,keyId:null,fare:0,interruption:null,terrainPenalty:0,trafficPenalty:0}];
 const pc=make('character','Player',{playable:true,locationId:room.id}),npc=make('character','NPC',{locationId:room.id}),nearNpc=make('character','Near NPC',{locationId:near.id}),farNpc=make('character','Far NPC',{locationId:far.id});
 const s=state([room,near,far,pc,npc,nearNpc,farNpc]);
 assert.deepEqual(npcSimulationTier(s,npc.id,pc.id),{tier:'active',reason:'in the player scene'});
 assert.deepEqual(npcSimulationTier(s,nearNpc.id,pc.id),{tier:'relevant',reason:'near the player'});
 const named:Effect={id:randomUUID(),text:'Named',observers:[],type:'event',subjectId:farNpc.id};
 assert.deepEqual(npcSimulationTier(s,farNpc.id,pc.id,[named]),{tier:'relevant',reason:'named by an active event'});
 assert.equal(npcSimulationTier(s,farNpc.id,pc.id).tier,'distant');
});

test('distant catch-up is deterministic, bounded, and produces only supported causal outcomes',()=>{
 const home=make('location','Home'),work=make('location','Work'),remote=make('location','Player room');
 const pc=make('character','Player',{playable:true,locationId:remote.id});
 const friend=make('character','Friend',{locationId:work.id});
 const npc=make('character','Worker',{locationId:work.id,homeId:home.id});
 const business=make('business','Shop',{locationId:work.id,cash:100000});
 const job=make('job','Shift',{employerId:business.id,employeeId:npc.id,locationId:work.id,hourlyCents:1200,minutesPerShift:60});
 const phone=make('item','Worker phone',{category:'phone',ownerId:npc.id,locked:false,battery:100,contacts:[{characterId:friend.id,label:'Friend'}]});
 const friendPhone=make('item','Friend phone',{category:'phone',ownerId:friend.id,battery:100});
 const plans=[
  {id:randomUUID(),type:'work',targetId:job.id,priority:10,cooldownMinutes:60,maxRunsPerDay:1},
  {id:randomUUID(),type:'call',targetId:friend.id,priority:5,cooldownMinutes:60,maxRunsPerDay:1,text:'Checking in'}
 ];
 npc.data=validateEntity({...npc,data:{...npc.data,plans}}).data;
 const original=state([home,work,remote,pc,friend,npc,business,job,phone,friendPhone]);
 const left=structuredClone(original),right=structuredClone(original),leftEffects:Effect[]=[],rightEffects:Effect[]=[];
 advance(left,180,eventId,leftEffects,pc.id);advance(right,180,eventId,rightEffects,pc.id);
 const leftNpc=data(left.entities.find(entity=>entity.id===npc.id)!,'character'),rightNpc=data(right.entities.find(entity=>entity.id===npc.id)!,'character');
 assert.equal(leftNpc.simulationTier,'distant');
 assert.equal(leftNpc.cash,1200);
 assert.deepEqual(leftNpc.activityTimeline,rightNpc.activityTimeline);
 assert.deepEqual(leftNpc.activityTimeline.map(entry=>entry.outcome),['worked-shift','called-friend']);
 assert.equal(left.entities.filter(entity=>entity.kind==='message').length,1,'daily goal limits prevent initiative spam');
 assert.equal(left.entities.filter(entity=>entity.kind==='evidence').length,0,'a work shift and call cannot invent evidence');
 assert.ok(left.memories.every(memory=>memory.observerId===npc.id),'offscreen goal memories remain private to the acting NPC');
 validateState(left);
});

test('required appointments can be missed without asking AI to invent the rest of the day',()=>{
 const room=make('location','Clinic'),remote=make('location','Remote'),pc=make('character','Player',{playable:true,locationId:remote.id});
 const npc=make('character','Patient',{condition:'unconscious',locationId:remote.id,schedule:[{id:randomUUID(),minute:481,locationId:room.id,activity:'medical appointment',days:[5],kind:'appointment',required:true}]});
 const s=state([room,remote,pc,npc]),effects:Effect[]=[];advance(s,1,eventId,effects,pc.id);
 const updated=data(s.entities.find(entity=>entity.id===npc.id)!,'character');
 assert.equal(updated.locationId,remote.id);
 assert.deepEqual(updated.activityTimeline.map(entry=>entry.outcome),['missed-appointment']);
 assert.equal(s.entities.filter(entity=>entity.kind==='message'||entity.kind==='evidence').length,0);
});

test('group rumors remain leader-sourced and do not grant omniscience',()=>{
 const room=make('location','Club room'),remote=make('location','Remote'),pc=make('character','Player',{playable:true,locationId:remote.id});
 const leader=make('character','Leader',{locationId:room.id}),member=make('character','Member',{locationId:room.id}),outsider=make('character','Outsider',{locationId:room.id});
 const faction=make('faction','Circle',{leaderId:leader.id,memberIds:[leader.id,member.id],groupPolicy:{intervalMinutes:15,cohesionStep:0,shareKnowledge:false,shareMood:false,shareRumors:true,rumorLimit:1,conflictThreshold:0}});
 const s=state([room,remote,pc,leader,member,outsider,faction]);s.beliefs.push({id:randomUUID(),observerId:leader.id,proposition:'A leader-only rumor',confidence:0.9,source:'witness',at:s.clock,correctedBy:null});
 const effects:Effect[]=[];advance(s,15,eventId,effects,pc.id);
 assert.ok(s.beliefs.some(belief=>belief.observerId===member.id&&belief.proposition==='A leader-only rumor'&&belief.source==='group-rumor:'+faction.id));
 assert.ok(!s.beliefs.some(belief=>belief.observerId===outsider.id&&belief.proposition==='A leader-only rumor'));
 assert.equal(s.knowledge.length,0);
});

test('an offscreen crime creates local police knowledge and dispatch without an omniscient instant arrest',()=>{
 const street=make('location','Street'),remote=make('location','Remote'),pc=make('character','Player',{playable:true,locationId:remote.id});
 const officer=make('character','Officer',{locationId:street.id}),npc=make('character','Suspect',{locationId:street.id});
 const police=make('faction','Police',{memberIds:[officer.id],jurisdictionIds:[street.id],dispatchPolicy:{kind:'police',responseMinutes:5}}),posture=make('lawPosture','Local response',{scope:'district',locationId:street.id,reportProbability:100,officerAvailability:100,dispatchMinMinutes:5,dispatchMaxMinutes:5});
 const law=make('law','Local law',{jurisdictionIds:[street.id],agencyIds:[police.id],permits:['arrest']});
 npc.data=validateEntity({...npc,data:{...npc.data,plans:[{id:randomUUID(),type:'crime',targetId:law.id,priority:1,cooldownMinutes:60,maxRunsPerDay:1}]}}).data;
 const s=state([street,remote,pc,officer,npc,law,police,posture]),effects:Effect[]=[];advance(s,60,eventId,effects,pc.id);
 const updated=data(s.entities.find(entity=>entity.id===npc.id)!,'character');
 assert.equal(updated.arrested,false);
 assert.deepEqual(updated.activityTimeline.map(entry=>entry.outcome),['crime-committed']);
 assert.ok(s.entities.some(entity=>entity.kind==='case'&&data(entity,'case').suspectIds.includes(npc.id)));
 assert.ok(s.entities.some(entity=>entity.kind==='dispatch'&&entity.data.kind==='police'));
 assert.ok(s.knowledge.some(record=>record.observerId===officer.id));
 assert.ok(!s.knowledge.some(record=>record.observerId===pc.id),'distant player does not gain police knowledge');
});

test('large distant rosters stay inside configured work and initiative budgets',()=>{
 const room=make('location','Player room'),remote=make('location','Remote'),pc=make('character','Player',{playable:true,locationId:room.id});
 const npcs=Array.from({length:750},(_,index)=>make('character','NPC '+index,{locationId:remote.id}));
 const s=state([room,remote,pc,...npcs],{deterministicCatchup:false,npcBudget:800,npcInitiativeBudget:25}),effects:Effect[]=[];
 advance(s,1,eventId,effects,pc.id);
 assert.equal(npcs.filter(npc=>data(s.entities.find(entity=>entity.id===npc.id)!,'character').lastSimulated===s.clock).length,750);
 assert.equal(effects.length,0);
});
