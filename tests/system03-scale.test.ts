import {remember} from '../src/game/epistemics.ts';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {settingsSchema,validateEntity,type State} from '../src/game/model.ts';
import {resolveAction} from '../src/game/actions.ts';
import {buildInformationContext} from '../src/game/information-context.ts';
import {information,syncInformation} from '../src/game/information.ts';
import {Game} from '../src/game/engine.ts';
import {fixture,key} from './helpers.ts';

test('System 3 10,000 deterministic resolver turns preserve bounded context without resets',()=>{
 const room=validateEntity({id:key(),kind:'location',name:'Quiet room',visibility:'campaign',data:{}}),pc=validateEntity({id:key(),kind:'character',name:'Soak player',visibility:'owner',data:{playable:true,locationId:room.id}}),s:State={clock:'2012-06-01T12:00:00.000Z',settings:settingsSchema.parse({needs:false,contextTokens:8000}),entities:[room,pc],facts:[],knowledge:[],beliefs:[],memories:[]},scope={campaignId:key(),timelineId:key(),viewerId:pc.id,stateVersion:1,eventCursor:key()};
 remember(s,pc.id,'Promised to meet Nia at the diner.',key(),1,{decayPerDay:0});const retainedMemoryId=s.memories[0]!.id;
 const started=performance.now(),latencies:number[]=[];let maxTokens=0;
 for(let n=1;n<=10000;n++){const eventId=randomUUID(),result=resolveAction(s,pc.id,{type:'wait',minutes:1},eventId,n.toString(16).padStart(64,'0'));assert.ok(result.effects.length);if(n%100===0){syncInformation(s);const began=performance.now(),context=buildInformationContext(s,{...scope,stateVersion:n,eventCursor:eventId},'narration','quiet room',{tokenBudget:8000});latencies.push(performance.now()-began);maxTokens=Math.max(maxTokens,context.manifest.finalEstimatedTokens);assert.ok(context.manifest.ready);assert.ok(context.manifest.finalEstimatedTokens<=8000);}}
 assert.equal(Date.parse(s.clock)-Date.parse('2012-06-01T12:00:00.000Z'),10000*60000);assert.equal(pc.id,scope.viewerId);assert.equal(s.memories.length,1,'Routine waits must not create 10,000 artificial memories');assert.equal(s.memories[0]!.id,retainedMemoryId);assert.match(s.memories[0]!.text,/Promised to meet Nia/);latencies.sort((a,b)=>a-b);console.log(JSON.stringify({system03ResolverSoak:{resolverTurns:10000,persistedCommits:0,elapsedMs:Math.round(performance.now()-started),contextSamples:latencies.length,contextP50Ms:Math.round(latencies[49]!),contextP95Ms:Math.round(latencies[94]!),maxEstimatedInputTokens:maxTokens,providerCalls:0,providerCost:0}}));
});

test('System 3 persisted 50,000-event campaign retrieves current relevant material within budget',async()=>{
 const f=await fixture(),game=new Game(f.store);try{const t=await game.initialize(f.creator,f.campaign.id),room=validateEntity({id:key(),kind:'location',name:'Diner',visibility:'campaign',data:{}}),pc=validateEntity({id:key(),kind:'character',name:'Nathaniel',visibility:'owner',data:{playable:true,controllerUserId:f.player.id,locationId:room.id}});await game.bulkEdit(f.creator,t.id,{revision:1,entities:[room,pc]},key());const started=performance.now(),s=await game.load(t.id),events=Array.from({length:50000},(_,n)=>({id:key(),revision:n+3}));
 await f.store.transaction(async()=>{for(let offset=0;offset<events.length;offset+=500)await f.store.batch(events.slice(offset,offset+500).map(e=>({sql:'INSERT INTO game_events(id,timeline_id,revision,actor_id,character_id,type,input_json,effects_json,seed,rng_draws,clock,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',args:[e.id,t.id,e.revision,f.creator.id,pc.id,'history.fixture','{}','[]','fixture',0,s.clock,s.clock]})));});
 for(const [n,e] of events.entries())s.memories.push({id:key(),observerId:pc.id,text:n===49999?'Nia and Malik promised to meet at the diner Friday.':'Unrelated archived visit '+n,salience:n===49999?1:0.01,decayPerDay:0,eventId:e.id,at:s.clock,private:true});await f.store.transaction(()=>game.persist(t.id,s));const persistedMs=performance.now()-started,loadStarted=performance.now(),loaded=await game.load(t.id),loadMs=performance.now()-loadStarted,contextStarted=performance.now(),context=buildInformationContext(loaded,{campaignId:f.campaign.id,timelineId:t.id,viewerId:pc.id,stateVersion:50002,eventCursor:events.at(-1)!.id},'recap','Nia Malik Friday',{tokenBudget:8000}),contextMs=performance.now()-contextStarted;
 assert.ok(loaded.eventIds!.length>=50000);assert.match(JSON.stringify(context.bundle),/Nia and Malik promised/);assert.ok(context.manifest.finalEstimatedTokens<=8000);assert.ok(contextMs<5000);assert.equal(information(loaded).entries.length,0);console.log(JSON.stringify({system03PersistedCampaign:{fixtureEvents:50000,persistedMemories:50000,persistMs:Math.round(persistedMs),loadMs:Math.round(loadMs),contextMs:Math.round(contextMs),estimatedInputTokens:context.manifest.finalEstimatedTokens,stateBytes:Buffer.byteLength(JSON.stringify(loaded)),providerCalls:0,providerCost:0}}));
 }finally{await f.close();}
});
