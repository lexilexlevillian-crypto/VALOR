import {data,getEntity} from './model.ts';
import type {Action,Data,Entity,State} from './model.ts';
import {visible,fact} from './epistemics.ts';
import {add,emit,isOpen} from './simulation.ts';
import type {Effect} from './simulation.ts';
import {lawResponseMinutes,needsEnabled} from './policy.ts';
import {acceptsCommunication,communicationDelayMinutes,contactFor,conversationThread,phonePowered,recipientPhone,requirePhone,touchContact} from './phone.ts';
import {carriedBy} from './items.ts';
const requireCondition=(ok:unknown,code:string)=>{if(!ok)throw new Error(code);};
export function extendedAction(s:State,actorId:string,pc:Data<'character'>,action:Action,eventId:string,effects:Effect[]):number{
 const output=(text:string)=>emit(effects,text,[actorId],action.type,actorId);
 const phone=(id:string)=>requirePhone(s,id,actorId);
 switch(action.type){
  case 'request-assistance':{
   phone(action.phoneId);requireCondition(pc.locationId,'location_required');
   const agency=getEntity(s,action.agencyId,'faction'),a=data(agency,'faction');
   requireCondition(visible(s,agency,actorId)&&a.dispatchPolicy&&a.jurisdictionIds.includes(pc.locationId!),'dispatch_unavailable');
   requireCondition(!s.entities.some(e=>e.kind==='dispatch'&&!e.archived&&e.data.requesterId===actorId&&e.data.agencyId===agency.id&&e.data.status!=='closed'),'dispatch_already_pending');
   if(action.patientId){const patient=getEntity(s,action.patientId,'character');requireCondition(patient.data.locationId===pc.locationId&&visible(s,patient,actorId),'patient_not_present');}
   const responder=s.entities.filter(e=>e.kind==='character'&&!e.archived&&a.memberIds.includes(e.id)&&!e.data.playable&&e.data.condition==='conscious'&&!s.entities.some(call=>call.kind==='dispatch'&&call.data.responderId===e.id&&['enroute','arrived'].includes(String(call.data.status)))).sort((x,y)=>x.id.localeCompare(y.id))[0];
   const responseMinutes=a.dispatchPolicy!.kind==='police'?lawResponseMinutes(s,agency.id,a.dispatchPolicy!.responseMinutes):a.dispatchPolicy!.responseMinutes,call=add(s,'dispatch','Assistance request',{agencyId:agency.id,requesterId:actorId,locationId:pc.locationId,responderId:responder?.id??null,patientId:action.patientId,destinationId:a.dispatchPolicy!.hospitalId,report:action.report,kind:a.dispatchPolicy!.kind,status:responder?'enroute':'queued',dueAt:responder?new Date(Date.parse(s.clock)+responseMinutes*60000).toISOString():null,transportConsent:action.patientId===actorId&&action.transportConsent,createdAt:s.clock},'owner');
   if(responder){s.beliefs.push({id:crypto.randomUUID(),observerId:responder.id,proposition:action.report,confidence:0.5,source:'dispatch:'+call.id,at:s.clock,correctedBy:null});fact(s,call.id,'request-received',true,eventId,[actorId,responder.id]);}
   output(responder?'Assistance requested; a responder is en route.':'Assistance requested; awaiting an available responder.');return 0;
  }
  case 'dispatch-response':{
   const entity=getEntity(s,action.dispatchId,'dispatch'),d=data(entity,'dispatch'),agency=data(getEntity(s,d.agencyId,'faction'),'faction');
   if(action.operation==='accept'){
    requireCondition(d.status==='queued'&&agency.memberIds.includes(actorId)&&agency.dispatchPolicy,'dispatch_authority_required');
    requireCondition(!s.entities.some(e=>e.kind==='dispatch'&&!e.archived&&e.data.responderId===actorId&&['enroute','arrived'].includes(String(e.data.status))),'responder_busy');
    d.responderId=actorId;d.status='enroute';const responseMinutes=d.kind==='police'?lawResponseMinutes(s,d.agencyId,agency.dispatchPolicy!.responseMinutes):agency.dispatchPolicy!.responseMinutes;d.dueAt=new Date(Date.parse(s.clock)+responseMinutes*60000).toISOString();
    s.beliefs.push({id:crypto.randomUUID(),observerId:actorId,proposition:d.report,confidence:0.5,source:'dispatch:'+entity.id,at:s.clock,correctedBy:null});
   }else if(action.operation==='close'){
    requireCondition([d.requesterId,d.responderId].includes(actorId),'dispatch_authority_required');d.status='closed';
   }else{
    requireCondition(d.kind==='ems'&&d.status==='arrived'&&d.patientId&&d.destinationId,'transport_unavailable');
    const patient=getEntity(s,d.patientId!,'character');
    requireCondition([d.patientId,d.responderId].includes(actorId)&&patient.data.locationId===d.locationId&&pc.locationId===d.locationId,'transport_authority_required');
    requireCondition(patient.data.condition!=='dead'&&(actorId===patient.id||d.transportConsent||patient.data.condition==='unconscious'),'patient_consent_required');
    if(patient.id===actorId)pc.locationId=d.destinationId;else patient.data.locationId=d.destinationId;
    d.status='closed';fact(s,entity.id,'hospital-transport',{patientId:patient.id,destinationId:d.destinationId},eventId,[patient.id,actorId]);
   }
   entity.data=d as Entity['data'];output('Assistance status: '+d.status+'.');return 1;
  }
  case 'settle-estate':{
   const entity=getEntity(s,action.estateId,'estate'),e=data(entity,'estate');requireCondition(e.authorized&&e.executorId===actorId&&!e.settledAt,'estate_authority_required');
   const deceased=getEntity(s,e.characterId,'character'),recipient=getEntity(s,e.beneficiaryId,'character');requireCondition(deceased.data.condition==='dead'&&recipient.data.condition!=='dead'&&recipient.id!==deceased.id,'estate_not_available');
   const beneficiary=recipient.id===actorId?pc:data(recipient,'character');beneficiary.cash+=Number(deceased.data.cash);beneficiary.bank+=Number(deceased.data.bank);deceased.data.cash=0;deceased.data.bank=0;
   const remains=new Set(s.entities.filter(x=>x.kind==='item'&&x.data.deceasedId===deceased.id).map(x=>x.id));
   for(const item of s.entities.filter(x=>x.kind==='item'&&!x.archived&&(x.data.ownerId===deceased.id||remains.has(String(x.data.containerId))))){item.data.ownerId=recipient.id;item.data.possessorId=recipient.id;item.data.locationId=null;item.data.containerId=null;item.data.equipped=false;item.data.wearState='stowed';}
   for(const vehicle of s.entities.filter(x=>x.kind==='vehicle'&&!x.archived&&x.data.ownerId===deceased.id))vehicle.data.ownerId=recipient.id;
   if(recipient.id!==actorId)recipient.data=beneficiary as Entity['data'];e.settledAt=s.clock;entity.data=e as Entity['data'];fact(s,entity.id,'estate-settled',true,eventId,[actorId,recipient.id]);output('The authorized estate transfer is recorded.');return 0;
  }
  case 'read-message':{
   phone(action.phoneId);const message=getEntity(s,action.messageId,'message'),m=data(message,'message');
   requireCondition(m.recipientPhoneId===action.phoneId&&m.toId===actorId&&!['queued','sent','failed'].includes(m.status)&&visible(s,message,actorId),'message_unavailable');
   m.read=true;m.status='read';m.readAt=s.clock;message.data=m as Entity['data'];output('Message marked as read.');return 0;
  }
  case 'phone-call':{
   const device=phone(action.phoneId),p=data(device,'item'),contact=contactFor(device,action.toId,action.number);requireCondition(action.number||contact,'contact_unknown');requireCondition(!contact?.blocked&&(!contact||contact.permissions.calls),'contact_blocked');
   const number=action.number||contact?.number||'',recipient=action.toId?getEntity(s,action.toId,'character'):null,receiver=recipientPhone(s,recipient?.id??null,number,'call'),recipientId=recipient?.id??(receiver?String(receiver.data.ownerId):null);
   const busy=s.entities.some(e=>e.kind==='message'&&!e.archived&&['ringing','active'].includes(String(e.data.callState))&&[e.data.fromId,e.data.toId].some(id=>id===actorId||id===recipientId));
   requireCondition(!busy,'line_busy');
   const accepted=receiver&&acceptsCommunication(receiver,actorId,'call'),failure=!receiver&&!recipientId?'wrong-number':!receiver?'recipient-unavailable':!accepted?'blocked':'',call=add(s,'message','Phone call',{fromId:actorId,toId:recipientId,phoneId:device.id,recipientPhoneId:receiver?.id??null,fromNumber:p.phoneNumber,toNumber:number,participants:[actorId,...(recipientId?[recipientId]:[])],threadId:conversationThread(s,actorId,recipientId,number),medium:'call',body:'',at:s.clock,sentAt:s.clock,deliveredAt:accepted?s.clock:null,receivedAt:accepted?s.clock:null,status:accepted?'delivered':'failed',callState:accepted?'ringing':'missed',endedAt:accepted?null:s.clock,sourceEventId:eventId,failureReason:failure},'owner');
   fact(s,call.id,'call-started',{fromId:actorId,toId:recipientId},eventId,recipientId&&accepted?[actorId,recipientId]:[actorId]);touchContact(device,recipientId,number,s.clock);
   if(p.batteryRequired)p.battery=Math.max(0,p.battery-1);device.data=p as Entity['data'];output(accepted?'The phone rings; no reply has been supplied.':'The call was not connected.');return 0;
  }
  case 'call-response':{
   phone(action.phoneId);const call=getEntity(s,action.messageId,'message'),m=data(call,'message');
   requireCondition(m.medium==='call'&&[m.fromId,m.toId].includes(actorId),'call_unavailable');
   requireCondition(action.phoneId===(actorId===m.fromId?m.phoneId:m.recipientPhoneId),'call_phone_mismatch');
   if(action.response==='end'){requireCondition(m.callState==='active'||m.callState==='ringing','call_not_active');m.callState='ended';m.endedAt=s.clock;}
   else{requireCondition(m.toId===actorId&&m.callState==='ringing','call_not_ringing');m.callState=action.response==='answer'?'active':'declined';if(m.callState==='active')m.answeredAt=s.clock;else m.endedAt=s.clock;}
   call.data=m as Entity['data'];fact(s,call.id,'call-status',m.callState,eventId,m.toId?[m.fromId,m.toId]:[m.fromId]);output('Call status: '+m.callState+'.');return 0;
  }
  case 'call-speak':{
   const device=phone(action.phoneId),call=getEntity(s,action.messageId,'message'),m=data(call,'message');
   requireCondition(m.callState==='active'&&[m.fromId,m.toId].includes(actorId),'call_not_active');
   const recipient=m.fromId===actorId?m.toId:m.fromId;requireCondition(recipient,'call_participant_unavailable');if(!recipient)throw new Error('call_participant_unavailable');
   const remotePhoneId=m.fromId===actorId?m.recipientPhoneId:m.phoneId;requireCondition(Boolean(remotePhoneId&&phonePowered(getEntity(s,remotePhoneId,'item'),true)),'recipient_disconnected');
   const utterance=getEntity(s,actorId,'character').name+': '+action.text;
   requireCondition(m.body.length+utterance.length+1<=16000,'call_transcript_limit');m.body+=(m.body?'\n':'')+utterance;call.data=m as Entity['data'];
   if(device.data.batteryRequired)device.data.battery=Math.max(0,Number(device.data.battery)-1);fact(s,call.id,'call-utterance',{speakerId:actorId,text:action.text},eventId,[actorId,recipient]);
   emit(effects,utterance,[actorId,recipient],'player.dialogue',actorId);return 1;
  }
  case 'leave-voicemail':{
   const device=phone(action.phoneId),p=data(device,'item'),call=getEntity(s,action.callId,'message'),prior=data(call,'message'),toId=prior.toId;requireCondition(prior.fromId===actorId&&['missed','declined','ended'].includes(String(prior.callState))&&toId,'voicemail_unavailable');if(!toId)throw new Error('voicemail_unavailable');
   const receiver=recipientPhone(s,toId,prior.toNumber,'voicemail');requireCondition(receiver&&data(receiver,'item').phoneApps.voicemail,'voicemail_unavailable');if(!receiver)throw new Error('voicemail_unavailable');const delay=communicationDelayMinutes(s,device,receiver),message=add(s,'message','Voicemail',{fromId:actorId,toId,phoneId:device.id,recipientPhoneId:receiver.id,fromNumber:p.phoneNumber,toNumber:prior.toNumber,participants:[actorId,toId],threadId:prior.threadId,medium:'voicemail',body:action.text,at:s.clock,sentAt:s.clock,availableAt:new Date(Date.parse(s.clock)+delay*60000).toISOString(),status:'sent',sourceEventId:eventId,replyToId:call.id},'owner');
   fact(s,message.id,'communication',{fromId:actorId,toId,medium:'voicemail'},eventId,[actorId]);if(p.batteryRequired)p.battery=Math.max(0,p.battery-1);device.data=p as Entity['data'];output('Voicemail queued for delivery.');return 0;
  }
  case 'delete-message':{
   phone(action.phoneId);const message=getEntity(s,action.messageId,'message'),m=data(message,'message');requireCondition([m.phoneId,m.recipientPhoneId].includes(action.phoneId)&&(action.operation==='restore'||visible(s,message,actorId)),'message_unavailable');
   if(action.operation==='restore'){m.deletedByIds=m.deletedByIds.filter(id=>id!==actorId);m.hiddenFromIds=m.hiddenFromIds.filter(id=>id!==actorId);}else if(action.operation==='delete'){if(!m.deletedByIds.includes(actorId))m.deletedByIds.push(actorId);}else if(!m.hiddenFromIds.includes(actorId))m.hiddenFromIds.push(actorId);
   message.data=m as Entity['data'];output(action.operation==='restore'?'Message restored.':'Message hidden from this phone view.');return 0;
  }
  case 'cook':{
   const recipe=getEntity(s,action.recipeId,'recipe'),r=data(recipe,'recipe');requireCondition(visible(s,recipe,actorId),'recipe_unknown');
   requireCondition(!r.locationId||r.locationId===pc.locationId,'recipe_location_required');
   const ingredients=r.inputs.map(input=>{const item=getEntity(s,input.itemId,'item'),d=data(item,'item');requireCondition(carriedBy(s,item,actorId)&&d.quantity>=input.quantity,'recipe_ingredients_required');return {item,input,d};});
   for(const {item,input,d}of ingredients)item.data.quantity=d.quantity-input.quantity;
   const cooked=add(s,'item',r.outputName,{category:r.outputCategory,ownerId:actorId,quantity:r.outputQuantity,dose:r.outputDose,weight:r.outputWeight,provenance:eventId},'owner');
   fact(s,cooked.id,'prepared',{recipeId:recipe.id,inputs:r.inputs},eventId,[actorId]);output(r.outputName+' prepared from the authored ingredients.');return r.minutes;
  }
  case 'hygiene':{
   requireCondition(s.settings.dailyLife,'configure_daily_life_rules_first');
   const place=pc.locationId?getEntity(s,pc.locationId,'location'):null;requireCondition(place,'location_required');
   const rule=s.settings.dailyLife!;
   requireCondition((place!.data.tags as string[]).includes(action.operation==='wash'?'washing-facilities':'laundry-facilities'),'facilities_required');
   if(action.operation==='wash'){if(needsEnabled(s))pc.hygiene=Math.min(100,pc.hygiene+rule.hygieneGain);}
   else{const item=getEntity(s,action.itemId??'','item');requireCondition(carriedBy(s,item,actorId)&&item.data.category==='clothing','clothing_required');item.data.dirty=Math.max(0,Number(item.data.dirty??0)-rule.hygieneGain);}
   output(action.operation==='wash'&&!needsEnabled(s)?'The routine is completed; daily-need meters are disabled for this campaign.':'The selected routine is completed.');return rule.minutes;
  }
  case 'pay-bail':{
   const file=getEntity(s,action.caseId,'case'),c=data(file,'case');
   requireCondition(c.suspectIds.includes(actorId)&&c.stage==='jail'&&c.bailAmountCents!==null,'bail_not_authorized');
   requireCondition(pc.cash>=c.bailAmountCents!,'insufficient_funds');const agency=getEntity(s,c.agencyId,'faction'),a=data(agency,'faction');
   pc.cash-=c.bailAmountCents!;a.treasuryCents+=c.bailAmountCents!;agency.data=a as Entity['data'];c.stage='bail';file.data=c as Entity['data'];pc.restrainedBy=null;
   fact(s,file.id,'bail-payment',{payerId:actorId,cents:c.bailAmountCents},eventId,[actorId,c.investigatorId]);output('The authored bail payment and release are recorded.');return 5;
  }
  case 'clinical-care':case 'forensic-test':{
   const service=getEntity(s,action.serviceId,'service'),rule=data(service,'service'),business=getEntity(s,rule.businessId,'business'),b=data(business,'business');
   requireCondition(visible(s,service,actorId)&&b.locationId===pc.locationId&&isOpen(b.hours,s,b.closedWeather),'service_unavailable');
   requireCondition(pc.cash>=rule.costCents,'insufficient_funds');
   if(action.type==='clinical-care'){
    requireCondition(rule.category==='clinical','wrong_service');const injury=getEntity(s,action.injuryId,'injury'),w=data(injury,'injury');
    requireCondition(w.characterId===actorId&&!w.permanent,'clinical_treatment_unavailable');
    requireCondition(rule.medicineId,'authored_medicine_required');const medicine=getEntity(s,rule.medicineId!,'item'),m=data(medicine,'item');
    requireCondition(m.category==='medicine'&&m.ownerId===business.id&&m.quantity>0,'clinic_supply_unavailable');
    requireCondition(rule.treatmentQuality>=w.treatmentRequirements.minimumQuality,'clinical_quality_insufficient');medicine.data.quantity=m.quantity-1;w.treated=true;w.stabilized=true;w.bleeding=0;w.infection=Math.max(0,w.infection-rule.severityReduction);w.severity=Math.max(0,w.severity-rule.severityReduction);w.course.status=w.severity===0?'resolved':'recovering';if(w.severity===0)w.course.resolvedAt=s.clock;w.treatments.push({id:crypto.randomUUID(),at:s.clock,eventId,providerId:actorId,method:'clinical',itemId:medicine.id,serviceId:service.id,quality:rule.treatmentQuality,outcome:w.severity===0?'improved':'stabilized',minutes:rule.minutes,note:service.name});if(!w.knownByIds.includes(actorId))w.knownByIds.push(actorId);if(!w.diagnosedByIds.includes(actorId))w.diagnosedByIds.push(actorId);w.assessments.push({id:crypto.randomUUID(),at:s.clock,eventId,assessorId:actorId,method:'clinical',severityBand:w.severity<25?'minor':w.severity<50?'moderate':w.severity<75?'serious':'critical',diagnosis:w.category+' · '+w.bodyPart,confidence:rule.treatmentQuality,sharedWithIds:[actorId]});injury.data=w as Entity['data'];
    if(w.severity===0)injury.archived=true;
    fact(s,injury.id,'clinical-treatment',{serviceId:service.id,costCents:rule.costCents},eventId,[actorId]);output('Authored clinical treatment completed; continuing recovery follows campaign rules.');
   }else{
    requireCondition(rule.category==='forensic','wrong_service');const evidence=getEntity(s,action.evidenceId,'evidence'),e=data(evidence,'evidence'),file=getEntity(s,action.caseId,'case'),c=data(file,'case');
    requireCondition(c.investigatorId===actorId&&c.evidenceIds.includes(evidence.id)&&e.caseId===file.id&&e.custodianId===actorId&&!e.destroyed,'forensic_authority_required');
    const finding=e.forensicFindings.find(f=>f.testName===rule.testName&&!f.completed);requireCondition(finding,'forensic_result_not_authored_or_completed');
    finding!.completed=true;evidence.data=e as Entity['data'];const result=(e.contaminated?'Contamination warning: ':'')+finding!.result;
    c.leads.push('Laboratory '+rule.testName+': '+result);file.data=c as Entity['data'];fact(s,evidence.id,'laboratory-report',{testName:rule.testName,result,contaminated:e.contaminated},eventId,[actorId]);output('Laboratory report recorded. It is evidence, not a finding of guilt.');
   }
   pc.cash-=rule.costCents;b.cash+=rule.costCents;business.data=b as Entity['data'];return rule.minutes;
  }
  default:throw new Error('unsupported_action');
 }
}
