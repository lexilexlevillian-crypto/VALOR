import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {actionSchema,data,settingsSchema,validateEntity,validateState} from '../src/game/model.ts';
import type {Entity,State} from '../src/game/model.ts';
import {resolveAction} from '../src/game/actions.ts';
import {inventoryView,itemPossessor} from '../src/game/items.ts';
import {fixture,key} from './helpers.ts';
import {Game} from '../src/game/engine.ts';

const eventId='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',seed='2'.repeat(64);
const make=(kind:Entity['kind'],name:string,raw:Record<string,unknown>={},visibility:Entity['visibility']='campaign')=>validateEntity({id:randomUUID(),kind,name,visibility,data:raw});
const state=(entities:Entity[]):State=>({clock:'2012-06-01T12:00:00.000Z',settings:settingsSchema.parse({}),entities,facts:[],knowledge:[],beliefs:[],memories:[],eventIds:[]});
const act=(s:State,actorId:string,raw:unknown)=>resolveAction(s,actorId,actionSchema.parse(raw),eventId,seed);

test('item types define physical, legal, stack, and instance schemas while unique records cannot become counts',()=>{
 const owner=make('character','Owner'),definition=make('itemType','Evidence envelope',{category:'document',dimensions:{lengthCm:30,widthCm:22,heightCm:1,weightKg:.2},legal:{classification:'restricted',carry:'permit',permitTags:['evidence-tech'],notes:'Seal required'},defaultCondition:95,stackability:{mode:'unique',maxStack:1},instanceSchema:{sealNumber:'string'},capacity:{weightKg:0,volumeLiters:0}}),item=make('item','Envelope',{typeId:definition.id,category:'document',ownerId:owner.id,possessorId:owner.id,instanceData:{sealNumber:'A-19'},markings:['case-19'],provenance:'Collected at scene'}),s=state([owner,definition,item]);
 validateState(s);assert.equal(data(definition,'itemType').legal.carry,'permit');assert.equal(data(item,'item').instanceData.sealNumber,'A-19');
 assert.throws(()=>act(s,owner.id,{type:'equip',itemId:item.id,equipped:true}),/item_carry_permit_required/);owner.data.tags=['evidence-tech'];act(s,owner.id,{type:'equip',itemId:item.id,equipped:true});assert.equal(item.data.equipped,true);
 assert.throws(()=>make('item','Invalid phone stack',{category:'phone',quantity:2}),/unique_item_quantity/);
 const bad=structuredClone(item);bad.data.instanceData={};assert.throws(()=>validateState(state([owner,definition,bad])),/item_instance_schema/);
});

test('partial transfer is atomic, creates a durable instance, and separates ownership from possession',()=>{
 const room=make('location','Room'),player=make('character','Player',{locationId:room.id,playable:true}),npc=make('character','NPC',{locationId:room.id}),ammo=make('item','Nine millimeter rounds',{category:'ammo',quantity:10,ownerId:player.id,possessorId:player.id}),s=state([room,player,npc,ammo]);
 assert.throws(()=>act(s,player.id,{type:'transfer-item',itemId:ammo.id,toId:npc.id,quantity:11}),/invalid_transfer_quantity/);assert.equal(data(ammo,'item').quantity,10);assert.equal(s.entities.length,4);
 act(s,player.id,{type:'transfer-item',itemId:ammo.id,toId:npc.id,quantity:3,transferOwnership:false});const moved=s.entities.find(entity=>entity.kind==='item'&&entity.id!==ammo.id)!;
 assert.equal(data(ammo,'item').quantity,7);assert.equal(data(moved,'item').quantity,3);assert.equal(data(moved,'item').ownerId,player.id);assert.equal(itemPossessor(s,moved),npc.id);assert.ok(data(moved,'item').eventHistory.some(entry=>entry.action==='transferred'));validateState(s);
});

test('theft changes possession without erasing ownership or provenance',()=>{
 const room=make('location','Room'),thief=make('character','Thief',{locationId:room.id,attributes:{Strength:50,Agility:100,Endurance:50,Intellect:50,Perception:50,Presence:50,Will:50}}),owner=make('character','Owner',{locationId:room.id}),keyItem=make('item','Apartment key',{category:'key',ownerId:owner.id,possessorId:owner.id,equipped:true,provenance:'Issued by landlord'}),s=state([room,thief,owner,keyItem]);
 s.settings.rules={dieSides:6,threshold:1,damage:1,treatmentMinutes:1,recoveryPerDay:1,unfamiliarPenalty:0,bleedPerMinute:0,formula:'additive-no-die',outcomeMode:'legacy-binary',outcomeBands:{criticalMargin:10,successAtCostMargin:2,partialFailureMargin:-2,failureInformationMargin:-10}};
 act(s,thief.id,{type:'steal',itemId:keyItem.id,targetId:owner.id});const item=data(keyItem,'item');assert.equal(item.ownerId,owner.id);assert.equal(item.possessorId,thief.id);assert.equal(item.stolen,true);assert.equal(item.provenance,'Issued by landlord');assert.equal(item.eventHistory.at(-1)?.action,'stolen');
});

