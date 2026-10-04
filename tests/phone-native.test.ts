import {test} from 'node:test';
import assert from 'node:assert/strict';
// @ts-ignore Browser module exports pure presentation helpers.
import {availableContacts,messageThreads,nativePhonePages} from '../public/phone-apps.js';
import {PLAYER_NEIGHBORHOODS,residencePlan} from '../public/profile-rules.js';
import {assignResidence} from '../src/game/profile-creation.ts';
import {settingsSchema,validateEntity,data} from '../src/game/model.ts';
import type {State} from '../src/game/model.ts';
import {key} from './helpers.ts';

test('message threads group incoming and outgoing messages, without mixing unrelated unknown numbers',()=>{
 const messages=[{id:'1',medium:'sms',fromId:'me',toId:'friend',toNumber:'555',at:'2012-01-01T10:00Z',body:'Hi'},{id:'2',medium:'sms',fromId:'friend',toId:'me',fromNumber:'555',at:'2012-01-01T11:00Z',body:'Hello'},{id:'3',medium:'sms',fromId:null,toId:'me',fromNumber:'777',at:'2012-01-01T12:00Z',body:'Other'},{id:'4',medium:'call',fromId:'friend',toId:'me',at:'2012-01-01T13:00Z'}];
 const threads=messageThreads(messages,'me',[{characterId:'friend',savedName:'Sam'}]);
 assert.equal(threads.length,2);assert.equal(threads[1].name,'Sam');assert.equal(threads[1].messages.length,2);assert.equal(threads[0].number,'777');
});
test('add-contact choices require learned number facts and exclude existing/self contacts',()=>{
 const view={entities:[{id:'friend',kind:'character',name:'Sam'},{id:'hidden',kind:'character',name:'Unknown number'}],facts:[{id:'fact',subjectId:'friend',predicate:'phone-number-shared',value:{number:'555'}},{id:'duplicate',subjectId:'friend',predicate:'phone-number',value:'555'},{id:'x',subjectId:'hidden',predicate:'favorite-color',value:'secret'}]};
 assert.deepEqual(availableContacts(view,{contacts:[]},'me'),[{id:'friend',name:'Sam',number:'555',factId:'fact'}]);
 assert.deepEqual(availableContacts(view,{contacts:[{characterId:'friend'}]},'me'),[]);
 for(const page of ['Weather','News','Contacts','Messages','Phone','Character','Health','Inventory','Journal / Cases','Jobs / Money','Map','Save / Load','Settings'])assert.ok(nativePhonePages.has(page));
});
test('player residence choices contain only the eight documented Union buildings; NPC geography stays broad',()=>{
 assert.deepEqual([...PLAYER_NEIGHBORHOODS].sort(),['Chinatown','Court District','First Harbor','Langley','Low End','North Crowns','South Crowns','Sparrow Ward'].sort());
 for(const neighborhood of PLAYER_NEIGHBORHOODS)assert.ok(residencePlan(neighborhood));
 assert.equal(residencePlan('North Crowns')!.name,'The Sync');
 const s:State={clock:'2012-01-01T00:00:00Z',settings:settingsSchema.parse({}),entities:[],facts:[],knowledge:[],beliefs:[],memories:[]};
 const pc=validateEntity({id:key(),kind:'character',name:'New player',visibility:'campaign',data:{playable:true,originNeighborhood:'Summit Park'}});
 s.entities.push(pc);assert.throws(()=>assignResidence(s,pc),/player_union_residence_required/);
 const previous=data(pc,'character');assert.doesNotThrow(()=>assignResidence(s,pc,previous),'unchanged legacy saves remain readable/editable');
 pc.data.originNeighborhood='North Crowns';pc.data.residence={neighborhood:'North Crowns',name:'',building:1,floor:0,apartment:''};
 assignResidence(s,pc);assert.equal(data(pc,'character').residence!.name,'The Sync');
 const npc=validateEntity({id:key(),kind:'character',name:'NPC',visibility:'creator',data:{originNeighborhood:'Summit Park'}});
 assert.doesNotThrow(()=>assignResidence(s,npc));
});
