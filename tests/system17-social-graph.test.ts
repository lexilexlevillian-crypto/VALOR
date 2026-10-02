import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {fixture,key} from './helpers.ts';
import {Game} from '../src/game/engine.ts';
import {resolveAction} from '../src/game/actions.ts';
import {data,relationshipMetrics,settingsSchema,validateEntity,validateState} from '../src/game/model.ts';
import type {Entity,State} from '../src/game/model.ts';
import {applyRelationshipMovement,decayReputations,developerSocialGraph,playerRelationships,recordReputation,relationshipBehaviorSignal} from '../src/game/social.ts';

const eventId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const make=(kind:Entity['kind'],name:string,raw:Record<string,unknown>={},visibility:Entity['visibility']='campaign')=>validateEntity({id:randomUUID(),kind,name,visibility,data:raw});
const state=(entities:Entity[]):State=>({clock:'2012-06-01T12:00:00.000Z',settings:settingsSchema.parse({}),entities,facts:[],knowledge:[],beliefs:[],memories:[],eventIds:[]});

test('directional values, labels, and history remain asymmetric and affect only bounded planning priority',()=>{
 const a=make('character','A'),b=make('character','B');
 const trusts=make('relationship','A → B',{fromId:a.id,toId:b.id,trust:80,inertia:0.8,secret:false,disclosure:'private',knownByIds:[a.id,b.id],labels:['friend'],labelRecords:[{id:randomUUID(),label:'friend',category:'friend',disclosure:'private',knownByIds:[a.id,b.id],status:'active',sourceEventId:eventId,at:'2012-06-01T11:00:00.000Z'}]});
 const fears=make('relationship','B → A',{fromId:b.id,toId:a.id,fear:70,inertia:0.8,secret:true,disclosure:'secret',knownByIds:[b.id],history:[{at:'2012-06-01T11:30:00.000Z',eventId,label:'Threat witnessed',kind:'meaningful',reason:'A credible threat',changes:{fear:14},actorId:a.id,relatedEntityIds:[],disclosure:'secret',knownByIds:[b.id]}]});
 const s=state([a,b,trusts,fears]);validateState(s);
 assert.equal(data(trusts,'relationship').fear,0);assert.equal(data(fears,'relationship').trust,0);
 assert.ok(relationshipBehaviorSignal(s,a.id,b.id,'socialize')>0);assert.ok(relationshipBehaviorSignal(s,b.id,a.id,'socialize')<0);
 const graph=developerSocialGraph(s),edges=graph.edges.filter(edge=>edge.type==='relationship') as Array<{fromId:string;toId:string;metrics:Record<string,number>;history:Array<{reason:string}>}>;
 assert.equal(edges.find(edge=>edge.fromId===a.id)!.metrics.trust,80);assert.equal(edges.find(edge=>edge.fromId===b.id)!.metrics.fear,70);
 assert.equal(edges.find(edge=>edge.fromId===b.id)!.history[0]!.reason,'A credible threat');
});

test('meaningful events respect inertia, thresholds, cooldowns, and preserve an explanatory delta history',()=>{
 const a=make('character','A'),b=make('character','B'),relation=make('relationship','A → B',{fromId:a.id,toId:b.id,inertia:0.8,movementThreshold:1,cooldownMinutes:60});
 const s=state([a,b,relation]);
 assert.equal(applyRelationshipMovement(s,relation,eventId,'Minor chatter',{trust:4},a.id),false);
 assert.equal(data(relation,'relationship').trust,0);
 assert.equal(applyRelationshipMovement(s,relation,eventId,'Kept a serious promise',{trust:10},a.id,[b.id]),true);
 assert.equal(data(relation,'relationship').trust,2);
 assert.equal(applyRelationshipMovement(s,relation,eventId,'Immediate repetition',{trust:50},a.id),false);
 s.clock='2012-06-01T13:00:00.000Z';assert.equal(applyRelationshipMovement(s,relation,eventId,'Later meaningful support',{trust:10},a.id),true);
 const history=data(relation,'relationship').history;assert.deepEqual(history.map(entry=>entry.reason),['Kept a serious promise','Later meaningful support']);assert.deepEqual(history[0]!.changes,{trust:2});
});

test('audience reputation decays deterministically from source events and mirrors legacy faction standing',()=>{
 const subject=make('character','Subject'),gang=make('faction','East Gang',{category:'gang',memberIds:[subject.id]});const s=state([subject,gang]);
 const record=recordReputation(s,gang.id,subject.id,20,eventId,'Protected the block',2,'public',[gang.id]);
 assert.equal(data(record,'reputation').audience.type,'gang');assert.equal(data(gang,'faction').reputation[subject.id],20);
 s.clock='2012-06-06T12:00:00.000Z';decayReputations(s);assert.equal(data(record,'reputation').score,10);assert.equal(data(gang,'faction').reputation[subject.id],10);
 s.clock='2012-06-20T12:00:00.000Z';decayReputations(s);assert.equal(data(record,'reputation').score,0);
 const visible=playerRelationships(s,subject.id);assert.equal(visible.reputations[0]!.score,0);assert.equal(visible.reputations[0]!.sourceEvents[0]!.reason,'Protected the block');
});

