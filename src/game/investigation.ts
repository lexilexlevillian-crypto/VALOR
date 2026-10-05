import {simulationId as randomUUID} from './turn-runtime.ts';
import {data,getEntity,validateEntity} from './model.ts';
import type {Data,Entity,State} from './model.ts';
import {carriedBy} from './items.ts';

const clamp=(value:number)=>Math.max(0,Math.min(100,value));
const requireCondition=(ok:unknown,code:string)=>{if(!ok)throw new Error(code);};
const set=(entity:Entity,value:unknown)=>{entity.data=value as Entity['data'];};

export function effectiveEvidenceStrength(evidence:Entity){
 const d=data(evidence,'evidence');if(d.destroyed||d.condition==='destroyed')return 0;
 const condition={intact:1,degraded:.75,partial:.5,contaminated:.35,destroyed:0}[d.condition],contamination=d.contaminated?.5:1;
 return clamp(d.strength*d.reliability/100*condition*contamination);
}
export function caseEvidenceScore(s:State,file:Entity){
 const c=data(file,'case'),evidence=c.evidenceIds.map(id=>s.entities.find(e=>e.id===id&&e.kind==='evidence'&&!e.archived)).filter((e):e is Entity=>!!e).reduce((sum,e)=>sum+effectiveEvidenceStrength(e),0),reports=c.reportIds.map(id=>s.entities.find(e=>e.id===id&&e.kind==='crimeReport'&&!e.archived)).filter((e):e is Entity=>!!e).reduce((sum,e)=>sum+Number(e.data.reliability??50)*.25,0);
 return clamp(evidence+reports);
}
export function recordEvidenceHistory(s:State,evidence:Entity,actorId:string|null,eventId:string,operation:Data<'evidence'>['history'][number]['operation'],reason:string){
 const d=data(evidence,'evidence');d.history.push({at:s.clock,actorId,eventId,operation,reason,locationId:d.locationId??d.sourceLocationId,condition:d.condition});if(d.history.length>5000)d.history.splice(0,d.history.length-5000);set(evidence,d);
}
const heatStatus=(confidence:number,resources:number,threshold:number):Data<'criminalHeat'>['status']=>{
 const score=confidence*.7+resources*.3;if(score>=threshold)return 'escalated';if(score>=Math.max(50,threshold*.7))return 'active';if(score>=30)return 'investigating';if(score>0)return 'watch';return 'closed';
};
export function raiseHeat(s:State,input:{subjectId:string;watcherId:string;locationId?:string|null;reason:string;confidence:number;resources?:number;sourceId?:string|null;eventId?:string|null;caseIds?:string[];evidenceIds?:string[]}){
 const subject=getEntity(s,input.subjectId,'character'),watcher=getEntity(s,input.watcherId);requireCondition(['faction','business'].includes(watcher.kind),'invalid_heat_watcher');
 let entity=s.entities.find(e=>e.kind==='criminalHeat'&&!e.archived&&e.data.subjectId===subject.id&&e.data.watcherId===watcher.id&&String(e.data.locationId??'')===String(input.locationId??''));
 if(!entity){entity=validateEntity({id:randomUUID(),kind:'criminalHeat',name:'Attention: '+watcher.name+' → '+subject.name,visibility:'creator',data:{subjectId:subject.id,watcherId:watcher.id,locationId:input.locationId??null,lastUpdatedAt:s.clock}});s.entities.push(entity);}
 const h=data(entity,'criminalHeat'),previous=h.status;h.confidence=clamp(h.confidence+input.confidence);h.resources=clamp(h.resources+(input.resources??0));h.reasons.push({at:s.clock,reason:input.reason,sourceId:input.sourceId??null,eventId:input.eventId??null});h.caseIds=[...new Set([...h.caseIds,...(input.caseIds??[])])];h.evidenceIds=[...new Set([...h.evidenceIds,...(input.evidenceIds??[])])];h.lastUpdatedAt=s.clock;h.closesAt=null;h.status=heatStatus(h.confidence,h.resources,h.escalationThreshold);set(entity,h);
 const character=data(subject,'character');character.heat[watcher.id]=h.confidence;set(subject,character);
 return {entity,previous,status:h.status,escalated:previous!=='escalated'&&h.status==='escalated'};
}
export function heatValue(s:State,subjectId:string,watcherId:string,locationId:string|null=null){
 const records=s.entities.filter(e=>e.kind==='criminalHeat'&&!e.archived&&e.data.subjectId===subjectId&&e.data.watcherId===watcherId&&e.data.status!=='closed'&&(!locationId||!e.data.locationId||e.data.locationId===locationId));
 const subject=s.entities.find(e=>e.id===subjectId&&e.kind==='character'&&!e.archived),legacy=subject?Number(data(subject,'character').heat[watcherId]??0):0;return Math.max(legacy,...records.map(e=>Number(e.data.confidence)));
}
export function noticeHeatSignal(s:State,input:{subjectId:string;watcherId:string;locationId?:string|null;kind:Data<'criminalHeat'>['signals'][number]['kind'];description:string;noticedByIds:string[]}){
 const found=s.entities.find(e=>e.kind==='criminalHeat'&&!e.archived&&e.data.subjectId===input.subjectId&&e.data.watcherId===input.watcherId&&String(e.data.locationId??'')===String(input.locationId??''));if(!found)return null;
 const h=data(found,'criminalHeat');h.signals.push({id:randomUUID(),at:s.clock,kind:input.kind,description:input.description,noticedByIds:[...new Set(input.noticedByIds)]});set(found,h);return found;
}
export function heatSignals(s:State,observerId:string){
 return s.entities.filter(e=>e.kind==='criminalHeat'&&!e.archived&&e.data.subjectId===observerId).flatMap(e=>data(e,'criminalHeat').signals.filter(signal=>signal.noticedByIds.includes(observerId)).map(signal=>({at:signal.at,kind:signal.kind,description:signal.description}))).sort((a,b)=>a.at.localeCompare(b.at));
}
export function decayCriminalHeat(s:State,start:number,end:number){
 for(const entity of s.entities.filter(e=>e.kind==='criminalHeat'&&!e.archived)){
  const h=data(entity,'criminalHeat');if(h.status==='closed')continue;if(h.closesAt&&Date.parse(h.closesAt)<=end){h.confidence=0;h.resources=0;h.status='closed';h.lastUpdatedAt=new Date(end).toISOString();set(entity,h);continue;}
  const from=Math.max(start,Date.parse(h.lastUpdatedAt)),days=Math.max(0,end-from)/86400000;if(days<1/24)continue;
  h.confidence=clamp(h.confidence-h.decayPerDay*days);h.resources=clamp(h.resources-h.decayPerDay*.5*days);h.status=heatStatus(h.confidence,h.resources,h.escalationThreshold);h.lastUpdatedAt=new Date(end).toISOString();set(entity,h);
  const subject=s.entities.find(e=>e.id===h.subjectId&&e.kind==='character'&&!e.archived);if(subject)subject.data.heat={...(subject.data.heat as Record<string,number>),[h.watcherId]:h.confidence};
 }
}
export function raiseSceneHeat(s:State,input:{subjectId:string;locationId:string|null;reason:string;amount:number;sourceId?:string|null;eventId?:string|null}){
 if(!input.locationId)return[];
 const watchers=s.entities.filter(e=>e.kind==='faction'&&!e.archived).filter(e=>{const f=data(e,'faction');return f.jurisdictionIds.includes(input.locationId!)||f.memberIds.some(id=>s.entities.some(c=>c.id===id&&c.kind==='character'&&c.data.locationId===input.locationId));});
 return watchers.map(watcher=>raiseHeat(s,{subjectId:input.subjectId,watcherId:watcher.id,locationId:input.locationId,reason:input.reason,confidence:input.amount,resources:input.amount*.5,sourceId:input.sourceId,eventId:input.eventId}));
}
export function analyzeEvidence(s:State,actorId:string,caseId:string,evidenceId:string,optionId:string,eventId:string){
 const file=getEntity(s,caseId,'case'),c=data(file,'case'),evidence=getEntity(s,evidenceId,'evidence'),d=data(evidence,'evidence');requireCondition(c.investigatorId===actorId,'investigator_required');requireCondition((c.evidenceIds.includes(evidence.id)||d.caseId===file.id||d.caseIds.includes(file.id))&&(d.discoveredBy.includes(actorId)||d.knownByIds.includes(actorId)||d.custodianId===actorId),'evidence_access_denied');
 const option=d.investigationOptions.find(row=>row.id===optionId);requireCondition(option&&!option.completedAt,'investigation_option_unavailable');requireCondition(!d.destroyed&&d.condition!=='destroyed','evidence_destroyed');if(option!.requiresLegalAccess)requireCondition(!['none','scene'].includes(d.accessBasis),'investigative_legal_access_required');
 const agency=getEntity(s,c.agencyId,'faction'),a=data(agency,'faction');requireCondition(a.treasuryCents>=option!.costCents,'investigation_resources_insufficient');
 let resource:Entity|null=null;if(option!.resourceItemId){resource=getEntity(s,option!.resourceItemId,'item');const item=data(resource,'item');requireCondition(carriedBy(s,resource,actorId)&&item.quantity>=option!.resourceQuantity,'investigation_resource_required');item.quantity-=option!.resourceQuantity;set(resource,item);}
 a.treasuryCents-=option!.costCents;set(agency,a);
 const contaminationWarning=d.contaminated||d.condition==='contaminated',reliability=clamp(option!.reliability*(contaminationWarning?.4:1)*(d.condition==='degraded'?.75:d.condition==='partial'?.5:1)),outcome=contaminationWarning&&reliability<50&&['lead','exclusion'].includes(option!.outcome)?'ambiguity':option!.outcome,analysisId=randomUUID();
 d.analyses.push({id:analysisId,optionId:option!.id,at:s.clock,analystId:actorId,caseId:file.id,outcome,summary:option!.summary,reliability,resourceItemId:option!.resourceItemId,costCents:option!.costCents,contaminationWarning,eventId});option!.completedAt=s.clock;option!.completedBy=actorId;if(!d.knownByIds.includes(actorId))d.knownByIds.push(actorId);if(!d.caseIds.includes(file.id))d.caseIds.push(file.id);if(!d.caseId)d.caseId=file.id;
 if(!c.evidenceIds.includes(evidence.id))c.evidenceIds.push(evidence.id);c.leadRecords.push({id:analysisId,at:s.clock,kind:outcome,summary:option!.summary,reliability,sourceEvidenceId:evidence.id,sourceInformantId:null,sourceTipId:null,personIds:option!.personIds,objectIds:option!.objectIds,status:'open'});c.leads.push((outcome==='exclusion'?'Exclusion: ':outcome==='ambiguity'?'Ambiguous result: ':outcome==='error'?'Investigation error: ':'Lead: ')+option!.summary);
 if(outcome==='lead')c.hypotheses.push({id:randomUUID(),proposition:option!.summary,subjectId:option!.personIds[0]??null,status:'active',confidence:reliability,sourceEvidenceIds:[evidence.id],sourceReportIds:[],sourceInformantId:null,sourceTipId:null,createdById:actorId,createdAt:s.clock,updatedAt:s.clock,notes:''});
 if(outcome==='exclusion')for(const personId of option!.personIds)c.exclusions.push({id:randomUUID(),personId,reason:option!.summary,evidenceId:evidence.id,at:s.clock,reliability});
 if(option!.hypothesisId){const hypothesis=c.hypotheses.find(row=>row.id===option!.hypothesisId);if(hypothesis){hypothesis.status=outcome==='exclusion'?'refuted':outcome==='lead'?'supported':'ambiguous';hypothesis.confidence=reliability;hypothesis.updatedAt=s.clock;}}
 set(evidence,d);recordEvidenceHistory(s,evidence,actorId,eventId,'analyzed',option!.method+': '+outcome);set(file,c);c.evidenceScore=caseEvidenceScore(s,file);set(file,c);
 return {minutes:option!.minutes,outcome,reliability,summary:option!.summary,contaminationWarning};
}
export function consultInformant(s:State,actorId:string,informantId:string,caseId:string,tipId:string,acceptFavor:boolean,eventId:string){
 const entity=getEntity(s,informantId,'informant'),informant=data(entity,'informant'),file=getEntity(s,caseId,'case'),c=data(file,'case');requireCondition(informant.handlerId===actorId&&c.investigatorId===actorId,'informant_handler_required');
 const tip=informant.tips.find(row=>row.id===tipId);requireCondition(tip&&tip.status==='available','informant_tip_unavailable');if(tip!.subjectId&&informant.knowledge.personIds.length)requireCondition(informant.knowledge.personIds.includes(tip!.subjectId),'informant_knowledge_boundary');
 const payment=tip!.paymentCents||informant.terms.paymentCents,favor=tip!.favorTerm||informant.terms.favorTerm,agency=getEntity(s,c.agencyId,'faction'),a=data(agency,'faction');requireCondition(a.treasuryCents>=payment,'informant_payment_unavailable');requireCondition(!favor||acceptFavor,'informant_favor_acceptance_required');a.treasuryCents-=payment;set(agency,a);informant.terms.paidCents+=payment;if(favor)informant.terms.favorAccepted=true;if(informant.terms.paidCents>=informant.terms.paymentCents&&(!informant.terms.favorTerm||informant.terms.favorAccepted))informant.terms.status='satisfied';
 tip!.status='disclosed';tip!.disclosedAt=s.clock;informant.reliabilityHistory.push({at:s.clock,tipId:tip!.id,outcome:'unresolved',delta:0,note:'Tip entered as an unverified case hypothesis.'});if(!informant.knownByIds.includes(actorId))informant.knownByIds.push(actorId);set(entity,informant);
 const reliability=clamp((informant.reliability+tip!.reliability)/2),leadId=randomUUID();c.informantIds=[...new Set([...c.informantIds,entity.id])];c.leadRecords.push({id:leadId,at:s.clock,kind:'tip',summary:tip!.proposition,reliability,sourceEvidenceId:null,sourceInformantId:entity.id,sourceTipId:tip!.id,personIds:tip!.subjectId?[tip!.subjectId]:[],objectIds:[],status:'open'});c.hypotheses.push({id:randomUUID(),proposition:tip!.proposition,subjectId:tip!.subjectId,status:'active',confidence:reliability,sourceEvidenceIds:[],sourceReportIds:[],sourceInformantId:entity.id,sourceTipId:tip!.id,createdById:actorId,createdAt:s.clock,updatedAt:s.clock,notes:''});c.leads.push('Informant tip: '+tip!.proposition);set(file,c);
 s.beliefs.push({id:randomUUID(),observerId:actorId,proposition:tip!.proposition,subjectId:tip!.subjectId,predicate:'informant-tip',confidence:reliability/100,source:'informant:'+entity.id,truthStatus:'believed',eventIds:[eventId],at:s.clock,correctedBy:null});
 return {minutes:15,payment,favor,reliability,proposition:tip!.proposition};
}
