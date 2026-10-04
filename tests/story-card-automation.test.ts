import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {actionSchema,settingsSchema,validateEntity,validateState} from '../src/game/model.ts';
import type {Entity,State} from '../src/game/model.ts';
import type {Effect} from '../src/game/simulation.ts';
import {maintainAutomaticStoryCards} from '../src/game/story-cards.ts';
import {fixture,key} from './helpers.ts';
import {Game} from '../src/game/engine.ts';

const make=(kind:Entity['kind'],name:string,raw:Record<string,unknown>={},visibility:Entity['visibility']='campaign')=>validateEntity({id:randomUUID(),kind,name,visibility,data:raw});
const state=(entities:Entity[],clock='2012-06-01T12:00:00.000Z',settings:Record<string,unknown>={}):State=>({clock,settings:settingsSchema.parse({storyCards:{staleAfterDays:30,archiveAfterDays:90,...settings}}),entities,facts:[],knowledge:[],beliefs:[],memories:[],eventIds:[]});
const effect=(type:string,text:string,subjectId:string,observers:string[]=[]):Effect=>({id:randomUUID(),type,text,subjectId,observers});

test('significant item events create one card and later events refresh its bounded history',()=>{
 const eventOne=randomUUID(),item=make('item','Engraved service pistol',{category:'firearm',price:45000,tags:['story-important']}),before=state([structuredClone(item)]),after=structuredClone(before);
 (after.entities[0]!.data as any).eventHistory.push({at:after.clock,eventId:eventOne,action:'recovered',actorId:null,fromId:null,toId:null,locationId:null,containerId:null,quantity:1,note:'Recovered beneath the floorboards.'});
 const first=maintainAutomaticStoryCards(before,after,eventOne,[effect('weapon.recovered','The engraved pistol was recovered.',item.id)]),cards=after.entities.filter(entity=>entity.kind==='storycard');
 assert.equal(first.created.length,1);assert.equal(cards.length,1);assert.equal((cards[0]!.data as any).lifecycle.status,'active');assert.equal((cards[0]!.data as any).lifecycle.importance,88);
 const eventTwo=randomUUID(),beforeRefresh=structuredClone(after);after.clock='2012-06-02T12:00:00.000Z';
 (after.entities.find(entity=>entity.id===item.id)!.data as any).eventHistory.push({at:after.clock,eventId:eventTwo,action:'disarmed',actorId:null,fromId:null,toId:null,locationId:null,containerId:null,quantity:1,note:'Knocked away during the confrontation.'});
 const second=maintainAutomaticStoryCards(beforeRefresh,after,eventTwo,[effect('weapon.disarmed','The pistol was knocked away.',item.id)]),refreshed=after.entities.filter(entity=>entity.kind==='storycard');
 assert.equal(second.refreshed.length,1);assert.equal(refreshed.length,1);assert.equal((refreshed[0]!.data as any).lifecycle.updates.length,2);assert.deepEqual((refreshed[0]!.data as any).lifecycle.sourceEventIds,[eventOne,eventTwo]);validateState(after);
});

test('routine effects do not create cards and automation can be disabled',()=>{
 const actor=make('character','Walker'),routine=state([actor]),before=structuredClone(routine),eventId=randomUUID();
 maintainAutomaticStoryCards(before,routine,eventId,[effect('look','The room is quiet.',actor.id,[actor.id])]);assert.equal(routine.entities.some(entity=>entity.kind==='storycard'),false);
 const important=state([actor],routine.clock,{automatic:false}),prior=structuredClone(important);
 maintainAutomaticStoryCards(prior,important,randomUUID(),[effect('death','A decisive event occurred.',actor.id,[actor.id])]);assert.equal(important.entities.some(entity=>entity.kind==='storycard'),false);
});

test('terminal subjects resolve cards, stale cards deactivate, and retention archives them',()=>{
 const quest=make('quest','Find the missing witness',{status:'dormant'}),before=state([structuredClone(quest)]),active=structuredClone(before),started=randomUUID();
 (active.entities[0]!.data as any).status='active';maintainAutomaticStoryCards(before,active,started,[effect('event.action','The search began.',quest.id)]);
 const priorTerminal=structuredClone(active),finished=randomUUID();(active.entities.find(entity=>entity.id===quest.id)!.data as any).status='succeeded';active.clock='2012-06-03T12:00:00.000Z';
 const terminal=maintainAutomaticStoryCards(priorTerminal,active,finished,[effect('event.succeeded','The witness was found.',quest.id)]),questCard=active.entities.find(entity=>entity.kind==='storycard')!;
 assert.equal(terminal.refreshed.length,1);assert.equal((questCard.data as any).lifecycle.status,'resolved');assert.equal((questCard.data as any).validUntil,active.clock);
 const beforeArchive=structuredClone(active);active.clock='2012-09-02T12:00:01.000Z';const archived=maintainAutomaticStoryCards(beforeArchive,active,randomUUID(),[]);assert.equal(archived.archived.length,1);assert.equal(questCard.archived,true);

 const item=make('item','Unique ledger',{tags:['story-important']}),fresh=state([structuredClone(item)]),freshBefore=structuredClone(fresh),eventId=randomUUID();
 (fresh.entities[0]!.data as any).eventHistory.push({at:fresh.clock,eventId,action:'acquired',actorId:null,fromId:null,toId:null,locationId:null,containerId:null,quantity:1,note:'Found in a safe.'});
 maintainAutomaticStoryCards(freshBefore,fresh,eventId,[effect('take','The ledger was found.',item.id)]);const card=fresh.entities.find(entity=>entity.kind==='storycard')!;
 const staleBefore=structuredClone(fresh);fresh.clock='2012-07-02T12:00:00.000Z';const stale=maintainAutomaticStoryCards(staleBefore,fresh,randomUUID(),[]);assert.equal(stale.resolved.length,1);assert.equal((card.data as any).lifecycle.status,'stale');
 const retentionBefore=structuredClone(fresh);fresh.clock='2012-10-01T12:00:01.000Z';maintainAutomaticStoryCards(retentionBefore,fresh,randomUUID(),[]);assert.equal(card.archived,true);validateState(fresh);
});

test('the central mutation hook creates a story card for an important item action',async()=>{
 const f=await fixture(),game=new Game(f.store);try{
  const timeline=await game.initialize(f.creator,f.campaign.id),room=make('location','Archive room'),player=make('character','Player',{playable:true,controllerUserId:f.player.id,locationId:room.id},'owner'),item=make('item','The coded ledger',{locationId:room.id,tags:['story-important']});
  await game.bulkEdit(f.creator,timeline.id,{revision:1,entities:[room,player,item]},key());let loaded=await game.load(timeline.id);assert.equal(loaded.entities.some(entity=>entity.kind==='storycard'),false);
  const revision=(await game.access(f.player,timeline.id)).t.revision;await game.turn(f.player,timeline.id,{revision,characterId:player.id,action:actionSchema.parse({type:'take',itemId:item.id})},key());loaded=await game.load(timeline.id);
  const cards=loaded.entities.filter(entity=>entity.kind==='storycard');assert.equal(cards.length,1);assert.equal((cards[0]!.data as any).subjectId,item.id);assert.equal((cards[0]!.data as any).lifecycle.mode,'automatic');
 }finally{await f.close();}
});
