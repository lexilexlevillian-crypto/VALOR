import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {resolveAction} from '../src/game/actions.ts';
import {compatibilityAssessment} from '../src/game/compatibility.ts';
import {data,relationshipMetrics,settingsSchema,validateEntity,validateState} from '../src/game/model.ts';
import type {Entity,State} from '../src/game/model.ts';
import {advance} from '../src/game/simulation.ts';
import {effectiveContentMode,intimacyPresentation,openConsentRequest,respondToConsentRequest,romanceEligibility} from '../src/game/romance.ts';

const eventId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',seed='0'.repeat(64);
const make=(kind:Entity['kind'],name:string,raw:Record<string,unknown>={}):Entity=>validateEntity({id:randomUUID(),kind,name,visibility:'campaign',data:raw});
const state=(entities:Entity[],raw:Record<string,unknown>={}):State=>({clock:'2012-06-01T12:00:00.000Z',settings:settingsSchema.parse({romance:true,intimacy:'fade-to-black',...raw}),entities,facts:[],knowledge:[],beliefs:[],memories:[],eventIds:[]});

test('consent is explicit, current, contextual, voluntary, sober, and never inferred from attraction or relationship history',()=>{
 const room=make('location','Room'),elsewhere=make('location','Elsewhere'),player=make('character','Player',{playable:true,locationId:room.id,dob:'1990-01-01'}),npc=make('character','NPC',{locationId:room.id,dob:'1988-01-01'}),relation=make('relationship','NPC → Player',{fromId:npc.id,toId:player.id,attraction:100,labels:['lover'],secret:false,disclosure:'private',knownByIds:[npc.id,player.id]});
 const s=state([room,elsewhere,player,npc,relation]);
 assert.throws(()=>resolveAction(s,player.id,{type:'social',targetId:npc.id,intent:'date',consent:true},eventId,seed),/current_consent_request_required/);
 const request=openConsentRequest(s,relation,'date',npc.id,player.id);let playerData=data(player,'character');playerData.locationId=elsewhere.id;player.data=playerData;
 assert.throws(()=>respondToConsentRequest(s,relation,request.id,player.id,'date',eventId,'accept',true),/consent_context_changed/);
 playerData=data(player,'character');playerData.locationId=room.id;playerData.intoxication=50;player.data=playerData;
 assert.throws(()=>respondToConsentRequest(s,relation,request.id,player.id,'date',eventId,'accept',true),/consent_invalid_while_intoxicated/);
 playerData=data(player,'character');playerData.intoxication=0;playerData.restrainedBy=npc.id;player.data=playerData;assert.throws(()=>respondToConsentRequest(s,relation,request.id,player.id,'date',eventId,'accept',true),/consent_not_voluntary/);
 playerData=data(player,'character');playerData.restrainedBy=null;player.data=playerData;assert.throws(()=>respondToConsentRequest(s,relation,request.id,player.id,'date',eventId,'accept',false),/explicit_consent_required/);const accepted=respondToConsentRequest(s,relation,request.id,player.id,'date',eventId,'accept',true);assert.equal(accepted.status,'accepted');
 assert.deepEqual(relationshipMetrics.map(metric=>data(relation,'relationship')[metric]),[100,0,0,0,0,0,0,0,0,0,0,0],'acceptance does not synthesize either participant’s feelings');
 const expiring=openConsentRequest(s,relation,'flirt',npc.id,player.id);s.clock='2012-06-01T12:31:00.000Z';assert.throws(()=>respondToConsentRequest(s,relation,expiring.id,player.id,'flirt',eventId,'accept',true),/current_consent_request_required/);assert.equal(data(relation,'relationship').consentRequests.find(row=>row.id===expiring.id)!.status,'expired');
});

test('age rules and setting changes exclude prohibited content instead of narrating around it',()=>{
 const room=make('location','Room'),adult=make('character','Adult',{locationId:room.id,dob:'1980-01-01'}),unknownAge=make('character','Unknown age',{locationId:room.id}),relation=make('relationship','Adult → Unknown',{fromId:adult.id,toId:unknownAge.id});const s=state([room,adult,unknownAge,relation]);
 assert.deepEqual(romanceEligibility(s,adult.id,unknownAge.id,'date'),{allowed:false,reason:'age_or_legal_eligibility_required'});
 const unknownData=data(unknownAge,'character');unknownData.dob='1985-01-01';unknownAge.data=unknownData;const request=openConsentRequest(s,relation,'intimacy',adult.id,unknownAge.id);assert.equal(request.contentMode,'fade-to-black');
 s.settings.intimacy='off';assert.equal(effectiveContentMode(s,unknownAge.id),'off');assert.throws(()=>respondToConsentRequest(s,relation,request.id,unknownAge.id,'intimacy',eventId,'accept',true),/intimacy_disabled/);
 assert.equal(intimacyPresentation('implicit'),'Private intimacy is acknowledged without description.');assert.match(intimacyPresentation('fade-to-black'),/fades to black/);assert.doesNotMatch(intimacyPresentation('allowed-description'),/sex|body|touch/i);
});

