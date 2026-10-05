import {createHash} from 'node:crypto';
import {simulationId as randomUUID} from './turn-runtime.ts';
import {data,getEntity,validateEntity} from './model.ts';
import type {Data,Entity,State} from './model.ts';
import {fact,observe} from './epistemics.ts';
import {caseEvidenceScore,raiseHeat} from './investigation.ts';

export type EnforcementPosture={
 reportProbability:number;dispatchMinMinutes:number;dispatchMaxMinutes:number;officerAvailability:number;solveRate:number;
 evidenceThreshold:number;stopThreshold:number;searchThreshold:number;casePriority:number;bookingMinutes:number;detentionMinutes:number;
 bailLikelihood:number;releaseLikelihood:number;courtMinDays:number;courtMaxDays:number;informalResolution:number;
 corruptionTolerance:number;corruptionAuthored:boolean;seriousCrimeThreshold:number;directWitnessWeight:number;
 highProfileWeight:number;rivalPressureWeight:number;accumulatedEvidenceWeight:number;sourceIds:string[];
};
const defaults:Omit<EnforcementPosture,'sourceIds'>={reportProbability:35,dispatchMinMinutes:20,dispatchMaxMinutes:60,officerAvailability:45,solveRate:25,evidenceThreshold:55,stopThreshold:35,searchThreshold:60,casePriority:0,bookingMinutes:240,detentionMinutes:1440,bailLikelihood:70,releaseLikelihood:60,courtMinDays:30,courtMaxDays:180,informalResolution:20,corruptionTolerance:0,corruptionAuthored:false,seriousCrimeThreshold:75,directWitnessWeight:25,highProfileWeight:25,rivalPressureWeight:15,accumulatedEvidenceWeight:30};
const clamp=(value:number)=>Math.max(0,Math.min(100,value));
export const policyRoll=(seed:string)=>parseInt(createHash('sha256').update(seed).digest('hex').slice(0,8),16)%10000/100;
const hierarchy=(s:State,locationId:string|null)=>{
 const ids:string[]=[];let current=locationId;
 while(current&&!ids.includes(current)){ids.push(current);const place=s.entities.find(e=>e.id===current&&e.kind==='location'&&!e.archived);current=place?data(place,'location').parentId:null;}
 return ids.reverse();
};
export function resolveLawPosture(s:State,locationId:string|null,agencyId:string|null):EnforcementPosture{
 const authored=s.settings.campaign?.lawEnforcement;
 const result:EnforcementPosture={...defaults,
  ...(authored?{reportProbability:authored.reportProbability,dispatchMinMinutes:authored.dispatchDelay.min,dispatchMaxMinutes:authored.dispatchDelay.max,officerAvailability:authored.officerAvailability,solveRate:authored.solveRate,evidenceThreshold:authored.evidenceThreshold,stopThreshold:authored.stopThreshold,searchThreshold:authored.searchThreshold,casePriority:authored.casePriority,bookingMinutes:authored.bookingMinutes,detentionMinutes:authored.detentionMinutes,bailLikelihood:authored.bailLikelihood,releaseLikelihood:authored.releaseLikelihood,courtMinDays:authored.courtDelayDays.min,courtMaxDays:authored.courtDelayDays.max,informalResolution:authored.informalResolution,corruptionTolerance:authored.corruptionTolerance,corruptionAuthored:authored.corruptionAuthored,seriousCrimeThreshold:authored.seriousCrimeThreshold,directWitnessWeight:authored.directWitnessWeight,highProfileWeight:authored.highProfileWeight,rivalPressureWeight:authored.rivalPressureWeight,accumulatedEvidenceWeight:authored.accumulatedEvidenceWeight}:{}),sourceIds:[]};
 const ancestors=hierarchy(s,locationId),rows=s.entities.filter(e=>e.kind==='lawPosture'&&!e.archived).sort((a,b)=>a.id.localeCompare(b.id));
 const ordered=[...rows.filter(e=>data(e,'lawPosture').scope==='campaign'),...ancestors.flatMap(id=>rows.filter(e=>{const p=data(e,'lawPosture');return p.scope==='district'&&p.locationId===id;})),...rows.filter(e=>{const p=data(e,'lawPosture');return p.scope==='agency'&&p.agencyId===agencyId;})];
 for(const entity of ordered){
  const p=data(entity,'lawPosture'),assign=<K extends keyof EnforcementPosture>(key:K,value:EnforcementPosture[K]|null)=>{if(value!==null)(result[key] as EnforcementPosture[K])=value;};
  assign('reportProbability',p.reportProbability);assign('dispatchMinMinutes',p.dispatchMinMinutes);assign('dispatchMaxMinutes',p.dispatchMaxMinutes);assign('officerAvailability',p.officerAvailability);assign('solveRate',p.solveRate);
  assign('evidenceThreshold',p.evidenceThreshold);assign('stopThreshold',p.stopThreshold);assign('searchThreshold',p.searchThreshold);assign('casePriority',p.casePriority);assign('bookingMinutes',p.bookingMinutes);assign('detentionMinutes',p.detentionMinutes);
  assign('bailLikelihood',p.bailLikelihood);assign('releaseLikelihood',p.releaseLikelihood);assign('courtMinDays',p.courtMinDays);assign('courtMaxDays',p.courtMaxDays);assign('informalResolution',p.informalResolution);assign('corruptionTolerance',p.corruptionTolerance);assign('corruptionAuthored',p.corruptionAuthored);
  assign('seriousCrimeThreshold',p.seriousCrimeThreshold);assign('directWitnessWeight',p.directWitnessWeight);assign('highProfileWeight',p.highProfileWeight);assign('rivalPressureWeight',p.rivalPressureWeight);assign('accumulatedEvidenceWeight',p.accumulatedEvidenceWeight);result.sourceIds.push(entity.id);
 }
 if(result.dispatchMaxMinutes<result.dispatchMinMinutes)result.dispatchMaxMinutes=result.dispatchMinMinutes;
 if(result.courtMaxDays<result.courtMinDays)result.courtMaxDays=result.courtMinDays;
 // Corruption never has mechanical force unless the author explicitly enabled it.
 if(!result.corruptionAuthored)result.corruptionTolerance=0;
 return result;
}
export const postureDelayMinutes=(p:EnforcementPosture,seed:string)=>p.dispatchMinMinutes+Math.floor(policyRoll(seed)/100*(p.dispatchMaxMinutes-p.dispatchMinMinutes+1));
export const courtDelayDays=(p:EnforcementPosture,seed:string)=>p.courtMinDays+Math.floor(policyRoll(seed)/100*(p.courtMaxDays-p.courtMinDays+1));
export function availableOfficer(s:State,agencyId:string,locationId:string,seed:string){
 const agency=data(getEntity(s,agencyId,'faction'),'faction'),p=resolveLawPosture(s,locationId,agencyId);
 if(policyRoll(seed+'|availability')>=p.officerAvailability)return null;
 return s.entities.filter(e=>e.kind==='character'&&!e.archived&&agency.memberIds.includes(e.id)&&!e.data.playable&&e.data.condition==='conscious'&&!s.entities.some(call=>call.kind==='dispatch'&&!call.archived&&call.data.responderId===e.id&&['enroute','arrived'].includes(String(call.data.status)))).sort((a,b)=>a.id.localeCompare(b.id))[0]??null;
}
const add=<K extends Entity['kind']>(s:State,kind:K,name:string,raw:Record<string,unknown>,visibility:Entity['visibility']='knowledge')=>{
 const entity=validateEntity({id:randomUUID(),kind,name,data:raw,visibility});s.entities.push(entity);return entity;
};
export const caseKnowledgeScore=caseEvidenceScore;
export function enforcementAssessment(s:State,file:Entity,operation:'investigate'|'stop'|'search'|'arrest'|'charge'|'informal'){
 const c=data(file,'case'),investigator=getEntity(s,c.investigatorId,'character'),locationId=String(investigator.data.locationId??''),p=resolveLawPosture(s,locationId||null,c.agencyId),crimes=c.crimeIds.map(id=>s.entities.find(e=>e.id===id&&e.kind==='crime'&&!e.archived)).filter((e):e is Entity=>!!e),severity=Math.max(0,...crimes.map(e=>Number(e.data.severity))),direct=c.reportIds.some(id=>s.entities.some(e=>e.id===id&&e.kind==='crimeReport'&&e.data.directWitness)),highProfile=crimes.some(e=>e.data.highProfile),rivalPressure=Math.max(0,...crimes.map(e=>Number(e.data.rivalPressure))),knowledgeScore=caseKnowledgeScore(s,file),evidenceCount=c.evidenceIds.length;
 const agencyScore=clamp(knowledgeScore+severity*.4+c.priority+p.casePriority+(direct?p.directWitnessWeight:0)+(highProfile?p.highProfileWeight:0)+rivalPressure/100*p.rivalPressureWeight+Math.min(1,evidenceCount/3)*p.accumulatedEvidenceWeight+p.solveRate*.2);
 const threshold=operation==='stop'?p.stopThreshold:operation==='search'?p.searchThreshold:operation==='investigate'?Math.max(0,p.evidenceThreshold-25):operation==='charge'?Math.min(100,p.evidenceThreshold+10):operation==='informal'?0:p.evidenceThreshold;
 const serious=severity>=p.seriousCrimeThreshold,informal=policyRoll(file.id+'|informal')<p.informalResolution&&!serious,corrupt=p.corruptionAuthored&&policyRoll(file.id+'|corruption')<p.corruptionTolerance;
 return {posture:p,knowledgeScore,agencyScore,severity,serious,willing:agencyScore>=threshold,threshold,informalEligible:informal||corrupt,corruptionApplied:corrupt};
}
export function legalAuthority(s:State,file:Entity,operation:'stop'|'search'|'arrest'|'charge'|'sentence',locationId:string,targetId:string|null){
 const c=data(file,'case'),score=caseKnowledgeScore(s,file),laws=c.lawIds.map(id=>s.entities.find(e=>e.id===id&&e.kind==='law'&&!e.archived)).filter((e):e is Entity=>!!e).map(e=>data(e,'law')).filter(l=>l.agencyIds.includes(c.agencyId)&&l.jurisdictionIds.includes(locationId)&&l.permits.includes(operation));
 const enough=laws.some(l=>score>=(operation==='stop'?l.stopEvidence:operation==='search'?l.searchEvidence:operation==='arrest'?l.arrestEvidence:operation==='charge'?l.chargeEvidence:0));
 const warrant=operation!=='search'||laws.some(l=>!l.requiresWarrant||Boolean(targetId&&c.warrantLocationIds.includes(targetId)));
 return {authorized:laws.length>0&&enough&&warrant,score,warrant,reason:!laws.length?'legal_authority_not_authored':!enough?'legal_evidence_standard_not_met':!warrant?'warrant_required':'authorized'};
}
export function fileCrimeReport(s:State,input:{factId:string;reporterId:string;agencyId:string;investigatorId:string;crimeId?:string|null;directWitness?:boolean;method?:Data<'crimeReport'>['method'];reliability?:number}){
 const proposition=s.facts.find(row=>row.id===input.factId);if(!proposition)throw new Error('fact_unavailable');
 const agency=data(getEntity(s,input.agencyId,'faction'),'faction'),officer=getEntity(s,input.investigatorId,'character');if(!agency.memberIds.includes(officer.id))throw new Error('investigator_not_in_agency');
 const crime=input.crimeId?getEntity(s,input.crimeId,'crime'):null,d=crime?data(crime,'crime'):null,locationId=d?.locationId??String(getEntity(s,input.reporterId,'character').data.locationId??'');
 if(!locationId)throw new Error('location_required');observe(s,officer.id,input.factId,'report:'+input.reporterId);
 const posture=resolveLawPosture(s,locationId,input.agencyId),reliability=input.reliability??(input.directWitness?80:50),suspects=d?.offenderIds??[proposition.subjectId],priority=clamp(posture.casePriority+(d?.severity??25)+(d?.highProfile?posture.highProfileWeight:0)+(d?.rivalPressure??0)/100*posture.rivalPressureWeight);
 const report=add(s,'crimeReport','Witness report',{crimeId:crime?.id??null,factId:input.factId,reporterId:input.reporterId,agencyId:input.agencyId,recipientId:officer.id,method:input.method??'911',directWitness:input.directWitness??false,reliability,createdAt:s.clock},'knowledge');
 const file=add(s,'case','Reported incident',{agencyId:input.agencyId,investigatorId:officer.id,suspectIds:suspects,suspectStatus:Object.fromEntries(suspects.map(id=>[id,'suspect'])),crimeIds:crime?[crime.id]:[],reportIds:[report.id],factIds:[input.factId],lawIds:d?.lawId?[d.lawId]:[],leads:['Report from '+getEntity(s,input.reporterId,'character').name],priority,reportedAt:s.clock,postureSourceIds:posture.sourceIds,history:[{at:s.clock,operation:'report',actorId:input.reporterId,targetId:null,authorized:true,knowledgeScore:clamp(reliability*.25),agencyScore:priority,reason:'witness report received'}]},'knowledge');
 const responder=agency.dispatchPolicy?.kind==='police'?availableOfficer(s,input.agencyId,locationId,report.id):null;
 let dispatch:Entity|null=null;
 if(agency.dispatchPolicy?.kind==='police'&&agency.jurisdictionIds.includes(locationId)){
  const minutes=postureDelayMinutes(posture,report.id),dueAt=responder?new Date(Date.parse(s.clock)+minutes*60000).toISOString():null;
  dispatch=add(s,'dispatch','Police dispatch',{agencyId:input.agencyId,requesterId:input.reporterId,locationId,responderId:responder?.id??null,crimeId:crime?.id??null,caseId:file.id,reportId:report.id,report:'Reported incident',kind:'police',status:responder?'enroute':'queued',priority,dueAt,createdAt:s.clock,postureSourceIds:posture.sourceIds},'knowledge');
  if(responder)s.beliefs.push({id:randomUUID(),observerId:responder.id,proposition:'Reported incident',confidence:reliability/100,source:'dispatch:'+dispatch.id,at:s.clock,correctedBy:null});
 }
 report.data.caseId=file.id;report.data.dispatchId=dispatch?.id??null;
 if(crime){if(!d!.reportIds.includes(report.id))d!.reportIds.push(report.id);if(!d!.caseIds.includes(file.id))d!.caseIds.push(file.id);d!.status='reported';crime.data=d as Entity['data'];}
 for(const suspectId of suspects)if(s.entities.some(e=>e.id===suspectId&&e.kind==='character'))raiseHeat(s,{subjectId:suspectId,watcherId:input.agencyId,locationId,reason:'reported incident',confidence:Math.max(1,reliability*.1),resources:Math.max(1,priority*.05),sourceId:file.id,caseIds:[file.id],eventId:proposition.eventId});
 return {report,file,dispatch};
}
export function recordCrime(s:State,input:{offenderIds:string[];victimIds?:string[];lawId?:string|null;locationId:string;eventId:string;category?:Data<'crime'>['category'];severity?:number;highProfile?:boolean;rivalPressure?:number;name?:string}){
 const offenders=[...new Set(input.offenderIds)],victims=[...new Set(input.victimIds??[])],witnesses=s.entities.filter(e=>e.kind==='character'&&!e.archived&&e.data.locationId===input.locationId&&e.data.condition==='conscious'&&!offenders.includes(e.id)).map(e=>e.id),districtId=hierarchy(s,input.locationId).reverse().find(id=>{const e=s.entities.find(row=>row.id===id);return e?.kind==='location'&&['district','neighborhood'].includes(String(e.data.category));})??null;
 const crime=add(s,'crime',input.name??'Recorded offense',{lawId:input.lawId??null,category:input.category??'other',severity:input.severity??25,locationId:input.locationId,districtId,offenderIds:offenders,victimIds:victims,witnessIds:witnesses,occurredAt:s.clock,sourceEventId:input.eventId,highProfile:input.highProfile??false,rivalPressure:input.rivalPressure??0},'knowledge');
 const factId=fact(s,offenders[0]!,'alleged-act',{crimeId:crime.id,lawId:input.lawId??null,victimIds:victims},input.eventId,[...offenders,...witnesses],{evidenceIds:[]});
 const filed:ReturnType<typeof fileCrimeReport>[]=[];
 for(const witnessId of witnesses){
  const agency=s.entities.filter(e=>e.kind==='faction'&&!e.archived).find(e=>{const f=data(e,'faction');return f.dispatchPolicy?.kind==='police'&&f.jurisdictionIds.includes(input.locationId)&&f.memberIds.length>0;});if(!agency)continue;
  const a=data(agency,'faction'),investigator=a.memberIds.map(id=>s.entities.find(e=>e.id===id&&e.kind==='character'&&!e.archived)).find((e):e is Entity=>!!e);if(!investigator)continue;
  const p=resolveLawPosture(s,input.locationId,agency.id),severity=input.severity??25,chance=clamp(p.reportProbability+severity*.25+(input.highProfile?p.highProfileWeight:0)+(severity>=p.seriousCrimeThreshold?25:0));
  if(policyRoll(crime.id+'|'+witnessId+'|report')<chance)filed.push(fileCrimeReport(s,{factId,reporterId:witnessId,agencyId:agency.id,investigatorId:investigator.id,crimeId:crime.id,directWitness:true,reliability:80}));
 }
 return {crime,factId,filed};
}
