import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {fixture,key} from './helpers.ts';
import {Game} from '../src/game/engine.ts';
import {resolveAction} from '../src/game/actions.ts';
import {actionSchema,data,settingsSchema,validateEntity,validateState} from '../src/game/model.ts';
import type {Entity,State} from '../src/game/model.ts';
import {advance} from '../src/game/simulation.ts';
import {observerView} from '../src/game/epistemics.ts';
import {phoneView} from '../src/game/phone.ts';

const eventId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',seed='1'.repeat(64);
const make=(kind:Entity['kind'],name:string,raw:Record<string,unknown>={},visibility:Entity['visibility']='campaign')=>validateEntity({id:randomUUID(),kind,name,visibility,data:raw});
const state=(entities:Entity[]):State=>({clock:'2012-06-01T12:00:00.000Z',settings:settingsSchema.parse({}),entities,facts:[],knowledge:[],beliefs:[],memories:[],eventIds:[]});
const act=(s:State,actorId:string,raw:unknown)=>resolveAction(s,actorId,actionSchema.parse(raw),eventId,seed);

test('numbers require explicit sharing or known source evidence and contacts retain distinct provenance and controls',()=>{
 const room=make('location','Room'),player=make('character','Player',{playable:true,locationId:room.id}),npc=make('character','NPC',{locationId:room.id}),unknown=make('character','Unknown',{locationId:room.id});
 const playerPhone=make('item','Player phone',{category:'phone',ownerId:player.id,phoneNumber:'555-0100'},'owner'),npcPhone=make('item','NPC phone',{category:'phone',ownerId:npc.id,phoneNumber:'555-0199'},'owner'),s=state([room,player,npc,unknown,playerPhone,npcPhone]);
 assert.throws(()=>act(s,player.id,{type:'add-contact',phoneId:playerPhone.id,contactId:unknown.id,label:'Unknown'}),/phone_number_unknown/);
 act(s,npc.id,{type:'share-number',phoneId:npcPhone.id,toId:player.id});const shared=s.facts.find(fact=>fact.subjectId===npc.id&&fact.predicate==='phone-number-shared')!;
 act(s,player.id,{type:'add-contact',phoneId:playerPhone.id,contactId:npc.id,label:'Saved display',alias:'Work alias',factId:shared.id});
 let contact=data(playerPhone,'item').contacts[0]!;assert.deepEqual({savedName:contact.savedName,number:contact.number,alias:contact.alias,source:contact.source,privacy:contact.consentPrivacy},{savedName:'Saved display',number:'555-0199',alias:'Work alias',source:'exchange',privacy:'shared'});
 act(s,player.id,{type:'contact-control',phoneId:playerPhone.id,contactId:npc.id,operation:'favorite'});act(s,player.id,{type:'contact-control',phoneId:playerPhone.id,contactId:npc.id,operation:'block'});contact=data(playerPhone,'item').contacts[0]!;assert.equal(contact.favorite,true);assert.equal(contact.blocked,true);validateState(s);
});

test('lost, dead, locked, and stolen phones change access to private records',()=>{
 const owner=make('character','Owner'),thief=make('character','Thief'),outsider=make('character','Outsider'),phone=make('item','Private phone',{category:'phone',ownerId:owner.id,phoneNumber:'555-0111'},'owner'),message=make('message','Private SMS',{fromId:owner.id,toId:outsider.id,phoneId:phone.id,body:'PRIVATE_PHONE_RECORD',at:'2012-06-01T11:00:00.000Z',sentAt:'2012-06-01T11:00:00.000Z',status:'sent'},'owner'),s=state([owner,thief,outsider,phone,message]);
 let p=data(phone,'item');p.phoneState='lost';phone.data=p;assert.equal(phoneView(s,owner.id).phones.length,0);
 p=data(phone,'item');p.phoneState='active';p.ownerId=thief.id;p.stolen=true;p.locked=true;phone.data=p;assert.equal(phoneView(s,thief.id).phones.length,0);assert.equal(JSON.stringify(observerView(s,thief.id)).includes('PRIVATE_PHONE_RECORD'),false);
 p=data(phone,'item');p.locked=false;phone.data=p;assert.equal(phoneView(s,thief.id).messages[0]!.body,'PRIVATE_PHONE_RECORD');assert.equal(JSON.stringify(observerView(s,outsider.id)).includes('PRIVATE_PHONE_RECORD'),false);
 p=data(phone,'item');p.phoneState='dead';phone.data=p;assert.equal(phoneView(s,thief.id).phones.length,0);
});