test('content filters and safety exits are immediate, zero-cost, and carry no relationship or narrative penalty',()=>{
 const room=make('location','Room'),player=make('character','Player',{playable:true,locationId:room.id,dob:'1990-01-01'}),npc=make('character','NPC',{locationId:room.id,dob:'1990-01-01'}),relation=make('relationship','NPC → Player',{fromId:npc.id,toId:player.id,trust:40});const s=state([room,player,npc,relation]),request=openConsentRequest(s,relation,'date',npc.id,player.id),before=structuredClone(data(relation,'relationship')),clock=s.clock,mood=data(player,'character').mood;
 const playerData=data(player,'character');playerData.condition='unconscious';player.data=playerData;const result=resolveAction(s,player.id,{type:'safety-exit',targetId:npc.id},eventId,seed);assert.equal(result.effects[0]!.type,'safety.exit');assert.equal(s.clock,clock);assert.equal(data(player,'character').mood,mood);assert.equal(data(relation,'relationship').trust,before.trust);assert.equal(data(relation,'relationship').history.length,before.history.length);assert.equal(data(relation,'relationship').consentRequests.find(row=>row.id===request.id)!.status,'withdrawn');
 resolveAction(s,player.id,{type:'content-filter',romance:'off',matureContent:'off',blockedIntents:['flirt','intimacy'],allowNpcInitiative:false},eventId,seed);assert.deepEqual(data(player,'character').contentFilters,{romance:'off',matureContent:'off',blockedIntents:['flirt','intimacy'],allowNpcInitiative:false});assert.equal(s.clock,clock);
});

test('NPC initiative presents one advance and waits without taking control of the player',()=>{
 const room=make('location','Room'),player=make('character','Player',{playable:true,locationId:room.id,dob:'1990-01-01'}),npc=make('character','NPC',{locationId:room.id,dob:'1980-01-01'}),relation=make('relationship','NPC → Player',{fromId:npc.id,toId:player.id,tags:['flirt']});
 npc.data=validateEntity({...npc,data:{...npc.data,plans:[{id:randomUUID(),type:'offer',targetId:relation.id,priority:10,cooldownMinutes:15,maxRunsPerDay:4}]}}).data;const s=state([room,player,npc,relation]),effects=[] as Parameters<typeof advance>[3];
 advance(s,15,eventId,effects,player.id);assert.equal(data(relation,'relationship').consentRequests.length,1);assert.equal(data(relation,'relationship').consentRequests[0]!.status,'pending');assert.equal(data(relation,'relationship').labels.length,0);assert.match(effects[0]!.text,/recipient chooses/);
 const count=effects.length;advance(s,15,eventId,effects,player.id);assert.equal(data(relation,'relationship').consentRequests.length,1);assert.equal(effects.length,count,'a pending advance is not repeated as pressure');
});

test('NPC-only romance requires separately authored initiative and response plans',()=>{
 const room=make('location','Room'),player=make('character','Remote player',{playable:true,locationId:room.id,dob:'1990-01-01'}),a=make('character','A',{locationId:room.id,dob:'1980-01-01'}),b=make('character','B',{locationId:room.id,dob:'1981-01-01'}),relation=make('relationship','A → B',{fromId:a.id,toId:b.id,tags:['date']});
 a.data=validateEntity({...a,data:{...a.data,plans:[{id:randomUUID(),type:'offer',targetId:relation.id,priority:10,cooldownMinutes:15,maxRunsPerDay:1}]}}).data;b.data=validateEntity({...b,data:{...b.data,plans:[{id:randomUUID(),type:'offer',targetId:relation.id,priority:10,cooldownMinutes:15,maxRunsPerDay:1}]}}).data;
 const s=state([room,player,a,b,relation]);advance(s,15,eventId,[],player.id);assert.equal(data(relation,'relationship').consentRequests[0]!.status,'accepted');assert.ok(data(relation,'relationship').labels.includes('date'));assert.equal(s.entities.filter(entity=>entity.kind==='relationship').length,1);validateState(s);
});

test('compatibility considers authored identity, appearance, personality, behavior, familiarity, reputation, history, and circumstance without writing attraction',()=>{
 const room=make('location','Room'),from=make('character','From',{locationId:room.id,preferences:{'identity.orientation':'queer','appearance.eyes':'green','personality.mbti':'INTJ','behavior.kind':'prefer'}}),to=make('character','To',{locationId:room.id,identity:{orientation:'queer'},eyes:'green',personalityProfile:{mbti:'INTJ'},goals:['kind']}),relation=make('relationship','From → To',{fromId:from.id,toId:to.id,familiarity:60,history:[{at:'2012-05-01T00:00:00.000Z',eventId,label:'Kept promise',kind:'meaningful',reason:'Kept promise',changes:{trust:5}}]}),reputation=make('reputation','Public standing',{subjectId:to.id,audience:{type:'public',entityId:null,label:'Public'},score:40,baseScore:40});
 const s=state([room,from,to,relation,reputation]),before=data(relation,'relationship').attraction,result=compatibilityAssessment(s,from.id,to.id),sources=new Set(result.factors.map(factor=>factor.source));assert.equal(result.eligible,true);for(const source of ['identity','appearance','personality','behavior','familiarity','reputation','history','circumstance'])assert.ok(sources.has(source as never),source);assert.equal(data(relation,'relationship').attraction,before);
});
