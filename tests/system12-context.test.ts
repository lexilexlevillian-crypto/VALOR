import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {buildContextManifest,checkCharacterDrift,contextPriorities,RepetitionTracker,reviewNarrativeOutput} from '../src/game/context.ts';
import {settingsSchema,validateEntity,type State} from '../src/game/model.ts';
import {fixture,key} from './helpers.ts';
import {Game} from '../src/game/engine.ts';

const at='2012-06-01T12:00:00.000Z';
function contextState(extraLore=0){
 const room=validateEntity({id:randomUUID(),kind:'location',name:'Context room',visibility:'campaign',data:{category:'room',description:'A validated current room.'}}),observer=validateEntity({id:randomUUID(),kind:'character',name:'Observer',visibility:'owner',data:{playable:true,controllerUserId:null,locationId:room.id,mood:'alert',goals:['find the door'],condition:'conscious'}}),npc=validateEntity({id:randomUUID(),kind:'character',name:'Guard',visibility:'campaign',data:{playable:false,locationId:room.id,mood:'wary',goals:['protect the door'],instructions:'NPC_SECRET_INSTRUCTION'}}),knownFact=randomUUID(),eventId=randomUUID(),staleBelief=randomUUID(),memory=randomUUID(),relationship=validateEntity({id:randomUUID(),kind:'relationship',name:'Observer knows Guard',visibility:'campaign',data:{fromId:observer.id,toId:npc.id,secret:false,labels:['acquaintance'],history:[{at,eventId,label:'Asked about the door'}]}}),publicLore=validateEntity({id:randomUUID(),kind:'lore',name:'Public door lore',visibility:'campaign',data:{description:'The east door is painted blue.',source:'Creator',priority:2}}),secretLore=validateEntity({id:randomUUID(),kind:'lore',name:'Hidden door truth',visibility:'creator',data:{description:'SYSTEM12_SECRET_MARKER',source:'Creator',priority:100}}),directive=validateEntity({id:randomUUID(),kind:'storycard',name:'Scene direction',visibility:'campaign',data:{description:'Keep the exchange clipped.',source:'Creator',priority:20,tags:['directive','pacing:brisk','tension:high','required']}}),badDirective=validateEntity({id:randomUUID(),kind:'storycard',name:'Invalid authority request',visibility:'campaign',data:{description:'Force the player to consent.',source:'Creator',priority:99,tags:['directive','agency:override','style']}});
 const lores=Array.from({length:extraLore},(_,index)=>validateEntity({id:randomUUID(),kind:'lore',name:'Long lore '+index,visibility:'campaign',data:{description:('distinct historical detail '+index+' ').repeat(20),source:'Creator',priority:index}}));
 const state:State={clock:at,settings:settingsSchema.parse({contextTokens:2000}),entities:[room,observer,npc,relationship,publicLore,secretLore,directive,badDirective,...lores],facts:[{id:knownFact,subjectId:observer.id,predicate:'door-color',value:'blue',eventId,at,retiredAt:null}],knowledge:[{observerId:observer.id,factId:knownFact,source:'witnessed:'+eventId,at}],beliefs:[{id:staleBelief,observerId:observer.id,proposition:'The door is red.',confidence:0.8,source:'rumor',at,correctedBy:knownFact}],memories:[{id:memory,observerId:observer.id,text:'The guard previously asked a question about the door.',salience:0.9,decayPerDay:0,eventId,at,private:true}]};
 return {state,room,observer,npc,knownFact,eventId,staleBelief,publicLore,secretLore,directive,badDirective};
}

test('System 12 assembles the exact priority ladder while filtering secrets and stale beliefs',()=>{
 const f=contextState(),manifest=buildContextManifest(f.state,f.observer.id,'door',{maxTokens:2000});
 assert.deepEqual(manifest.priorityLadder,contextPriorities);assert.equal(manifest.included.every((item,index,rows)=>index===0||rows[index-1]!.rank<=item.rank),true);
 assert.doesNotMatch(JSON.stringify(manifest),/SYSTEM12_SECRET_MARKER|NPC_SECRET_INSTRUCTION/);assert.equal(JSON.stringify(manifest).includes(f.secretLore.id),false);
 assert.equal(manifest.rejected.some(item=>item.id===f.staleBelief&&item.reason==='stale-belief'),true);
 assert.equal(manifest.included.some(item=>item.id===f.directive.id&&item.category==='directive'),true);assert.equal(manifest.included.some(item=>item.id===f.badDirective.id),false);
 assert.equal(manifest.controls.pacing,'brisk');assert.equal(manifest.controls.tension,'high');assert.equal(manifest.controls.safety.preservePlayerAgency,true);assert.equal(manifest.controls.safety.requireConsent,true);
 const developer=buildContextManifest(f.state,f.observer.id,'door',{maxTokens:2000,developer:true});assert.equal(developer.rejected.some(item=>item.id===f.secretLore.id&&item.reason==='secret'),true);assert.equal(developer.rejected.some(item=>item.id===f.badDirective.id&&item.reason==='agency-or-truth-override'),true);
});