test('container nesting enforces capacity and rejects cycles before mutation',()=>{
 const room=make('location','Room'),player=make('character','Player',{locationId:room.id}),bag=make('item','Bag',{category:'container',ownerId:player.id,possessorId:player.id,capacity:5,weight:1}),box=make('item','Box',{category:'container',ownerId:player.id,possessorId:player.id,capacity:5,weight:1}),tool=make('item','Tool',{category:'tool',ownerId:player.id,possessorId:player.id,weight:3}),heavy=make('item','Heavy object',{ownerId:player.id,possessorId:player.id,weight:6}),s=state([room,player,bag,box,tool,heavy]);
 act(s,player.id,{type:'store',itemId:box.id,containerId:bag.id});act(s,player.id,{type:'store',itemId:tool.id,containerId:box.id});assert.equal(data(tool,'item').containerId,box.id);assert.throws(()=>act(s,player.id,{type:'store',itemId:bag.id,containerId:box.id}),/containment_cycle/);assert.equal(data(bag,'item').containerId,null);assert.throws(()=>act(s,player.id,{type:'store',itemId:heavy.id,containerId:bag.id}),/container_capacity/);assert.equal(data(heavy,'item').possessorId,player.id);validateState(s);
});

test('search uses target, method, time, risk, knowledge, and concealment without revealing every object',()=>{
 const room=make('location','Room'),player=make('character','Player',{locationId:room.id,playable:true,attributes:{Strength:50,Agility:50,Endurance:50,Intellect:50,Perception:100,Presence:50,Will:50}}),npc=make('character','NPC',{locationId:room.id}),first=make('item','Hidden first',{locationId:room.id,concealed:true,concealment:1}),second=make('item','Hidden second',{locationId:room.id,concealed:true,concealment:1}),s=state([room,player,npc,first,second]);
 act(s,player.id,{type:'search',targetId:room.id,method:'visual',minutes:1,acceptRisk:false});assert.equal([first,second].filter(item=>data(item,'item').discoveredByIds.includes(player.id)).length,1);assert.equal(data(first,'item').concealed,true);assert.equal(data(second,'item').concealed,true);
 assert.throws(()=>act(s,player.id,{type:'search',targetId:npc.id,method:'pat-down',minutes:5,acceptRisk:false}),/search_risk_confirmation_required/);act(s,player.id,{type:'search',targetId:npc.id,method:'pat-down',minutes:5,acceptRisk:true});assert.ok(s.facts.some(fact=>fact.predicate==='risky-search'));
});

test('inventory exposes evidence custody, saved object history persists, and dialogue creates no objects',async()=>{
 const f=await fixture(),game=new Game(f.store);try{
  const timeline=await game.initialize(f.creator,f.campaign.id),room=make('location','Room'),player=make('character','Player',{playable:true,controllerUserId:f.player.id,locationId:room.id},'owner'),phone=make('item','Marked phone',{category:'phone',ownerId:player.id,possessorId:player.id,markings:['cracked-screen'],provenance:'Scene locker',eventHistory:[{at:'2012-06-01T11:00:00.000Z',eventId:null,action:'created',actorId:null,fromId:null,toId:null,locationId:room.id,containerId:null,quantity:1,note:'Authored object'}]},'owner'),evidence=make('evidence','Phone evidence',{objectId:phone.id,locationId:room.id,discoveredBy:[player.id],custodianId:player.id,custody:[{at:'2012-06-01T11:30:00.000Z',fromId:null,toId:player.id,eventId,reason:'Collected'}]});
  await game.bulkEdit(f.creator,timeline.id,{revision:1,entities:[room,player,phone,evidence]},key());const before=(await game.load(timeline.id)).entities.filter(entity=>entity.kind==='item').length,revision=(await game.access(f.player,timeline.id)).t.revision;await game.turn(f.player,timeline.id,{revision,characterId:player.id,action:actionSchema.parse({type:'say',text:'No object should appear.'})},key());const after=await game.load(timeline.id);assert.equal(after.entities.filter(entity=>entity.kind==='item').length,before);
  const inventory=inventoryView(after,player.id);assert.equal(inventory.items[0]!.evidence[0]!.custody[0]!.reason,'Collected');assert.equal(inventory.items[0]!.history[0]!.note,'Authored object');const save=await game.save(f.player,timeline.id,'Object persistence'),branch=await game.branch(f.player,timeline.id,save.id,'Object branch'),restored=await game.load(branch.id);assert.deepEqual(data(restored.entities.find(entity=>entity.id===phone.id)!,'item').markings,['cracked-screen']);validateState(restored);
 }finally{await f.close();}
});
