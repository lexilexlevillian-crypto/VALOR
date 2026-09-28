import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {fixture,key} from './helpers.ts';
import {Game} from '../src/game/engine.ts';
import {NarrativeGateway} from '../src/game/ai.ts';
import type {NarrativeContext,NarrativeProvider} from '../src/game/ai.ts';
import {chroniclePresentation} from '../src/game/chronicle.ts';
import {validateEntity} from '../src/game/model.ts';

const playerData=(controllerUserId:string,locationId:string)=>({playable:true,controllerUserId,locationId,attributes:{Strength:0,Agility:0,Endurance:0,Intellect:0,Perception:0,Presence:0,Will:0},skills:{},traits:[],condition:'conscious'});

test('System 10 stores observer-filtered scene and change disclosures through save branching',async()=>{
 const f=await fixture(),game=new Game(f.store);
 try{
  const timeline=await game.initialize(f.creator,f.campaign.id),room=validateEntity({id:randomUUID(),kind:'location',name:'Canal apartment',visibility:'campaign',data:{category:'room',description:Array.from({length:50},()=> 'Rain ticks against the fire escape while the room holds its authored details.').join('\n\n')}}),item=validateEntity({id:randomUUID(),kind:'item',name:'Loose brass key',visibility:'campaign',data:{locationId:room.id,description:'A worn key with a blue paint mark.'}}),character=validateEntity({id:randomUUID(),kind:'character',name:'Chronicle player',visibility:'owner',data:playerData(f.player.id,room.id)});
  await game.bulkEdit(f.creator,timeline.id,{revision:1,entities:[room,item,character]},key());
  await game.turn(f.player,timeline.id,{revision:2,characterId:character.id,action:{type:'take',itemId:item.id},text:'I pocket the loose key.'},key());
  const first=await game.view(f.player,timeline.id,character.id) as unknown as {turns:Array<{narration:string;scene:{locationName:string};notices:Array<{category:string;detail:string}>}>};
  assert.equal(first.turns[0]!.scene.locationName,'Canal apartment');assert.equal(first.turns[0]!.notices.some(notice=>notice.category==='items'&&notice.detail.includes('Loose brass key')),true);
  await game.turn(f.player,timeline.id,{revision:3,characterId:character.id,action:{type:'wait',minutes:10},text:'I wait and listen.'},key());
  const second=await game.view(f.player,timeline.id,character.id) as unknown as {turns:Array<{notices:Array<{category:string;detail:string}>}>};
  assert.equal(second.turns[1]!.notices.some(notice=>notice.category==='time'&&notice.detail.includes('+10 min')),true);
  const parsed=await game.parse(f.player,timeline.id,character.id,'inspect Loose brass key');assert.deepEqual(parsed.action,{type:'inspect',targetId:item.id});
  const inspected=await game.turn(f.player,timeline.id,{revision:4,characterId:character.id,action:{type:'inspect',targetId:item.id},text:'I inspect the key.'},key());assert.match(inspected.narration,/blue paint mark/);
  const save=await game.save(f.player,timeline.id,'Chronicle checkpoint'),branch=await game.branch(f.player,timeline.id,save.id,'Chronicle branch'),archived=await game.transcript(branch.id);
  assert.equal(archived.length,3);assert.equal(JSON.parse(archived[0]!.scene_json).locationName,'Canal apartment');assert.equal(JSON.parse(archived[0]!.notices_json).some((notice:{category:string})=>notice.category==='items'),true);
  await f.store.run('UPDATE story_turns SET scene_json=? WHERE id=?','{}',archived[0]!.id);const legacy=await game.view(f.player,timeline.id,character.id) as unknown as {turns:Array<{created_at:string;scene:{clock:string;locationName:null}}>};assert.equal(legacy.turns[0]!.scene.clock,legacy.turns[0]!.created_at);assert.equal(legacy.turns[0]!.scene.locationName,null);
  assert.ok(first.turns[0]!.narration.length<1000,'the item action remains prose-focused rather than dumping state details');
 }finally{await f.close();}
});

