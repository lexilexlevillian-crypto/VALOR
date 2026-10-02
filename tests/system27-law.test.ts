import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {actionSchema,data,settingsSchema,validateEntity,validateState} from '../src/game/model.ts';
import type {Entity,State} from '../src/game/model.ts';
import {resolveAction} from '../src/game/actions.ts';
import {fact,observerView} from '../src/game/epistemics.ts';
import {fileCrimeReport,recordCrime,resolveLawPosture} from '../src/game/law.ts';

const seed='27'.repeat(32),eventId='27272727-2727-4272-8272-272727272727';
const make=(kind:Entity['kind'],name:string,raw:Record<string,unknown>={},visibility:Entity['visibility']='campaign')=>validateEntity({id:randomUUID(),kind,name,visibility,data:raw});
const state=(entities:Entity[]):State=>({clock:'2012-06-01T12:00:00.000Z',settings:settingsSchema.parse({timezone:'America/New_York'}),entities,facts:[],knowledge:[],beliefs:[],memories:[],eventIds:[]});
const act=(s:State,actorId:string,raw:unknown)=>resolveAction(s,actorId,actionSchema.parse(raw),eventId,seed);

test('an unreported crime remains unknown to police and creates no case or dispatch',()=>{
 const room=make('location','Back room'),station=make('location','Precinct'),offender=make('character','Offender',{playable:true,locationId:room.id},'owner'),officer=make('character','Officer',{locationId:station.id}),agency=make('faction','Police',{memberIds:[officer.id],jurisdictionIds:[room.id],dispatchPolicy:{kind:'police',responseMinutes:10}}),law=make('law','Property law',{jurisdictionIds:[room.id],agencyIds:[agency.id],permits:['stop','search','arrest','charge','sentence']}),s=state([room,station,offender,officer,agency,law]);
 const recorded=recordCrime(s,{offenderIds:[offender.id],lawId:law.id,locationId:room.id,eventId,severity:40});
 assert.equal(recorded.filed.length,0);assert.equal(s.entities.filter(e=>e.kind==='case').length,0);assert.equal(s.entities.filter(e=>e.kind==='dispatch').length,0);assert.equal(s.knowledge.some(k=>k.observerId===officer.id&&k.factId===recorded.factId),false);
 assert.equal(observerView(s,officer.id).entities.some(e=>e.id===recorded.crime.id),false);validateState(s);
});

test('district posture changes report response timing and officer capacity without changing legal authority',()=>{
 const city=make('location','Valor',{category:'city'}),lax=make('location','Lax district',{category:'district',parentId:city.id}),strict=make('location','Civic district',{category:'district',parentId:city.id}),reporterA=make('character','Witness A',{locationId:lax.id}),reporterB=make('character','Witness B',{locationId:strict.id}),officerA=make('character','Officer A',{locationId:city.id}),officerB=make('character','Officer B',{locationId:city.id}),agency=make('faction','Metro police',{memberIds:[officerA.id,officerB.id],jurisdictionIds:[lax.id,strict.id],dispatchPolicy:{kind:'police',responseMinutes:10}}),laxPolicy=make('lawPosture','Lax response',{scope:'district',locationId:lax.id,reportProbability:10,dispatchMinMinutes:90,dispatchMaxMinutes:90,officerAvailability:100}),strictPolicy=make('lawPosture','Civic response',{scope:'district',locationId:strict.id,reportProbability:90,dispatchMinMinutes:5,dispatchMaxMinutes:5,officerAvailability:100}),crimeA=make('crime','Incident A',{locationId:lax.id,offenderIds:[reporterB.id],witnessIds:[reporterA.id],occurredAt:'2012-06-01T12:00:00.000Z',sourceEventId:eventId}),crimeB=make('crime','Incident B',{locationId:strict.id,offenderIds:[reporterA.id],witnessIds:[reporterB.id],occurredAt:'2012-06-01T12:00:00.000Z',sourceEventId:eventId}),s=state([city,lax,strict,reporterA,reporterB,officerA,officerB,agency,laxPolicy,strictPolicy,crimeA,crimeB]);
 const factA=fact(s,reporterB.id,'alleged-act',{crimeId:crimeA.id},eventId,[reporterA.id]),factB=fact(s,reporterA.id,'alleged-act',{crimeId:crimeB.id},eventId,[reporterB.id]),a=fileCrimeReport(s,{factId:factA,reporterId:reporterA.id,agencyId:agency.id,investigatorId:officerA.id,crimeId:crimeA.id,directWitness:true}),b=fileCrimeReport(s,{factId:factB,reporterId:reporterB.id,agencyId:agency.id,investigatorId:officerB.id,crimeId:crimeB.id,directWitness:true});
 assert.equal(resolveLawPosture(s,lax.id,agency.id).reportProbability,10);assert.equal(resolveLawPosture(s,strict.id,agency.id).reportProbability,90);
 assert.equal(Date.parse(String(a.dispatch!.data.dueAt))-Date.parse(s.clock),90*60000);assert.equal(Date.parse(String(b.dispatch!.data.dueAt))-Date.parse(s.clock),5*60000);
 assert.deepEqual(data(a.file,'case').lawIds,[]);assert.deepEqual(data(b.file,'case').lawIds,[]);validateState(s);
});

