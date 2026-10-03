import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {actionSchema,data,settingsSchema,validateEntity,validateState} from '../src/game/model.ts';
import type {Entity,State} from '../src/game/model.ts';
import {advance} from '../src/game/simulation.ts';
import {caseFileView,evaluateEventWatchers,eventNotifications,journalView} from '../src/game/events.ts';
import {observerView} from '../src/game/epistemics.ts';
import {resolveAction} from '../src/game/actions.ts';

const causeId='30303030-3030-4030-8030-303030303030';
const make=(kind:Entity['kind'],name:string,raw:Record<string,unknown>={},visibility:Entity['visibility']='campaign')=>validateEntity({id:randomUUID(),kind,name,visibility,data:raw});
const state=(entities:Entity[]):State=>({clock:'2012-06-01T12:00:00.000Z',settings:settingsSchema.parse({timezone:'America/New_York',deterministicCatchup:true,npcBudget:2000}),entities,facts:[],knowledge:[],beliefs:[],memories:[],eventIds:[]});

test('an ignored authored event can resolve offscreen at its time trigger',()=>{
 const elsewhere=make('location','Elsewhere'),player=make('character','Player',{playable:true,locationId:elsewhere.id},'owner'),event=make('quest','The unattended handoff',{premise:'A courier will wait only an hour.',status:'active',state:'waiting',characterId:player.id,participants:[],locationIds:[],stakes:'The package changes hands.',knownByIds:[player.id]}),watcher=make('watcher','Courier leaves',{trigger:'time',dueAt:'2012-06-01T12:30:00.000Z',eventId:event.id,effect:'resolve-event',toState:'resolved-without-player',journalText:'The courier completed the handoff without you.',notifyCharacterIds:[player.id],idempotencyKey:'courier-handoff'});
 const s=state([elsewhere,player,event,watcher]),effects:Parameters<typeof advance>[3]=[];advance(s,60,causeId,effects,player.id);assert.equal(data(event,'quest').status,'succeeded');assert.equal(data(event,'quest').state,'resolved-without-player');assert.equal(data(event,'quest').trace[0]?.watcherId,watcher.id);assert.equal(journalView(s,player.id)[0]?.entries[0]?.text,'The courier completed the handoff without you.');assert.deepEqual(eventNotifications(s,player.id)[0]?.target,{kind:'event',id:event.id});validateState(s);
});

test('watcher firing is idempotent across repeated evaluation',()=>{
 const player=make('character','Player',{playable:true},'owner'),event=make('quest','One bell',{status:'active',state:'waiting',knownByIds:[player.id]}),watcher=make('watcher','Bell rings',{trigger:'time',dueAt:'2012-06-01T12:00:00.000Z',eventId:event.id,effect:'notify',journalText:'The bell rang.',notifyCharacterIds:[player.id],once:false,cooldownMinutes:0,idempotencyKey:'one-bell'}),s=state([player,event,watcher]),effects:Parameters<typeof evaluateEventWatchers>[3]=[];
 evaluateEventWatchers(s,Date.parse(s.clock),causeId,effects);evaluateEventWatchers(s,Date.parse(s.clock),causeId,effects);assert.equal(data(watcher,'watcher').trace.filter(row=>row.result==='fired').length,1);assert.equal(data(event,'quest').journal.length,1);assert.equal(effects.length,1);validateState(s);
});

test('a higher-priority branch suppresses conflicting branch watchers permanently',()=>{
 const player=make('character','Player',{playable:true},'owner'),event=make('quest','Forked response',{status:'active',state:'open',knownByIds:[player.id],branches:{quiet:'Quiet exit',loud:'Public confrontation'}}),quiet=make('watcher','Quiet branch',{trigger:'time',dueAt:sameTime(),eventId:event.id,effect:'select-branch',toState:'quietly-resolved',branchId:'quiet',conflictGroup:'resolution',priority:20,idempotencyKey:'quiet'}),loud=make('watcher','Loud branch',{trigger:'time',dueAt:sameTime(),eventId:event.id,effect:'select-branch',toState:'loudly-resolved',branchId:'loud',conflictGroup:'resolution',priority:10,idempotencyKey:'loud'}),s=state([player,event,quiet,loud]),effects:Parameters<typeof evaluateEventWatchers>[3]=[];
 evaluateEventWatchers(s,Date.parse(s.clock),causeId,effects);assert.equal(data(event,'quest').activeBranchId,'quiet');assert.equal(data(quiet,'watcher').fired,true);assert.equal(data(loud,'watcher').suppressed,true);evaluateEventWatchers(s,Date.parse(s.clock)+86400000,randomUUID(),effects);assert.equal(data(loud,'watcher').fired,false);assert.equal(data(event,'quest').trace.length,1);validateState(s);
});

