import {randomUUID} from 'node:crypto';
import {data,getEntity,matureContentModes,romanceIntents} from './model.ts';
import type {Data,Entity,State} from './model.ts';

export type RomanceIntent=(typeof romanceIntents)[number];
export type MatureContentMode=(typeof matureContentModes)[number];
const rank:Record<MatureContentMode,number>={off:0,implicit:1,'fade-to-black':2,'allowed-description':3};
const defaultSafety={minimumRomanceAge:18,minimumIntimacyAge:18,consentWindowMinutes:30,intoxicationBlocksConsentAt:50,allowNpcInitiative:true};
export const isRomanceIntent=(value:string):value is RomanceIntent=>(romanceIntents as readonly string[]).includes(value);
export const campaignRelationshipSafety=(s:State)=>s.settings.campaign?.relationshipSafety??defaultSafety;
const campaignContentMode=(s:State):MatureContentMode=>s.settings.campaign?.matureContent??s.settings.intimacy;
export function effectiveContentMode(s:State,characterId:string):MatureContentMode{
 const character=data(getEntity(s,characterId,'character'),'character'),campaign=campaignContentMode(s),choice=character.contentFilters.matureContent;
 return choice==='campaign'?campaign:(rank[choice]<=rank[campaign]?choice:campaign);
}
export function ageAt(dob:string|null,at:string){if(!dob)return null;const birth=new Date(dob+'T00:00:00.000Z'),now=new Date(at);let years=now.getUTCFullYear()-birth.getUTCFullYear();if(now.getUTCMonth()<birth.getUTCMonth()||now.getUTCMonth()===birth.getUTCMonth()&&now.getUTCDate()<birth.getUTCDate())years--;return years;}
export function romanceEligibility(s:State,initiatorId:string,recipientId:string,intent:RomanceIntent){
 const initiator=data(getEntity(s,initiatorId,'character'),'character'),recipient=data(getEntity(s,recipientId,'character'),'character'),safety=campaignRelationshipSafety(s),minimum=intent==='intimacy'?safety.minimumIntimacyAge:safety.minimumRomanceAge,initiatorAge=ageAt(initiator.dob,s.clock),recipientAge=ageAt(recipient.dob,s.clock);
 if(!s.settings.romance)return {allowed:false,reason:'romance_disabled'};
 if(initiatorAge===null||recipientAge===null||initiatorAge<minimum||recipientAge<minimum)return {allowed:false,reason:'age_or_legal_eligibility_required'};
 if(initiator.condition!=='conscious'||recipient.condition!=='conscious')return {allowed:false,reason:'consent_requires_conscious_participants'};
 if(initiator.restrainedBy||recipient.restrainedBy)return {allowed:false,reason:'consent_not_voluntary'};
 if(initiator.intoxication>=safety.intoxicationBlocksConsentAt||recipient.intoxication>=safety.intoxicationBlocksConsentAt)return {allowed:false,reason:'consent_invalid_while_intoxicated'};
 if(!initiator.locationId||initiator.locationId!==recipient.locationId)return {allowed:false,reason:'consent_context_changed'};
 if(initiator.contentFilters.romance==='off'||recipient.contentFilters.romance==='off')return {allowed:false,reason:'romance_filtered'};
 if(initiator.contentFilters.blockedIntents.includes(intent)||recipient.contentFilters.blockedIntents.includes(intent))return {allowed:false,reason:'content_filtered'};
 if(intent==='intimacy'&&(effectiveContentMode(s,initiatorId)==='off'||effectiveContentMode(s,recipientId)==='off'))return {allowed:false,reason:'intimacy_disabled'};
 return {allowed:true,reason:'eligible'};
}
export function expireConsentRequests(s:State,entity:Entity){
 const relation=data(entity,'relationship');for(const request of relation.consentRequests)if(request.status==='pending'&&Date.parse(request.expiresAt)<=Date.parse(s.clock)){request.status='expired';request.respondedAt=s.clock;if(relation.pending===request.intent)relation.pending='';}entity.data=relation as Entity['data'];
}
export function openConsentRequest(s:State,entity:Entity,intent:RomanceIntent,initiatorId:string,recipientId:string,id=randomUUID()){
 expireConsentRequests(s,entity);const relation=data(entity,'relationship'),eligibility=romanceEligibility(s,initiatorId,recipientId,intent);if(!eligibility.allowed)throw new Error(eligibility.reason);
 if(relation.boundaries.includes(intent)||data(getEntity(s,initiatorId,'character'),'character').boundaries.includes(intent)||data(getEntity(s,recipientId,'character'),'character').boundaries.includes(intent))throw new Error('boundary_declined');
 const existing=relation.consentRequests.find(request=>request.status==='pending'&&request.intent===intent&&request.initiatorId===initiatorId&&request.recipientId===recipientId);if(existing)return existing;
 const safety=campaignRelationshipSafety(s),request:Data<'relationship'>['consentRequests'][number]={id,intent,initiatorId,recipientId,requestedAt:s.clock,expiresAt:new Date(Date.parse(s.clock)+safety.consentWindowMinutes*60000).toISOString(),locationId:data(getEntity(s,initiatorId,'character'),'character').locationId,status:'pending',respondedAt:null,responseEventId:null,contentMode:effectiveContentMode(s,recipientId),voluntary:true};
 relation.consentRequests.push(request);relation.pending=intent;entity.data=relation as Entity['data'];return request;
}
export function respondToConsentRequest(s:State,entity:Entity,requestId:string,recipientId:string,intent:RomanceIntent,eventId:string,response:'accept'|'decline'|'withdraw',explicitConsent:boolean){
 expireConsentRequests(s,entity);const relation=data(entity,'relationship'),request=relation.consentRequests.find(candidate=>candidate.id===requestId);if(!request||request.status!=='pending'||request.intent!==intent)throw new Error('current_consent_request_required');
 if(response==='withdraw'){if(request.initiatorId!==recipientId)throw new Error('consent_request_not_owned');request.status='withdrawn';}
 else{if(request.recipientId!==recipientId)throw new Error('consent_request_not_addressed_to_actor');if(response==='accept'){if(!explicitConsent)throw new Error('explicit_consent_required');const eligibility=romanceEligibility(s,request.initiatorId,request.recipientId,intent);if(!eligibility.allowed)throw new Error(eligibility.reason);if(request.locationId!==data(getEntity(s,recipientId,'character'),'character').locationId)throw new Error('consent_context_changed');request.status='accepted';}else request.status='declined';}
 request.respondedAt=s.clock;request.responseEventId=eventId;if(relation.pending===intent)relation.pending='';entity.data=relation as Entity['data'];return request;
}
export function cancelPendingConsent(s:State,actorId:string,targetId:string|null,eventId:string){
 let canceled=0;for(const entity of s.entities.filter(candidate=>candidate.kind==='relationship'&&!candidate.archived)){const relation=data(entity,'relationship');for(const request of relation.consentRequests)if(request.status==='pending'&&(request.initiatorId===actorId||request.recipientId===actorId)&&(!targetId||request.initiatorId===targetId||request.recipientId===targetId)){request.status='withdrawn';request.respondedAt=s.clock;request.responseEventId=eventId;if(relation.pending===request.intent)relation.pending='';canceled++;}entity.data=relation as Entity['data'];}return canceled;
}
export function intimacyPresentation(mode:MatureContentMode){return mode==='implicit'?'Private intimacy is acknowledged without description.':mode==='fade-to-black'?'The scene fades to black.':mode==='allowed-description'?'Intimacy is acknowledged within the selected non-explicit description boundary.':'Intimacy is unavailable under the current content settings.';}