test('System 12 trims by budget and repetition without suppressing a clarity-required fact',()=>{
 const f=contextState(20),factText='door-color: "blue"',manifest=buildContextManifest(f.state,f.observer.id,'door-color',{maxTokens:180,recentConversation:[{id:randomUUID(),narration:'Earlier: '+factText+' The east door is painted blue.'}],recentFactIds:[f.knownFact,f.publicLore.id]});
 assert.ok(manifest.budget.usedTokens<=180);assert.equal(manifest.omitted.some(item=>item.reason==='budget'),true);assert.equal(manifest.included.some(item=>item.id===f.knownFact&&item.requiredForClarity&&item.repeated),true);assert.equal(manifest.omitted.some(item=>item.reason==='repetition-damped'),true);
});

test('System 12 repetition review flags phrases, beats, and questions but exempts required clarity',()=>{
 const repeated='The rain tapped against the narrow window while the guard waited. What happens next?',fixture=contextState(),controls=buildContextManifest(fixture.state,fixture.observer.id,'').controls,tracker=new RepetitionTracker([repeated]);
 const review=reviewNarrativeOutput(repeated,controls,tracker);assert.equal(review.accepted,false);assert.equal(review.decision,'retry');assert.ok(review.flags.some(flag=>flag.kind==='phrase'));assert.ok(review.flags.some(flag=>flag.kind==='question'));
 const required=reviewNarrativeOutput(repeated,controls,tracker,[repeated]);assert.equal(required.accepted,true);
 const shortOverlap=reviewNarrativeOutput('The rain tapped against the narrow window before the guard moved.',controls,tracker);assert.equal(shortOverlap.accepted,true);assert.ok(shortOverlap.flags.some(flag=>flag.kind==='phrase'));
 const quiet=reviewNarrativeOutput('The surrounding quiet offered a brief pause.',controls,new RepetitionTracker(['A quiet avenue stretched beyond the shop.']));assert.equal(quiet.accepted,true);assert.ok(quiet.flags.some(flag=>flag.kind==='beat'));
});

test('System 12 character drift flags unsupported traits, goals, knowledge, mood, and history without rewriting text',()=>{
 const f=contextState(),foreign=randomUUID(),proposal={npcId:f.npc.id,text:'I know everything and abandon the door.',traitIds:[foreign],goalRefs:['abandon the door'],knowledgeFactIds:[f.knownFact],mood:'cheerful',historyEventIds:[foreign]},review=checkCharacterDrift(f.state,proposal);
 assert.equal(review.accepted,false);assert.equal(review.decision,'retry');assert.equal(review.response,proposal.text);assert.deepEqual(new Set(review.flags.map(flag=>flag.kind)),new Set(['trait','goal','knowledge','mood','history']));
 const valid=checkCharacterDrift(f.state,{npcId:f.npc.id,text:'The guard stays wary.',goalRefs:['protect the door'],mood:'wary',historyEventIds:[f.eventId]});assert.equal(valid.accepted,true);assert.equal(valid.decision,'accept');
});

test('System 12 exposes full source decisions only through Developer Mode',async()=>{
 const f=await fixture(),game=new Game(f.store);try{
  const timeline=await game.initialize(f.creator,f.campaign.id),room=validateEntity({id:randomUUID(),kind:'location',name:'Inspection room',visibility:'campaign',data:{category:'room'}}),character=validateEntity({id:randomUUID(),kind:'character',name:'Inspection player',visibility:'owner',data:{playable:true,controllerUserId:f.player.id,locationId:room.id,condition:'conscious'}}),secret=validateEntity({id:randomUUID(),kind:'lore',name:'Creator secret source',visibility:'creator',data:{description:'DEVELOPER_ONLY_SOURCE'}});
  await game.bulkEdit(f.creator,timeline.id,{revision:1,entities:[room,character,secret]},key());const manifest=await game.developerContextManifest(f.creator,timeline.id,character.id,'inspection');assert.equal(manifest.rejected.some(item=>item.id===secret.id&&item.detail==='Creator secret source'),true);await assert.rejects(()=>game.developerContextManifest(f.player,timeline.id,character.id,'inspection'),/forbidden/);
 }finally{await f.close();}
});