test('hidden solutions and inactive branches never appear in the player projection',()=>{
 const player=make('character','Player',{playable:true},'owner'),hiddenOutcomeId=randomUUID(),event=make('quest','Locked-room mystery',{premise:'A door was locked from within.',status:'active',state:'investigating',characterId:player.id,knownByIds:[player.id],activeBranchId:'physical',hiddenSolution:'The window latch was replaced.',objectiveRecords:[{id:randomUUID(),title:'Check the window',hidden:true,branchId:'physical',knownByIds:[]},{id:randomUUID(),title:'Interview the neighbor',branchId:'witness'}],possibleOutcomes:[{id:hiddenOutcomeId,label:'Use the replacement latch',hidden:true,branchId:'physical',knownByIds:[]},{id:randomUUID(),label:'Follow the witness',branchId:'witness'}]},'knowledge'),s=state([player,event]);
 let projected=observerView(s,player.id).entities.find(row=>row.id===event.id)!;assert.equal('hiddenSolution' in projected.data,false);assert.deepEqual(projected.data.possibleOutcomes,[]);assert.deepEqual(projected.data.objectiveRecords,[]);const record=data(event,'quest');record.possibleOutcomes[0]!.knownByIds.push(player.id);event.data=record as Entity['data'];projected=observerView(s,player.id).entities.find(row=>row.id===event.id)!;assert.equal((projected.data.possibleOutcomes as unknown[]).length,1);assert.equal(JSON.stringify(projected.data).includes('replacement latch'),true);validateState(s);
});

test('an unconventional authored action may transform an event without completing chores',()=>{
 const player=make('character','Player',{playable:true},'owner'),outcomeId=randomUUID(),event=make('quest','Eviction notice',{status:'active',state:'threatened',characterId:player.id,knownByIds:[player.id],possibleOutcomes:[{id:outcomeId,label:'Organize the tenants',description:'The private dispute becomes a tenant campaign.',toStatus:'active',toState:'transformed',resolution:'transformed',validActionTags:['collective-action'] }]}),s=state([player,event]);
 const resolved=resolveAction(s,player.id,actionSchema.parse({type:'event-action',eventId:event.id,actionTags:['collective-action'],reason:'The player organized an unanticipated coalition.'}),causeId,'30'.repeat(32));assert.equal(resolved.effects[0]?.subjectId,event.id);assert.equal(data(event,'quest').status,'active');assert.equal(data(event,'quest').state,'transformed');assert.equal(data(event,'quest').trace[0]?.outcomeId,outcomeId);validateState(s);
});

test('case files separate proven, discovered, suspected, and rumored records',()=>{
 const investigator=make('character','Investigator',{playable:true},'owner'),agency=make('faction','Agency',{}),subject=make('character','Subject',{}),evidence=make('evidence','Camera record',{discoveredBy:[investigator.id],knownByIds:[investigator.id]}),factId=randomUUID(),caseEntity=make('case','Warehouse case',{agencyId:agency.id,investigatorId:investigator.id,factIds:[factId],evidenceIds:[evidence.id],leadRecords:[{id:randomUUID(),at:sameTime(),kind:'lead',summary:'Camera record places a van nearby.',reliability:70,sourceEvidenceId:evidence.id}],hypotheses:[{id:randomUUID(),proposition:'The subject borrowed the van.',subjectId:subject.id,status:'active',confidence:40,sourceEvidenceIds:[evidence.id],createdById:investigator.id,createdAt:sameTime(),updatedAt:sameTime()}]}),s=state([investigator,agency,subject,evidence,caseEntity]);s.facts.push({id:factId,subjectId:subject.id,predicate:'present-nearby',value:true,eventId:causeId,at:s.clock,retiredAt:null,evidenceIds:[evidence.id],confidence:1,truthStatus:'verified'});s.knowledge.push({observerId:investigator.id,factId,source:'camera',at:s.clock});s.beliefs.push({id:randomUUID(),observerId:investigator.id,proposition:'A second van was involved.',subjectId:subject.id,predicate:'rumor',confidence:.3,source:'rumor:tip',at:s.clock,correctedBy:null});
 const view=caseFileView(s,caseEntity.id,investigator.id);assert.equal(view.proven.length,1);assert.equal(view.discovered.length,1);assert.equal(view.suspected.length,1);assert.equal(view.rumored.length,1);validateState(s);
});

function sameTime(){return '2012-06-01T12:00:00.000Z';}