test('player relationships expose only known records and never manufacture player emotion',()=>{
 const room=make('location','Room'),player=make('character','Player',{playable:true,locationId:room.id}),npc=make('character','NPC',{locationId:room.id}),other=make('character','Other',{locationId:room.id});
 const known=make('relationship','NPC → Player',{fromId:npc.id,toId:player.id,trust:81,secret:false,disclosure:'private',knownByIds:[npc.id,player.id],labels:['friend']});
 const hidden=make('relationship','Other → Player',{fromId:other.id,toId:player.id,fear:72,secret:true,disclosure:'secret',knownByIds:[other.id]});
 const knownDebt=make('obligation','Loan',{creditorId:npc.id,debtorId:player.id,kind:'debt',terms:'Repay the repair bill',dueCondition:'Next payday',stakes:'Loss of equipment access',disclosure:'private',knownByIds:[npc.id,player.id],sourceEventId:eventId,createdAt:'2012-06-01T10:00:00.000Z'});
 const hiddenFavor=make('obligation','Secret favor',{creditorId:other.id,debtorId:player.id,kind:'favor',terms:'Unknown favor',dueCondition:'Unknown',stakes:'Unknown',disclosure:'secret',knownByIds:[other.id],sourceEventId:eventId,createdAt:'2012-06-01T10:00:00.000Z'});
 const s=state([room,player,npc,other,known,hidden,knownDebt,hiddenFavor]);const safe=playerRelationships(s,player.id),json=JSON.stringify(safe);
 assert.equal(safe.relationships.length,1);assert.equal(safe.obligations.length,1);assert.equal(json.includes('Repay the repair bill'),true);assert.equal(json.includes('Unknown favor'),false);for(const metric of relationshipMetrics)assert.equal(Object.hasOwn(safe.relationships[0]!,metric),false);
 const before=[...relationshipMetrics].map(metric=>data(known,'relationship')[metric]);resolveAction(s,player.id,{type:'social',targetId:npc.id,intent:'greet',consent:false},eventId,'0'.repeat(64));
 assert.deepEqual(relationshipMetrics.map(metric=>data(known,'relationship')[metric]),before);assert.equal(s.entities.some(entity=>entity.kind==='relationship'&&entity.data.fromId===player.id&&entity.data.toId===npc.id),false);
});

test('social graph persists, player access stays filtered, and full graph requires active Developer Mode',async()=>{
 const f=await fixture(),game=new Game(f.store);
 try{
  const timeline=await game.initialize(f.creator,f.campaign.id),room=make('location','Room'),player=make('character','Player',{playable:true,controllerUserId:f.player.id,locationId:room.id},'owner'),npc=make('character','NPC',{locationId:room.id});
  const relation=make('relationship','NPC → Player',{fromId:npc.id,toId:player.id,trust:64,resentment:12,secret:false,disclosure:'private',knownByIds:[npc.id,player.id],labels:['rival']},'owner');
  const obligation=make('obligation','Favor owed',{creditorId:player.id,debtorId:npc.id,kind:'favor',terms:'Provide a safe ride',dueCondition:'When called',stakes:'Trust in the alliance',disclosure:'private',knownByIds:[player.id,npc.id],sourceEventId:eventId,createdAt:'2012-06-01T10:00:00.000Z'},'creator');
  await game.bulkEdit(f.creator,timeline.id,{revision:1,entities:[room,player,npc,relation,obligation]},key());
  const safe=await game.relationships(f.player,timeline.id,player.id),safeJson=JSON.stringify(safe);assert.equal(safe.relationships.length,1);assert.equal(safeJson.includes('"trust"'),false);assert.equal(Object.hasOwn(safe.relationships[0]!,'metrics'),false);
  await assert.rejects(()=>game.socialGraph(f.creator,timeline.id),/developer_mode_required/);
  await f.domain.setUserMode(f.creator,{mode:'developer',expectedRevision:0});const graph=await game.socialGraph(f.creator,timeline.id);
  const edge=graph.edges.find(candidate=>candidate.id===relation.id) as {metrics:Record<string,number>};assert.equal(edge.metrics.trust,64);assert.ok(graph.edges.some(candidate=>candidate.id===obligation.id&&candidate.type==='favor'));
  const reloaded=await game.load(timeline.id);assert.equal(data(reloaded.entities.find(entity=>entity.id===obligation.id)!,'obligation').terms,'Provide a safe ride');validateState(reloaded);
 }finally{await f.close();}
});