test('legal process separates authority from posture and advances booking, bail, charge, court, sentence, and probation',()=>{
 const room=make('location','Interview room'),suspect=make('character','Suspect',{playable:true,locationId:room.id,cash:1000},'owner'),witness=make('character','Witness',{locationId:room.id}),officer=make('character','Detective',{locationId:room.id}),agency=make('faction','Police',{memberIds:[officer.id],jurisdictionIds:[room.id],dispatchPolicy:{kind:'police',responseMinutes:10}}),posture=make('lawPosture','Process posture',{scope:'campaign',officerAvailability:100,solveRate:100,evidenceThreshold:0,stopThreshold:0,searchThreshold:0,bookingMinutes:2,detentionMinutes:3,bailLikelihood:100,releaseLikelihood:100,courtMinDays:1,courtMaxDays:1}),law=make('law','Serious offense',{jurisdictionIds:[room.id],agencyIds:[agency.id],permits:['stop','search','arrest','charge','sentence'],requiresWarrant:false,chargeEvidence:1,bailCents:500}),crime=make('crime','Serious reported crime',{lawId:law.id,category:'violent',severity:90,locationId:room.id,offenderIds:[suspect.id],victimIds:[witness.id],witnessIds:[witness.id],occurredAt:'2012-06-01T12:00:00.000Z',sourceEventId:eventId,highProfile:true}),s=state([room,suspect,witness,officer,agency,posture,law,crime]);
 const alleged=fact(s,suspect.id,'alleged-act',{crimeId:crime.id,lawId:law.id},eventId,[witness.id]),file=fileCrimeReport(s,{factId:alleged,reporterId:witness.id,agencyId:agency.id,investigatorId:officer.id,crimeId:crime.id,directWitness:true}).file,evidence=make('evidence','Camera record',{locationId:room.id,caseId:file.id,crimeId:crime.id,discoveredBy:[officer.id],strength:80,reliability:100});
 s.entities.push(evidence);act(s,officer.id,{type:'collect',evidenceId:evidence.id,caseId:file.id});act(s,officer.id,{type:'case',caseId:file.id,operation:'investigate',targetId:null});act(s,officer.id,{type:'case',caseId:file.id,operation:'stop',targetId:suspect.id});act(s,officer.id,{type:'case',caseId:file.id,operation:'search',targetId:room.id});act(s,officer.id,{type:'case',caseId:file.id,operation:'arrest',targetId:suspect.id});act(s,officer.id,{type:'case',caseId:file.id,operation:'booking',targetId:suspect.id});
 assert.equal(data(file,'case').stage,'booking');assert.equal(data(suspect,'character').arrested,true);act(s,officer.id,{type:'wait',minutes:1});assert.equal(data(file,'case').stage,'jail');
 act(s,suspect.id,{type:'pay-bail',caseId:file.id});assert.equal(data(file,'case').stage,'bail');assert.equal(data(suspect,'character').arrested,false);assert.equal(data(suspect,'character').cash,500);
 act(s,officer.id,{type:'case',caseId:file.id,operation:'charge',targetId:suspect.id});assert.throws(()=>act(s,officer.id,{type:'case',caseId:file.id,operation:'trial',targetId:suspect.id}),/court_not_scheduled_yet/);act(s,officer.id,{type:'wait',minutes:1440});act(s,officer.id,{type:'case',caseId:file.id,operation:'trial',targetId:suspect.id});act(s,officer.id,{type:'case',caseId:file.id,operation:'sentence',targetId:suspect.id});act(s,officer.id,{type:'case',caseId:file.id,operation:'probation',targetId:suspect.id});
 assert.equal(data(file,'case').stage,'probation');assert.ok(data(file,'case').history.some(row=>row.operation==='arrest'&&row.authorized));validateState(s);
});

test('reports and case actions reject knowledge the actor or assigned officer does not possess',()=>{
 const room=make('location','Street'),reporter=make('character','Caller',{playable:true,locationId:room.id},'owner'),officer=make('character','Officer',{locationId:room.id}),suspect=make('character','Unknown suspect',{locationId:room.id}),agency=make('faction','Police',{memberIds:[officer.id],jurisdictionIds:[room.id]}),s=state([room,reporter,officer,suspect,agency]),hidden=fact(s,suspect.id,'alleged-act',true,eventId,[]),file=make('case','Improper file',{agencyId:agency.id,investigatorId:officer.id,suspectIds:[suspect.id],factIds:[hidden]});
 s.entities.push(file);
 assert.throws(()=>act(s,reporter.id,{type:'report',factId:hidden,agencyId:agency.id,investigatorId:officer.id}),/fact_unknown/);
 assert.throws(()=>act(s,officer.id,{type:'case',caseId:file.id,operation:'investigate',targetId:null}),/case_knowledge_missing/);
 assert.equal(data(file,'case').stage,'reported');validateState(s);
});