test('SMS delivery is delayed, landlines reject texts, and receipt knowledge appears only after supported delivery',()=>{
 const sender=make('character','Sender'),recipient=make('character','Recipient'),landlineOwner=make('character','Landline owner'),senderPhone=make('item','Sender phone',{category:'phone',ownerId:sender.id,phoneNumber:'555-0101',contacts:[{characterId:recipient.id,label:'Recipient',number:'555-0102'},{characterId:landlineOwner.id,label:'Landline',number:'555-0103'}]},'owner'),recipientPhone=make('item','Recipient phone',{category:'phone',ownerId:recipient.id,phoneNumber:'555-0102',service:'poor'},'owner'),landline=make('item','Landline',{category:'phone',ownerId:landlineOwner.id,phoneNumber:'555-0103',phoneType:'landline',batteryRequired:false},'owner'),s=state([sender,recipient,landlineOwner,senderPhone,recipientPhone,landline]);
 act(s,sender.id,{type:'message',phoneId:senderPhone.id,toId:recipient.id,text:'Delayed text',medium:'sms'});let message=s.entities.find(entity=>entity.kind==='message')!;assert.equal(message.data.status,'sent');assert.equal(phoneView(s,recipient.id).messages.length,0);assert.equal(s.beliefs.length,0);
 advance(s,1,eventId,[],sender.id);assert.equal(message.data.status,'sent');advance(s,4,eventId,[],sender.id);message=s.entities.find(entity=>entity.kind==='message')!;assert.equal(message.data.status,'delivered');assert.ok(message.data.deliveredAt);assert.equal(phoneView(s,recipient.id).messages[0]!.body,'Delayed text');assert.ok(s.beliefs.some(belief=>belief.observerId===recipient.id&&belief.proposition==='Delayed text'));
 act(s,recipient.id,{type:'delete-message',phoneId:recipientPhone.id,messageId:message.id,operation:'delete'});assert.equal(phoneView(s,recipient.id).messages.length,0);assert.ok(data(message,'message').deletedByIds.includes(recipient.id));
 act(s,sender.id,{type:'message',phoneId:senderPhone.id,toId:landlineOwner.id,text:'Cannot land here',medium:'sms'});const failed=s.entities.filter(entity=>entity.kind==='message').at(-1)!;assert.equal(failed.data.status,'failed');assert.equal(failed.data.failureReason,'landline_cannot_receive_sms');
 act(s,sender.id,{type:'message',phoneId:senderPhone.id,toId:null,number:'555-9999',text:'Wrong number',medium:'sms'});const wrong=s.entities.filter(entity=>entity.kind==='message').at(-1)!;assert.equal(wrong.data.status,'failed');assert.equal(wrong.data.failureReason,'wrong-number');
});

test('missed calls can leave delayed voicemail without inventing an answer',()=>{
 const caller=make('character','Caller'),recipient=make('character','Recipient'),callerPhone=make('item','Caller phone',{category:'phone',ownerId:caller.id,phoneNumber:'555-0400',contacts:[{characterId:recipient.id,label:'Recipient',number:'555-0401'}]},'owner'),recipientPhone=make('item','Recipient phone',{category:'phone',ownerId:recipient.id,phoneNumber:'555-0401'},'owner'),s=state([caller,recipient,callerPhone,recipientPhone]);
 act(s,caller.id,{type:'phone-call',phoneId:callerPhone.id,toId:recipient.id});const call=s.entities.find(entity=>entity.kind==='message')!;assert.equal(call.data.callState,'ringing');assert.equal(call.data.body,'');advance(s,1,eventId,[],caller.id);assert.equal(call.data.callState,'missed');
 act(s,caller.id,{type:'leave-voicemail',phoneId:callerPhone.id,callId:call.id,text:'Please call me back.'});const voicemail=s.entities.filter(entity=>entity.kind==='message').at(-1)!;assert.equal(voicemail.data.status,'sent');assert.equal(phoneView(s,recipient.id).messages.filter(message=>message.medium==='voicemail').length,0);advance(s,1,eventId,[],caller.id);assert.equal(voicemail.data.status,'delivered');assert.equal(phoneView(s,recipient.id).messages.at(-1)!.body,'Please call me back.');
});