test('System 10 change summaries cannot expose Creator-only relationships or evidence',async()=>{
 const f=await fixture(),game=new Game(f.store);
 try{
  const timeline=await game.initialize(f.creator,f.campaign.id),room=validateEntity({id:randomUUID(),kind:'location',name:'Private room',visibility:'campaign',data:{category:'room'}}),player=validateEntity({id:randomUUID(),kind:'character',name:'Observer',visibility:'owner',data:playerData(f.player.id,room.id)}),npc=validateEntity({id:randomUUID(),kind:'character',name:'Known neighbor',visibility:'campaign',data:{playable:false,controllerUserId:null,locationId:room.id}}),relationship=validateEntity({id:randomUUID(),kind:'relationship',name:'Hidden leverage',visibility:'creator',data:{fromId:player.id,toId:npc.id,labels:['secret'],secret:true}}),evidence=validateEntity({id:randomUUID(),kind:'evidence',name:'Undiscovered receipt',visibility:'campaign',data:{locationId:room.id,discoveredBy:[]}});
  await game.bulkEdit(f.creator,timeline.id,{revision:1,entities:[room,player,npc,relationship,evidence]},key());const before=await game.load(timeline.id),after=structuredClone(before);
  after.entities.find(entity=>entity.id===relationship.id)!.data.labels=['secret','changed'];after.entities.find(entity=>entity.id===evidence.id)!.data.description='Creator-only finding';
  const presentation=chroniclePresentation(before,after,player.id);assert.equal(presentation.notices.some(notice=>['relationships','clues'].includes(notice.category)),false);assert.equal(JSON.stringify(presentation).includes('Hidden leverage'),false);assert.equal(JSON.stringify(presentation).includes('Undiscovered receipt'),false);
 }finally{await f.close();}
});

test('System 10 aborts generation before validation without changing the turn or revision',async()=>{
 const f=await fixture(),game=new Game(f.store);
 try{
  const timeline=await game.initialize(f.creator,f.campaign.id),room=validateEntity({id:randomUUID(),kind:'location',name:'Cancellation room',visibility:'campaign',data:{category:'room',description:'The original grounded scene.'}}),character=validateEntity({id:randomUUID(),kind:'character',name:'Cancellation player',visibility:'owner',data:playerData(f.player.id,room.id)});
  await game.bulkEdit(f.creator,timeline.id,{revision:1,entities:[room,character]},key());const turn=await game.turn(f.player,timeline.id,{revision:2,characterId:character.id,action:{type:'look'},text:'I look around.'},key()),prior=await f.store.get<{narration:string;narration_status:string}>('SELECT narration,narration_status FROM story_turns WHERE id=?',turn.eventId),revision=(await game.access(f.player,timeline.id)).t.revision;
  let started!:()=>void;const began=new Promise<void>(resolve=>{started=resolve;});
  const provider:NarrativeProvider={id:'grounded',arrange(_context:NarrativeContext,_signal:AbortSignal){started();return new Promise(()=>{});}};
  const gateway=new NarrativeGateway(game,[provider]),controller=new AbortController(),pending=gateway.narrate(f.player,timeline.id,turn.eventId,'grounded',controller.signal);await began;controller.abort();await assert.rejects(pending,/narration_canceled/);
  const current=await f.store.get<{narration:string;narration_status:string}>('SELECT narration,narration_status FROM story_turns WHERE id=?',turn.eventId),usage=await f.store.get<{status:string}>('SELECT status FROM ai_usage WHERE turn_id=? ORDER BY rowid DESC LIMIT 1',turn.eventId);
  assert.deepEqual(current,prior);assert.equal(usage!.status,'canceled');assert.equal((await game.access(f.player,timeline.id)).t.revision,revision);
 }finally{await f.close();}
});