test('authored NPC messages remain delayed and only execute through supported plans and phone access',()=>{
 const room=make('location','Room'),player=make('character','Player',{playable:true,locationId:room.id}),npc=make('character','NPC',{locationId:room.id,plans:[]}),npcPhone=make('item','NPC phone',{category:'phone',ownerId:npc.id,phoneNumber:'555-0200',contacts:[{characterId:player.id,label:'Player',number:'555-0201'}]},'owner'),playerPhone=make('item','Player phone',{category:'phone',ownerId:player.id,phoneNumber:'555-0201'},'owner'),s=state([room,player,npc,npcPhone,playerPhone]);
 const d=data(npc,'character');d.plans=[{id:randomUUID(),type:'message',targetId:player.id,auxiliaryId:null,priority:10,cooldownMinutes:15,lastRun:null,enabled:true,text:'Authored reply',conditions:[],constraints:[],expiresAt:null,fallback:'skip',maxRunsPerDay:1,runDate:null,runsToday:0,failedAttempts:0,lastOutcome:null}];npc.data=d;
 advance(s,15,eventId,[],player.id);const message=s.entities.find(entity=>entity.kind==='message')!;assert.equal(message.data.status,'sent');assert.equal(phoneView(s,player.id).messages.length,0);advance(s,1,eventId,[],player.id);assert.equal(message.data.status,'delivered');assert.equal(phoneView(s,player.id).messages[0]!.body,'Authored reply');
});

test('social feed obeys authored friend/follow privacy and rejects unvalidated simulation output',()=>{
 const player=make('character','Player',{socialConnections:{friendIds:[],followingIds:[],followerIds:[]}}),friend=make('character','Friend',{socialConnections:{friendIds:[player.id],followingIds:[],followerIds:[]}}),phone=make('item','Player phone',{category:'phone',ownerId:player.id},'owner');
 const friendPost=make('socialPost','Friends post',{authorId:friend.id,platform:'FaceSpace',body:'FRIEND_ONLY',at:'2012-06-01T10:00:00.000Z',source:'creator',validated:true,privacy:'friends'}),hidden=make('socialPost','Unvalidated',{authorId:friend.id,platform:'FaceSpace',body:'UNVALIDATED_SIMULATION',at:'2012-06-01T11:00:00.000Z',source:'simulation',validated:false,privacy:'public'}),validated=make('socialPost','Validated',{authorId:friend.id,platform:'FaceSpace',body:'VALIDATED_SIMULATION',at:'2012-06-01T11:30:00.000Z',source:'simulation',validated:true,privacy:'public'}),s=state([player,friend,phone,friendPost,hidden,validated]);
 const feed=phoneView(s,player.id).socialFeed.map(post=>post.body);assert.ok(feed.includes('FRIEND_ONLY'));assert.ok(feed.includes('VALIDATED_SIMULATION'));assert.equal(feed.includes('UNVALIDATED_SIMULATION'),false);
});

test('thread timestamps, device links, deletion state, and event provenance persist through a save branch',async()=>{
 const f=await fixture(),game=new Game(f.store);
 try{
  const timeline=await game.initialize(f.creator,f.campaign.id),room=make('location','Room'),player=make('character','Player',{playable:true,controllerUserId:f.player.id,locationId:room.id},'owner'),npc=make('character','NPC',{locationId:room.id}),playerPhone=make('item','Player phone',{category:'phone',ownerId:player.id,phoneNumber:'555-0300',contacts:[{characterId:npc.id,label:'NPC',number:'555-0301',source:'exchange',consentPrivacy:'shared'}]},'owner'),npcPhone=make('item','NPC phone',{category:'phone',ownerId:npc.id,phoneNumber:'555-0301'},'owner');
  await game.bulkEdit(f.creator,timeline.id,{revision:1,entities:[room,player,npc,playerPhone,npcPhone]},key());const revision=(await game.access(f.player,timeline.id)).t.revision;
  await game.turn(f.player,timeline.id,{revision,characterId:player.id,action:actionSchema.parse({type:'message',phoneId:playerPhone.id,toId:npc.id,text:'Persistent SMS',medium:'sms'})},key());
  const save=await game.save(f.player,timeline.id,'Phone record'),branch=await game.branch(f.player,timeline.id,save.id,'Phone branch'),restored=await game.load(branch.id),message=restored.entities.find(entity=>entity.kind==='message')!;
  assert.ok(message.data.threadId);assert.equal(message.data.phoneId,playerPhone.id);assert.equal(message.data.recipientPhoneId,npcPhone.id);assert.ok(message.data.sentAt);assert.ok(message.data.availableAt);assert.ok(message.data.sourceEventId);assert.deepEqual(message.data.deletedByIds,[]);validateState(restored);
 }finally{await f.close();}
});
