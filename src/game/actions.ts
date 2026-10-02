import {randomUUID} from 'node:crypto';
import {data,getEntity} from './model.ts';
import type {Action,Entity,State} from './model.ts';
import {atLocation,add,advance,emit,isOpen,timeParts} from './simulation.ts';
import type {Effect} from './simulation.ts';
import {fact,observe,remember,visible} from './epistemics.ts';
import {randomSource} from '../random.ts';
import {choiceAccess,resolveTraitEffects} from './traits.ts';
import {selectedBackgrounds,skillStatus} from '../../public/creation-rules.js';
import {recordRelationshipHistory} from './social.ts';
import {cancelPendingConsent,effectiveContentMode,intimacyPresentation,isRomanceIntent,openConsentRequest,respondToConsentRequest} from './romance.ts';
import type {RomanceIntent} from './romance.ts';
import {communicationDelayMinutes,contactFor,conversationThread,phonePowered,recipientPhone,requirePhone,touchContact} from './phone.ts';
import {carriedBy,containedWeight,containerCapacity,evidenceForItem,itemDefinition,itemPossessor,itemUnitWeight,recordItemEvent,splitStack} from './items.ts';
import {applyBallisticProtection,compatibleAmmunition,compatibleMagazine,concealmentFor,consumeFirearmRound,loadMagazineFromAmmo,recordWeaponEvent,reloadFirearm} from './weapons.ts';
export type CheckOutcome='critical'|'partial'|'success'|'success-at-cost'|'failure-with-information'|'failure-with-consequence'|'impossible'|'no-roll';
export type CheckModifier={kind:'trait'|'injury'|'context'|'condition'|'equipment';name:string;value:number;sourceId?:string};
export type CheckRecord={id:string;eventId:string;characterId:string;checkDefinitionId:string|null;attribute:string;skillId:string|null;context:string;difficulty:number;dieValue:number|null;attributeValue:number;skillValue:number;total:number|null;outcome:CheckOutcome;modifiers:CheckModifier[];provenance:Record<string,unknown>};
import {extendedAction} from './extended-actions.ts';
import {damageVehicle,vehicleOperational,vehiclePenalty as vehiclePenaltyFor} from './vehicle.ts';
const requireRule=(s:State)=>{if(!s.settings.rules)throw new Error('configure_resolution_rules_first');return s.settings.rules;};
import {enforceActionPolicy,injuryRate} from './policy.ts';
const assert=(ok:unknown,code:string)=>{if(!ok)throw new Error(code);};
export function resolveAction(s:State,actorId:string,action:Action,eventId:string,seed:string){
 enforceActionPolicy(s,action);
 const actor=getEntity(s,actorId,'character');let pc=data(actor,'character');const effects:Effect[]=[];
 const rng=randomSource(seed);let minutes=0;let arrivalId:string|null=null;
 if(action.type==='content-filter'){pc.contentFilters={romance:action.romance,matureContent:action.matureContent,blockedIntents:[...new Set(action.blockedIntents)],allowNpcInitiative:action.allowNpcInitiative};actor.data=pc as Entity['data'];return {effects,draws:rng.draws,checks:[]};}
 if(action.type==='safety-exit'){cancelPendingConsent(s,actorId,action.targetId??null,eventId);actor.data=pc as Entity['data'];emit(effects,'The scene ends here. No relationship or narrative penalty is applied.',[actorId],'safety.exit',actorId);return {effects,draws:rng.draws,checks:[]};}
 assert(pc.condition==='conscious','character_cannot_act');
 assert(!pc.restrainedBy||['look','inspect','say','wait','surrender','pay-bail'].includes(action.type),'character_restrained');
 const choice=choiceAccess(s,actorId,action.type,action.type);assert(choice.allowed,'trait_choice_restricted');
 const say=(text:string,type:string=action.type,subjectId=actorId,observers=[actorId])=>emit(effects,text,observers,type,subjectId);
 const nearby=(target:Entity)=>{assert(target.data.locationId===pc.locationId&&pc.locationId&&visible(s,target,actorId),'target_not_present');};
 const owned=(id:string)=>{const item=getEntity(s,id,'item');assert(carriedBy(s,item,actorId)&&visible(s,item,actorId),'item_not_possessed');return item;};
 const moveWeaponParts=(weapon:Entity,possessorId:string|null,locationId:string|null,historyAction:'transferred'|'stolen'|'discarded'|'disarmed'|'recovered',fromId:string|null,toId:string|null,transferOwnership=false)=>{const w=data(weapon,'item');if(!['firearm','weapon'].includes(w.category))return;for(const id of [...new Set([...(w.installedMagazineId?[w.installedMagazineId]:[]),...w.attachmentIds])]){const part=getEntity(s,id,'item'),d=data(part,'item');d.possessorId=possessorId;d.locationId=locationId;d.containerId=null;if(transferOwnership&&toId)d.ownerId=toId;d.equipped=false;d.wearState='stowed';part.data=d as Entity['data'];recordItemEvent(s,part,eventId,historyAction,actorId,{fromId,toId,locationId,note:'Moved with weapon '+weapon.id+'.'});}};
 const carryAuthorized=(definition:ReturnType<typeof itemDefinition>)=>!definition||!['permit','concealed-permit'].includes(definition.legal.carry)||definition.legal.permitTags.every(tag=>pc.tags.includes(tag)||s.entities.some(entity=>entity.kind==='item'&&carriedBy(s,entity,actorId)&&(entity.data.tags as string[]).includes(tag)));
 const canCommunicate=(target:Entity)=>target.data.locationId===pc.locationId&&!!pc.locationId||s.entities.some(e=>e.kind==='item'&&carriedBy(s,e,actorId)&&phonePowered(e)&&(e.data.contacts as Array<{characterId:string|null;blocked?:boolean}>).some(c=>c.characterId===target.id&&!c.blocked));
 const checks:CheckRecord[]=[];
 const classify=(margin:number,bands:{criticalMargin:number;successAtCostMargin:number;partialFailureMargin:number;failureInformationMargin:number},mode:'legacy-binary'|'configured-bands'):CheckOutcome=>{
  if(mode==='legacy-binary')return margin>=0?'success':'failure-with-consequence';
  if(margin>=bands.criticalMargin)return 'critical';
  if(margin>=0)return margin<=bands.successAtCostMargin?'success-at-cost':'success';
  if(margin>=bands.partialFailureMargin)return 'partial';
  if(margin>=bands.failureInformationMargin)return 'failure-with-information';
  return 'failure-with-consequence';
 };
 const roll=(attribute:keyof typeof pc.attributes,skillId:string|null=null,difficulty?:number,checkId:string|null=null,context='')=>{
  const rule=requireRule(s),definition=checkId?getEntity(s,checkId,'checkDefinition'):null;
  if(definition)assert(visible(s,definition,actorId),'check_unavailable');
  const check=definition?data(definition,'checkDefinition'):null;
  const chosenAttribute=(check?.attribute??attribute) as keyof typeof pc.attributes,chosenSkill=check?.skillId??skillId;
  const target=Number(check?.difficulty??difficulty??rule.threshold),attributeValue=Number(pc.attributes[chosenAttribute]??0),skillValue=chosenSkill?Number(pc.skills[chosenSkill]??0):0,contextName=context||String(check?.context??'');
  const modifiers:CheckModifier[]=[];for(const background of selectedBackgrounds(pc)){const bonus=background.modifiers[chosenAttribute]??0;if(bonus)modifiers.push({kind:'context',name:'Background: '+background.name,value:bonus});}
  if(chosenSkill){const skill=getEntity(s,chosenSkill,'skill'),status=skillStatus(skill,skillValue);if(status.checkBonus)modifiers.push({kind:'context',name:'Skill: '+skill.name+' / Trained',value:status.checkBonus,sourceId:skill.id});}
  for(const traitId of pc.traits){
   const traitEntity=getEntity(s,traitId,'trait'),trait=data(traitEntity,'trait'),value=Number(trait.modifiers[chosenAttribute]??0);
   if(value)modifiers.push({kind:'trait',name:'Trait: '+traitEntity.name,value,sourceId:traitId});
   for(const scoped of trait.scopedCheckModifiers){
    if(scoped.attribute&&scoped.attribute!==chosenAttribute||scoped.skillId&&scoped.skillId!==chosenSkill||scoped.contexts.length&&!scoped.contexts.includes(contextName))continue;
    modifiers.push({kind:'trait',name:'Trait: '+traitEntity.name+' / '+scoped.name,value:scoped.value,sourceId:traitId});
   }
  }
  const authoredTraitEffects=resolveTraitEffects(s,actorId,'check-modifier',{attribute:String(chosenAttribute),skillId:chosenSkill,context:contextName});
  for(const effect of authoredTraitEffects.applied)if(effect.value)modifiers.push({kind:'trait',name:'Trait: '+effect.traitName+' / '+effect.effectName,value:effect.value,sourceId:effect.traitId});
  for(const injury of s.entities.filter(e=>e.kind==='injury'&&!e.archived&&e.data.characterId===actorId)){const value=Number(data(injury,'injury').modifiers[chosenAttribute]??0);if(value)modifiers.push({kind:'injury',name:'Condition: '+injury.name,value,sourceId:injury.id});}
  const contextValue=Number(check?.contextModifiers?.[contextName]??0);if(contextName&&contextValue)modifiers.push({kind:'context',name:'Context: '+contextName,value:contextValue});
  const conditionValue=Number(check?.conditionModifiers?.[pc.condition]??0);if(conditionValue)modifiers.push({kind:'condition',name:'Condition state: '+pc.condition,value:conditionValue});
  const requiredTraits=(check?.requiredTraits??[]) as string[],missingTrait=requiredTraits.find(id=>!pc.traits.includes(id));
  const equipmentTags=(check?.requiredEquipmentTags??[]) as string[],equippedTags=new Set(s.entities.filter(e=>e.kind==='item'&&!e.archived&&carriedBy(s,e,actorId)&&e.data.equipped).flatMap(e=>e.data.tags as string[])),missingEquipment=equipmentTags.find(tag=>!equippedTags.has(tag));
  const equipmentValue=missingTrait||missingEquipment?0:Number(check?.equipmentModifier??0);if(equipmentValue)modifiers.push({kind:'equipment',name:'Equipment: '+equipmentTags.join(', '),value:equipmentValue});
  const formula=(check?.formula??rule.formula) as 'additive-die'|'additive-no-die'|'authored-total',mode=(check?.outcomeMode??rule.outcomeMode) as 'legacy-binary'|'configured-bands',bands=check?.outcomeBands??rule.outcomeBands;
  let dieValue:number|null=null,total:number|null=null,outcome:CheckOutcome;
  let resolutionReason='authored-formula';
  if(missingTrait||missingEquipment){outcome='impossible';resolutionReason='missing-authored-requirement';}
  else if(check?.rollMode==='no-roll'){outcome='no-roll';resolutionReason='no-meaningful-uncertainty';}
  else if(formula==='authored-total'){outcome='no-roll';resolutionReason='authored-resolver-unavailable';}
  else{
   dieValue=formula==='additive-die'?rng.integer(rule.dieSides)+1:0;
   total=dieValue+attributeValue+skillValue+modifiers.reduce((sum,entry)=>sum+entry.value,0);
   outcome=classify(total-target,bands,mode);
  }
  const skillEntity=chosenSkill?s.entities.find(entity=>entity.id===chosenSkill&&entity.kind==='skill'):null;
  checks.push({id:randomUUID(),eventId,characterId:actorId,checkDefinitionId:checkId,attribute:String(chosenAttribute),skillId:chosenSkill,context:contextName,difficulty:target,dieValue,attributeValue,skillValue,total,outcome,modifiers,provenance:{formula,dieSides:formula==='additive-die'?rule.dieSides:null,outcomeMode:mode,outcomeBands:bands,margin:total===null?null:total-target,resolutionReason,attribute:{name:String(chosenAttribute),value:attributeValue},skill:skillEntity?{id:skillEntity.id,name:skillEntity.name,value:skillValue}:null,condition:pc.condition,traitEffectResolution:{applied:authoredTraitEffects.applied.map(effect=>({traitId:effect.traitId,effectId:effect.effectId,key:effect.key})),suppressed:authoredTraitEffects.suppressed.map(effect=>({traitId:effect.traitId,effectId:effect.effectId,key:effect.key}))},requiredTraits,equipmentTags,missingRequirements:[...(missingTrait?[{kind:'trait',id:missingTrait}]:[]),...(missingEquipment?[{kind:'equipment',tag:missingEquipment}]:[])]}});
  say(outcome==='impossible'?'Check impossible: authored requirement not met.':outcome==='no-roll'?'No roll: authored rule provided no uncertainty.':'Check: '+String(total)+' against '+target+'. Outcome: '+outcome+'.','check');
  return ['critical','success','success-at-cost'].includes(outcome);
 };
 const activeCombat=()=>s.entities.find(e=>e.kind==='combat'&&!e.archived&&e.data.active&&(e.data.participants as string[]).includes(actorId));
 const combatTurn=()=>{const combat=activeCombat();assert(combat,'combat_not_active');const d=data(combat!,'combat');assert(d.participants[d.turnIndex]===actorId,'not_your_turn');return combat!;};
 if(activeCombat()&&!['look','inspect','say','surrender'].includes(action.type)){
  assert(['attack','defend','grapple','restrain','disarm','shove','flee','reload','load-magazine','clear-malfunction','cover','consume','treat','tactical-move'].includes(action.type),'use_combat_action_or_flee');
  combatTurn();
 }
 const hurt=(target:Entity,amount:number,category:'gunshot'|'blunt',part:string,evidenceIds:string[]=[])=>{
  const scaled=Math.max(0,amount*injuryRate(s));
  const wounds=add(s,'injury',category+' injury',{characterId:target.id,bodyPart:part,category,severity:scaled,pain:scaled,bleeding:category==='gunshot'?scaled/10:0,startedAt:s.clock},'owner');
  const witnesses=atLocation(s,pc.locationId).map(e=>e.id);
  fact(s,target.id,'injury',{injuryId:wounds.id,category,bodyPart:part},eventId,witnesses,{evidenceIds});
  const td=data(target,'character');if(scaled>=100){td.condition='unconscious';target.data=td as Entity['data'];}
 };
 switch(action.type){
 case 'look':{
  const place=pc.locationId?getEntity(s,pc.locationId,'location'):null;
  say(place?place.name+(place.data.description?'\n\n'+place.data.description:''):'No starting location is authored. Choose one in Creator.');
  if(place)for(const e of s.entities.filter(e=>!e.archived&&e.data.locationId===place.id&&e.id!==actorId&&e.visibility!=='creator'&&!e.data.concealed)){
   const id=fact(s,e.id,'observed',true,eventId,[actorId]);observe(s,actorId,id,'look');
   if(e.kind==='character'||e.kind==='vehicle'||e.kind==='item')say(e.name+' is present.','observation',e.id);
  }
  break;
 }
 case 'inspect':{
  const target=getEntity(s,action.targetId);assert(visible(s,target,actorId),'target_not_observable');
  if('locationId'in target.data&&target.data.locationId!==null&&target.data.locationId!==pc.locationId&&target.data.ownerId!==actorId)throw new Error('target_not_present');
  const description=typeof target.data.description==='string'&&target.data.description.trim()?target.data.description.trim():'No further visible detail is authored.';
  say(`${target.name}\n\n${description}`,'inspection',target.id);fact(s,target.id,'inspected',true,eventId,[actorId]);minutes=1;break;
 }
 case 'wait': minutes=action.minutes;say('Time passes.');break;
 case 'sleep':minutes=action.minutes;pc.fatigue=Math.max(0,pc.fatigue-action.minutes/6);say('The rest interval passes.');break;
 case 'say':say(action.text,'player.dialogue',actorId,atLocation(s,pc.locationId).map(e=>e.id));minutes=1;break;
 case 'travel':case 'flee':{
  assert(pc.locationId,'starting_location_required');
  if(action.type==='flee')combatTurn();
  const location=data(getEntity(s,pc.locationId!,'location'),'location'),destination=getEntity(s,action.destinationId,'location');
  assert(visible(s,destination,actorId)||data(destination,'location').discoverable,'destination_unknown');
  const mode=action.type==='travel'?action.mode:'walk';
  const abstraction=action.type==='flee'?'exact':s.settings.campaign?.travelAbstraction??'route',exit=location.exits.find(e=>e.to===destination.id&&e.modes.includes(mode));
  if(abstraction!=='abstract')assert(exit,'route_unavailable');
  if(exit?.locked)assert(exit.keyId&&s.entities.some(e=>e.id===exit.keyId&&e.kind==='item'&&carriedBy(s,e,actorId)),'route_locked');
  assert(isOpen(data(destination,'location').hours,s),'destination_closed');
  assert(!data(destination,'location').closedDates.includes(timeParts(s.clock,s.settings.timezone).date),'destination_closed');
  const fare=exit?.fare??0;assert(pc.cash>=fare,'insufficient_funds');
  const interruption=exit?.interruption&&(!exit.interruption.whenWeather||exit.interruption.whenWeather===s.settings.weather)?exit.interruption:null;
  const arrival=interruption?getEntity(s,interruption.locationId,'location'):destination,travelMinutes=interruption?.afterMinutes??exit?.minutes??30;
  if(action.type==='flee'&&!roll('Agility')){say('The escape attempt fails.');minutes=1;break;}
  pc.cash-=fare;
  if(mode==='drive'){
   const vehicle=getEntity(s,action.type==='travel'?action.vehicleId??'':'','vehicle'),d=data(vehicle,'vehicle');nearby(vehicle);
   assert(d.ownerId===actorId||d.keyId&&s.entities.some(e=>e.id===d.keyId&&e.kind==='item'&&carriedBy(s,e,actorId)),'vehicle_access_denied');
   assert(vehicleOperational(d),'vehicle_disabled');if(s.settings.fuel){assert(d.fuel>=travelMinutes/10,'insufficient_fuel');d.fuel-=travelMinutes/10;}
   assert(d.occupants.every(id=>id===actorId||!getEntity(s,id,'character').data.playable),'passenger_consent_required');
   for(const id of d.occupants)getEntity(s,id,'character').data.locationId=arrival.id;
   d.locationId=arrival.id;vehicle.data=d as Entity['data'];
  }
  arrivalId=arrival.id;pc.locationId=null;minutes=travelMinutes;
  if(interruption?.questId)getEntity(s,interruption.questId,'quest').data.status='active';
  say((interruption?'Travel interrupted at: ':'Arrival: ')+arrival.name+'.','travel',arrival.id);
  const combat=activeCombat();if(combat)combat.data.active=false;break;
 }
 case 'take':{
  const item=getEntity(s,action.itemId,'item'),d=data(item,'item');assert(!itemPossessor(s,item)&&!d.containerId,'item_not_available');nearby(item);
  assert(!d.concealed||d.discoveredByIds.includes(actorId),'item_not_discovered');const former=d.locationId;d.possessorId=actorId;if(!d.ownerId)d.ownerId=actorId;d.locationId=null;d.wearState='held';if(['firearm','weapon'].includes(d.category))d.carryState='held';item.data=d as Entity['data'];const recovered=['firearm','weapon'].includes(d.category);recordItemEvent(s,item,eventId,recovered?'recovered':'acquired',actorId,{fromId:former,toId:actorId,locationId:former,note:recovered?'Weapon physically recovered.':''});if(recovered)moveWeaponParts(item,actorId,null,'recovered',former,actorId);say(item.name+' added to inventory.',recovered?'weapon.recovered':'take',item.id);minutes=1;break;
 }
 case 'give':{const item=owned(action.itemId),target=getEntity(s,action.toId,'character');nearby(target);assert(target.id!==actorId,'invalid_target');const d=data(item,'item');d.ownerId=target.id;d.possessorId=target.id;d.equipped=false;d.wearState='stowed';d.carryState='stored';item.data=d as Entity['data'];recordItemEvent(s,item,eventId,'transferred',actorId,{fromId:actorId,toId:target.id});moveWeaponParts(item,target.id,null,'transferred',actorId,target.id,true);say(item.name+' transferred to '+target.name+'.');minutes=1;break;}
 case 'steal':{
  const target=getEntity(s,action.targetId,'character'),item=getEntity(s,action.itemId,'item');nearby(target);
  assert(itemPossessor(s,item)===target.id&&visible(s,item,actorId),'item_not_observable');
  if(roll('Agility')){const d=data(item,'item');d.possessorId=actorId;d.stolen=true;d.equipped=false;d.wearState='held';d.carryState='held';item.data=d as Entity['data'];recordItemEvent(s,item,eventId,'stolen',actorId,{fromId:target.id,toId:actorId});moveWeaponParts(item,actorId,null,'stolen',target.id,actorId);say(item.name+' changes possession. Legal ownership remains recorded.');}
  else{fact(s,actorId,'attempted-theft',{itemId:item.id,targetId:target.id},eventId,atLocation(s,pc.locationId).map(e=>e.id));say('The attempted theft is noticed.');}
  minutes=1;break;
 }
 case 'cover':{
  const combat=combatTurn();assert(pc.locationId,'starting_location_required');const protection=data(getEntity(s,pc.locationId!,'location'),'location').cover;
  assert(protection>0,'no_authored_cover');(combat.data.cover as Record<string,number>)[actorId]=protection;say('Available cover is used.');break;
 }
 case 'equip':{const item=owned(action.itemId),d=data(item,'item'),definition=itemDefinition(s,item);if(action.equipped){assert(!definition||definition.legal.carry!=='prohibited','item_carry_prohibited');assert(carryAuthorized(definition),'item_carry_permit_required');}d.equipped=action.equipped;d.wearState=action.equipped?'equipped':'stowed';if(['firearm','weapon'].includes(d.category))d.carryState=action.equipped?'held':'stored';item.data=d as Entity['data'];recordItemEvent(s,item,eventId,'equipped',actorId,{note:action.equipped?'equipped':'unequipped'});say(item.name+(action.equipped?' equipped.':' unequipped.'));break;}
 case 'wear-item':{const item=owned(action.itemId),d=data(item,'item'),definition=itemDefinition(s,item);assert(['clothing','jewelry','armor'].includes(d.category),'item_not_wearable');if(action.worn){assert(!definition||definition.legal.carry!=='prohibited','item_carry_prohibited');assert(carryAuthorized(definition),'item_carry_permit_required');}d.equipped=action.worn;d.wearState=action.worn?'worn':'stowed';item.data=d as Entity['data'];recordItemEvent(s,item,eventId,'worn',actorId,{note:action.worn?'worn':'removed'});say(item.name+(action.worn?' worn.':' removed.'));minutes=1;break;}
 case 'conceal':{const item=owned(action.itemId),d=data(item,'item'),definition=itemDefinition(s,item);if(action.concealed){assert(!definition||!['open-only','prohibited'].includes(definition.legal.carry),'concealed_carry_prohibited');assert(carryAuthorized(definition),'item_carry_permit_required');const contextId=action.contextId??(!['firearm','weapon'].includes(d.category)?actorId:null);assert(contextId,'concealment_context_required');d.concealment=concealmentFor(s,actorId,item,contextId!);d.concealmentContextId=contextId;}else{d.concealment=0;d.concealmentContextId=null;}d.concealed=action.concealed;if(['firearm','weapon'].includes(d.category))d.carryState=action.concealed?'holstered':d.equipped?'held':'stored';item.data=d as Entity['data'];recordItemEvent(s,item,eventId,'concealed',actorId,{containerId:d.concealmentContextId,note:action.concealed?'concealed in physical context':'revealed'});say(item.name+(action.concealed?' concealed.':' made visible.'));minutes=1;break;}
 case 'store':case 'retrieve':{
  const container=getEntity(s,action.containerId);assert(['item','vehicle'].includes(container.kind),'container_unavailable');
  const vehicle=container.kind==='vehicle'?data(container,'vehicle'):null,c=container.kind==='item'?data(container,'item'):null;
  assert(vehicle?!vehicle.locked:c?.category==='container'&&!c.locked,'container_unavailable');
  const owner=vehicle?.ownerId??(container.kind==='item'?(itemPossessor(s,container)??c?.ownerId):null),location=vehicle?.locationId??c?.locationId,capacity=containerCapacity(s,container);
  assert(visible(s,container,actorId)&&(vehicle?location===pc.locationId&&pc.locationId&&(owner===actorId||vehicle.keyId&&s.entities.some(e=>e.id===vehicle.keyId&&e.kind==='item'&&carriedBy(s,e,actorId))):owner===actorId||location===pc.locationId&&pc.locationId),'container_access_denied');
  const item=getEntity(s,action.itemId,'item'),d=data(item,'item');assert(item.id!==container.id,'containment_cycle');
  if(action.type==='store'){owned(item.id);let parent:Entity|null=container;while(parent?.kind==='item'&&parent.data.containerId){assert(parent.data.containerId!==item.id,'containment_cycle');parent=s.entities.find(entity=>entity.id===parent!.data.containerId&&!entity.archived)??null;}assert(containedWeight(s,container.id)+itemUnitWeight(s,item)*d.quantity<=capacity,'container_capacity');d.possessorId=null;d.locationId=null;d.containerId=container.id;d.equipped=false;d.wearState='stowed';}
  else{assert(d.containerId===container.id&&visible(s,item,actorId),'item_not_in_container');d.containerId=null;d.possessorId=actorId;}
  item.data=d as Entity['data'];recordItemEvent(s,item,eventId,action.type==='store'?'stored':'retrieved',actorId,{containerId:container.id});say(item.name+(action.type==='store'?' stored.':' retrieved.'));minutes=1;break;
 }
 case 'examine-item':{const item=getEntity(s,action.itemId,'item');assert(visible(s,item,actorId),'item_not_observable');const d=data(item,'item'),physical=carriedBy(s,item,actorId)||d.discoveredByIds.includes(actorId)||!d.concealed;const details=[d.description||'No authored description.',d.markings.length?'Markings: '+d.markings.join(', '):'',d.modifications.length?'Modifications: '+d.modifications.map(entry=>entry.name).join(', '):'',physical&&d.secretContents?'Contents: '+d.secretContents:''].filter(Boolean).join('\n');say(item.name+'\n\n'+details,'inspection',item.id);fact(s,item.id,'examined',true,eventId,[actorId]);minutes=1;break;}
 case 'split-stack':{const item=owned(action.itemId);assert(!evidenceForItem(s,item.id).length,'evidence_stack_cannot_split');const created=splitStack(s,item,action.quantity,eventId,actorId);say(created.name+' split into a separate stack of '+action.quantity+'.');minutes=1;break;}
 case 'transfer-item':{let item=owned(action.itemId);const target=getEntity(s,action.toId,'character');nearby(target);assert(target.id!==actorId,'invalid_target');const d=data(item,'item'),quantity=action.quantity??d.quantity;assert(quantity>0&&quantity<=d.quantity,'invalid_transfer_quantity');if(quantity<d.quantity){assert(!evidenceForItem(s,item.id).length,'evidence_stack_cannot_split');item=splitStack(s,item,quantity,eventId,actorId);}const moved=data(item,'item');moved.possessorId=target.id;if(action.transferOwnership!==false)moved.ownerId=target.id;moved.equipped=false;moved.wearState='stowed';moved.carryState='stored';moved.concealed=false;moved.concealment=0;moved.concealmentContextId=null;item.data=moved as Entity['data'];recordItemEvent(s,item,eventId,'transferred',actorId,{fromId:actorId,toId:target.id,quantity});moveWeaponParts(item,target.id,null,'transferred',actorId,target.id,action.transferOwnership!==false);say(quantity+' '+item.name+' transferred to '+target.name+'.');minutes=1;break;}
 case 'discard-item':{let item=owned(action.itemId);if(!pc.locationId)throw new Error('starting_location_required');const locationId=pc.locationId,d=data(item,'item'),quantity=action.quantity??d.quantity;assert(quantity>0&&quantity<=d.quantity,'invalid_discard_quantity');assert(!evidenceForItem(s,item.id).some(entry=>entry.custodianId===actorId&&!entry.destroyed),'evidence_custody_transfer_required');if(quantity<d.quantity)item=splitStack(s,item,quantity,eventId,actorId);const moved=data(item,'item');moved.possessorId=null;moved.locationId=locationId;moved.containerId=null;moved.equipped=false;moved.wearState='stowed';moved.carryState='stored';moved.concealed=false;moved.concealment=0;moved.concealmentContextId=null;item.data=moved as Entity['data'];recordItemEvent(s,item,eventId,'discarded',actorId,{fromId:actorId,locationId,quantity});moveWeaponParts(item,null,locationId,'discarded',actorId,null);say(item.name+' left at '+getEntity(s,locationId,'location').name+'.');minutes=1;break;}
 case 'reload':{
  const weapon=owned(action.weaponId),source=owned(action.ammoId??action.magazineId!),w=data(weapon,'item'),sourceData=data(source,'item');assert(w.category==='firearm','weapon_unavailable');
  if(sourceData.category==='ammo')assert(compatibleAmmunition(w,sourceData),'incompatible_ammunition');else assert(compatibleMagazine(w,sourceData),'incompatible_magazine');
  const result=reloadFirearm(s,weapon,source);recordWeaponEvent(s,weapon,eventId,'loaded',actorId,result.magazineId?'Magazine '+result.magazineId+' installed; '+result.count+' loose rounds loaded.':result.count+' loose rounds loaded.',result.count);
  if(result.replaced&&result.replaced!==source.id){const removed=getEntity(s,result.replaced,'item');recordItemEvent(s,removed,eventId,'unloaded',actorId,{fromId:weapon.id,toId:actorId,quantity:data(removed,'item').loaded,note:'Magazine removed from '+weapon.id+'.'});}
  recordItemEvent(s,source,eventId,'loaded',actorId,{toId:weapon.id,quantity:result.count,note:sourceData.category==='magazine'?'Installed in '+weapon.id:result.count+' rounds transferred to '+weapon.id});
  say(sourceData.category==='magazine'?'Magazine installed.':result.count+' rounds loaded.','weapon.reload',weapon.id);minutes=1;break;
 }
 case 'load-magazine':{const magazine=owned(action.magazineId),ammo=owned(action.ammoId),count=loadMagazineFromAmmo(s,magazine,ammo,action.quantity);recordItemEvent(s,magazine,eventId,'loaded',actorId,{fromId:ammo.id,quantity:count,note:count+' rounds loaded into magazine.'});recordItemEvent(s,ammo,eventId,'loaded',actorId,{toId:magazine.id,quantity:count,note:count+' rounds transferred into magazine.'});say(count+' rounds loaded into '+magazine.name+'.','weapon.reload',magazine.id);minutes=1;break;}
 case 'clear-malfunction':{const weapon=owned(action.weaponId),w=data(weapon,'item');assert(w.category==='firearm'&&w.malfunction!=='broken','weapon_unavailable');assert(w.malfunction!=='none','weapon_not_malfunctioning');const cleared=w.malfunction;w.malfunction='none';weapon.data=w as Entity['data'];recordWeaponEvent(s,weapon,eventId,'maintained',actorId,'Cleared '+cleared+'.');say('The '+cleared+' malfunction is cleared.','weapon.maintained',weapon.id);minutes=1;break;}
 case 'maintain-weapon':{const weapon=owned(action.weaponId),w=data(weapon,'item');assert(['firearm','weapon'].includes(w.category),'weapon_unavailable');if(action.maintenanceItemId){const kit=owned(action.maintenanceItemId);assert((data(kit,'item').tags).includes('weapon-maintenance'),'maintenance_item_required');}w.malfunction='none';w.lastMaintainedAt=s.clock;w.shotsSinceMaintenance=0;weapon.data=w as Entity['data'];recordWeaponEvent(s,weapon,eventId,'maintained',actorId,'Routine weapon maintenance.');say(weapon.name+' maintained.','weapon.maintained',weapon.id);minutes=10;break;}
 case 'attach-weapon':{const weapon=owned(action.weaponId),attachment=owned(action.attachmentId),w=data(weapon,'item');assert(['firearm','weapon'].includes(w.category)&&(data(attachment,'item').tags).includes('weapon-attachment'),'invalid_weapon_attachment');if(action.attached){if(!w.attachmentIds.includes(attachment.id))w.attachmentIds.push(attachment.id);}else w.attachmentIds=w.attachmentIds.filter(id=>id!==attachment.id);weapon.data=w as Entity['data'];recordWeaponEvent(s,weapon,eventId,'modified',actorId,(action.attached?'Attached ':'Detached ')+attachment.name+'.');say(attachment.name+(action.attached?' attached.':' detached.'),'weapon.modified',weapon.id);minutes=1;break;}
 case 'consume':{
  const item=owned(action.itemId),d=data(item,'item');assert(d.quantity>0&&['food','drink','substance','medicine'].includes(d.category),'not_consumable');
  if(d.category==='food')pc.hunger=Math.max(0,pc.hunger-d.dose);
  if(d.category==='drink')pc.thirst=Math.max(0,pc.thirst-d.dose);
  if(d.category==='substance'){pc.lastDoseAt=s.clock;pc.withdrawal=0;pc.intoxication=Math.min(100,pc.intoxication+d.dose);if(pc.intoxication===100)add(s,'injury','Substance reaction',{characterId:actorId,bodyPart:'systemic',category:'overdose',severity:100,startedAt:s.clock},'owner');}
  d.quantity--;item.data=d as Entity['data'];say(item.name+' consumed.');minutes=1;break;
 }
 case 'treat':{
  const rule=requireRule(s),injury=getEntity(s,action.injuryId,'injury'),w=data(injury,'injury'),patient=getEntity(s,w.characterId,'character'),medicine=owned(action.medicineId),m=data(medicine,'item');
  assert(patient.id===actorId||patient.data.locationId===pc.locationId,'patient_not_present');assert(patient.data.condition!=='dead','death_is_persistent');
  assert(m.category==='medicine'&&m.quantity>0,'medicine_required');m.quantity--;w.treated=true;w.bleeding=0;injury.data=w as Entity['data'];medicine.data=m as Entity['data'];
  say('Treatment applied; recovery requires time.');minutes=rule.treatmentMinutes;break;
 }
 case 'add-contact':{
  const phone=requirePhone(s,action.phoneId,actorId),p=data(phone,'item'),target=getEntity(s,action.contactId,'character');
  assert(!p.contacts.some(contact=>contact.characterId===target.id),'contact_already_exists');
  const known=s.facts.find(row=>(!action.factId||row.id===action.factId)&&row.subjectId===target.id&&['phone-number','phone-number-shared'].includes(row.predicate)&&s.knowledge.some(record=>record.observerId===actorId&&record.factId===row.id)),value=known?.value as {number?:unknown;source?:unknown}|string|undefined,number=typeof value==='string'?value:typeof value?.number==='string'?value.number:'';
  assert(known&&number,'phone_number_unknown');const source=typeof value==='object'&&value&&typeof value.source==='string'&&['exchange','discovery','document','known-contact','creator'].includes(value.source)?value.source:'discovery',relationship=s.entities.find(entity=>entity.kind==='relationship'&&!entity.archived&&((entity.data.fromId===actorId&&entity.data.toId===target.id)||(entity.data.toId===actorId&&entity.data.fromId===target.id)));
  p.contacts.push({characterId:target.id,label:action.label,savedName:action.label,number,alias:action.alias??'',source:source as 'exchange'|'discovery'|'document'|'known-contact'|'creator',sourceEntityId:known?.objectId&&s.entities.some(entity=>entity.id===known.objectId)?known.objectId:null,consentPrivacy:source==='exchange'?'shared':source==='creator'?'private':'discovered',relationshipId:relationship?.id??null,createdAt:s.clock,lastInteractionAt:null,blocked:false,favorite:false,permissions:{calls:true,sms:true,mms:true,email:true,social:false}});phone.data=p as Entity['data'];
  say('Contact added: '+action.label+'.');break;
 }
 case 'share-number':{
  const phone=requirePhone(s,action.phoneId,actorId),p=data(phone,'item'),target=getEntity(s,action.toId,'character');nearby(target);assert(target.id!==actorId&&p.phoneNumber,'phone_number_unavailable');
  fact(s,actorId,'phone-number-shared',{number:p.phoneNumber,source:'exchange'},eventId,[actorId,target.id]);say('You explicitly share your phone number with '+target.name+'.');minutes=1;break;
 }
 case 'contact-control':{
  const phone=requirePhone(s,action.phoneId,actorId),p=data(phone,'item'),index=p.contacts.findIndex(contact=>contact.characterId===action.contactId);assert(index>=0,'contact_unknown');
  if(action.operation==='delete')p.contacts.splice(index,1);else{const contact=p.contacts[index]!;if(action.operation==='block')contact.blocked=true;if(action.operation==='unblock')contact.blocked=false;if(action.operation==='favorite')contact.favorite=true;if(action.operation==='unfavorite')contact.favorite=false;}
  phone.data=p as Entity['data'];say('Contact updated.');break;
 }
 case 'conversation':{
  const target=getEntity(s,action.targetId,'character');nearby(target);assert(target.id!==actorId,'invalid_target');
  say(action.text);minutes=1;break;
 }
 case 'message':{
  const phone=requirePhone(s,action.phoneId,actorId),p=data(phone,'item'),contact=contactFor(phone,action.toId,action.number);assert(action.number||contact,'contact_unknown');assert(!contact?.blocked,'contact_blocked');assert(!contact||contact.permissions[action.medium],'contact_permission_denied');
  const attachments=action.attachments??[];
  if(action.medium==='sms'){assert(action.text.length<=s.settings.communications.smsCharacterLimit,'sms_length_limit');assert(!attachments.length,'sms_attachments_unavailable');}
  if(action.medium==='mms')assert(attachments.length<=s.settings.communications.mmsAttachmentLimit,'mms_attachment_limit');
  if(action.medium==='email')assert(p.phoneApps.email,'email_unavailable');
  for(const attachmentId of attachments){const attachment=getEntity(s,attachmentId,'media');assert(visible(s,attachment,actorId),'attachment_unavailable');}
  const number=action.number||contact?.number||'',targetId=action.toId??contact?.characterId??null,target=targetId?getEntity(s,targetId,'character'):null,receiver=recipientPhone(s,targetId,number,action.medium),landline=targetId&&s.entities.some(entity=>entity.kind==='item'&&!entity.archived&&entity.data.category==='phone'&&entity.data.ownerId===targetId&&entity.data.phoneType==='landline'),failure=!receiver&&!targetId?'wrong-number':!receiver&&landline&&['sms','mms'].includes(action.medium)?'landline_cannot_receive_sms':'';
  const delay=communicationDelayMinutes(s,phone,receiver),message=add(s,'message',action.medium.toUpperCase(),{fromId:actorId,toId:targetId,phoneId:phone.id,recipientPhoneId:receiver?.id??null,fromNumber:p.phoneNumber,toNumber:number,participants:[actorId,...(targetId?[targetId]:[])],threadId:conversationThread(s,actorId,targetId,number),medium:action.medium,body:action.text,at:s.clock,sentAt:s.clock,availableAt:failure?null:new Date(Date.parse(s.clock)+delay*60000).toISOString(),status:failure?'failed':receiver?'sent':'queued',attachments,sourceEventId:eventId,failureReason:failure},'owner');
  fact(s,message.id,'communication',{fromId:actorId,toId:targetId,medium:action.medium},eventId,[actorId]);touchContact(phone,targetId,number,s.clock);
  if(p.batteryRequired)p.battery=Math.max(0,p.battery-1);phone.data=p as Entity['data'];say(failure?'Message failed: '+failure.replaceAll('-',' ')+'.':action.medium.toUpperCase()+' queued for delivery.');break;
 }
 case 'buy':case 'sell':{
  const business=getEntity(s,action.businessId,'business'),b=data(business,'business');assert(b.locationId===pc.locationId&&isOpen(b.hours,s),'business_closed_or_unreachable');
  const item=getEntity(s,action.itemId,'item'),d=data(item,'item'),price=Math.round(d.price*b.priceMultiplier);
  assert(d.quantity>0,'out_of_stock');assert(!d.stolen||b.contraband,'merchant_refuses_stolen_goods');
  if(action.type==='buy'){assert(b.stock.includes(item.id)&&d.ownerId===business.id,'out_of_stock');const payment=action.payment??'cash';if(payment==='bank')assert(s.entities.some(e=>e.kind==='item'&&carriedBy(s,e,actorId)&&(e.data.tags as string[]).includes('payment-card')),'payment_card_required');assert(pc[payment]>=price,'insufficient_funds');pc[payment]-=price;b.cash+=price;b.stock=b.stock.filter(id=>id!==item.id);d.ownerId=actorId;d.possessorId=actorId;}
  else{assert(carriedBy(s,item,actorId)&&d.ownerId===actorId,'item_not_owned');assert(b.cash>=price,'merchant_insufficient_funds');b.cash-=price;pc.cash+=price;b.stock.push(item.id);d.ownerId=business.id;d.possessorId=null;d.equipped=false;d.wearState='stowed';}
  assert(Number.isSafeInteger(pc.cash)&&Number.isSafeInteger(b.cash),'money_overflow');business.data=b as Entity['data'];item.data=d as Entity['data'];
  recordItemEvent(s,item,eventId,action.type==='buy'?'acquired':'transferred',actorId,{fromId:action.type==='buy'?business.id:actorId,toId:action.type==='buy'?actorId:business.id});
  fact(s,item.id,'transaction',{businessId:business.id,priceCents:price,operation:action.type},eventId,[actorId]);say('Receipt: '+item.name+', $'+(price/100).toFixed(2)+'.');minutes=1;break;
 }
 case 'bank':{
  const business=getEntity(s,action.businessId,'business'),b=data(business,'business');
  assert(b.tags.includes('bank')&&b.locationId===pc.locationId&&isOpen(b.hours,s),'bank_unavailable');
  if(action.operation==='deposit'){assert(pc.cash>=action.cents,'insufficient_funds');pc.cash-=action.cents;pc.bank+=action.cents;}
  else{assert(pc.bank>=action.cents,'insufficient_funds');pc.bank-=action.cents;pc.cash+=action.cents;}
  fact(s,actorId,'bank-transaction',{operation:action.operation,cents:action.cents},eventId,[actorId]);say('Bank transaction recorded.');minutes=5;break;
 }
 case 'work':{
  const job=getEntity(s,action.jobId,'job'),j=data(job,'job');assert(j.employeeId===actorId&&j.locationId===pc.locationId,'shift_unavailable');
  assert(!j.lastWorked||Date.parse(s.clock)>=Date.parse(j.lastWorked)+j.minutesPerShift*60000,'shift_already_worked');
  const employer=getEntity(s,j.employerId,'business'),b=data(employer,'business'),pay=Math.floor(j.hourlyCents*j.minutesPerShift/60);
  assert(isOpen(b.hours,s)&&b.cash>=pay,'employer_unavailable');pc.cash+=pay;b.cash-=pay;j.lastWorked=s.clock;job.data=j as Entity['data'];employer.data=b as Entity['data'];minutes=j.minutesPerShift;say('Shift completed. Wages: $'+(pay/100).toFixed(2)+'.');break;
 }
 case 'pay-rent':{
  const housing=getEntity(s,action.housingId,'housing'),h=data(housing,'housing');assert(h.tenantId===actorId&&pc.cash>=h.rentCents,'rent_unavailable');
  const landlord=getEntity(s,h.landlordId);assert(['character','business'].includes(landlord.kind),'invalid_landlord');
  pc.cash-=h.rentCents;landlord.data.cash=Number(landlord.data.cash)+h.rentCents;h.dueAt=new Date(Date.parse(h.dueAt)+h.periodDays*86400000).toISOString();h.access=true;housing.data=h as Entity['data'];say('Rent payment recorded.');break;
 }
 case 'social':{
  const target=getEntity(s,action.targetId,'character');nearby(target);assert(target.id!==actorId,'invalid_target');
  const romantic=isRomanceIntent(action.intent),response=action.response??'accept';
  assert(!pc.boundaries.includes(action.intent)&&!(target.data.boundaries as string[]).includes(action.intent),'boundary_declined');
  if(action.intent==='decline'){cancelPendingConsent(s,actorId,target.id,eventId);say('The advance is declined. No penalty is applied.','social.decline');break;}
  if(action.intent==='breakup'){for(const relation of s.entities.filter(e=>e.kind==='relationship'&&!e.archived&&((e.data.fromId===target.id&&e.data.toId===actorId)||(e.data.fromId===actorId&&e.data.toId===target.id)))){const r=data(relation,'relationship');r.labels=r.labels.filter(label=>!['date','commit','exclusive','cohabit','marry','lover','intimacy'].includes(label));for(const label of r.labelRecords)if(['romantic','lover','affair','poly'].includes(label.category)&&label.status==='active'){label.status='ended';label.endedAt=s.clock;}r.exclusivityStatus='none';relation.data=r as Entity['data'];recordRelationshipHistory(s,relation,eventId,'breakup','label',actorId,'private');}say('The relationship is ended.','social.breakup');minutes=5;break;}
  if(romantic){
   const intent=action.intent as RomanceIntent;
   if(response==='propose'){
    let relation=s.entities.find(e=>e.kind==='relationship'&&!e.archived&&e.data.fromId===actorId&&e.data.toId===target.id);if(!relation)relation=add(s,'relationship',actor.name+' → '+target.name,{fromId:actorId,toId:target.id,secret:false,disclosure:'private',knownByIds:[actorId,target.id]},'owner');
    const request=openConsentRequest(s,relation,intent,actorId,target.id);recordRelationshipHistory(s,relation,eventId,'Proposed '+intent,'label',actorId,'private');say('You present the '+intent+' advance. '+target.name+' retains the choice to respond.','social.proposal',relation.id);relation.data=data(relation,'relationship') as Entity['data'];minutes=5;break;
   }
   assert(action.consent||response!=='accept','explicit_consent_required');assert(action.consentRequestId,'current_consent_request_required');
   const relation=s.entities.find(e=>e.kind==='relationship'&&!e.archived&&data(e,'relationship').consentRequests.some(request=>request.id===action.consentRequestId));assert(relation,'current_consent_request_required');
   const request=respondToConsentRequest(s,relation!,action.consentRequestId!,actorId,intent,eventId,response,action.consent);
   if(request.status==='accepted'){const r=data(relation!,'relationship');r.labels=[...new Set([...r.labels,action.intent])];if(action.intent==='exclusive')r.exclusivityStatus='exclusive';if(!r.labelRecords.some(label=>label.label===action.intent&&label.status==='active'))r.labelRecords.push({id:randomUUID(),label:action.intent,category:'romantic',disclosure:'private',knownByIds:[target.id,actorId],status:'active',sourceEventId:eventId,at:s.clock,endedAt:null});relation!.data=r as Entity['data'];recordRelationshipHistory(s,relation!,eventId,'Accepted '+action.intent,'label',actorId,'private');say(action.intent==='intimacy'?intimacyPresentation(effectiveContentMode(s,actorId)):'You accept the '+action.intent+' advance.','social.accepted',relation!.id);}
   else say(response==='withdraw'?'The advance is withdrawn without penalty.':'The advance is declined without penalty.','social.decline',relation!.id);minutes=5;break;
  }
  let relation=s.entities.find(e=>e.kind==='relationship'&&!e.archived&&e.data.fromId===target.id&&e.data.toId===actorId);
  if(!relation)relation=add(s,'relationship',target.name+' → '+actor.name,{fromId:target.id,toId:actorId,secret:false,disclosure:'private',knownByIds:[target.id,actorId]},'campaign');
  recordRelationshipHistory(s,relation,eventId,action.intent,'routine',target.id,'private');
  // Never assign an emotion or a relationship meter to the player.
  say('Interaction recorded: '+action.intent+'.');minutes=5;break;
 }
 case 'share':{
  const target=getEntity(s,action.targetId,'character');nearby(target);assert(s.knowledge.some(k=>k.observerId===actorId&&k.factId===action.factId),'fact_unknown');
  observe(s,target.id,action.factId,'told-by:'+actorId+':'+eventId);say('Information shared with '+target.name+'.');minutes=1;break;
 }
 case 'check':roll(action.attribute,action.skillId,undefined,action.checkId,action.context);break;
 case 'train':{
  const targetSkill=action.skillId?getEntity(s,action.skillId,'skill'):null,targetDefinition=targetSkill?data(targetSkill,'skill'):null;
  const attribute=action.attribute,trainingConfig=targetDefinition?.training??{minutesPerPoint:s.settings.advancement.attributeMinutesPerPoint,practiceMinutesPerPoint:0,costCentsPerHour:s.settings.advancement.attributeCostCentsPerHour,trainerRequired:false,requiresMilestone:false};
  if(targetSkill){assert(targetSkill.visibility!=='creator'&&visible(s,targetSkill,actorId),'skill_unavailable');for(const prerequisite of targetDefinition!.prerequisites)assert(Number(pc.skills[prerequisite]??0)>0,'skill_prerequisite_required');}
  if(attribute)assert(!targetSkill,'training_target_required');
  const existing=pc.training.find(t=>t.skillId===(targetSkill?.id??null)&&t.attribute===attribute&&t.status==='active');
  const trainer=action.trainerId?getEntity(s,action.trainerId,'character'):null;
  if(trainer){assert(trainer.id!==actorId&&trainer.data.locationId===pc.locationId&&visible(s,trainer,actorId),'trainer_unavailable');}
  if(trainingConfig.trainerRequired&&action.mode==='instruction')assert(trainer,'trainer_required');
  if(trainingConfig.trainerRequired&&!existing&&!trainer)assert(false,'trainer_required');
  const source=action.source.trim()||trainer?.name||existing?.source||(action.mode==='practice'?'Self-directed practice':'Self-directed study');
  const record=existing??{id:randomUUID(),skillId:targetSkill?.id??null,attribute:attribute??null,trainerId:trainer?.id??null,source,startedAt:s.clock,minutesInvested:0,requiredMinutes:trainingConfig.minutesPerPoint,practiceMinutes:0,requiredPracticeMinutes:trainingConfig.practiceMinutesPerPoint,costPaidCents:0,requiredCostCents:Math.ceil(trainingConfig.minutesPerPoint*trainingConfig.costCentsPerHour/60),milestoneReached:false,status:'active',completedAt:null,notes:''};
  if(!existing)pc.training.push(record);
  if(trainer&&!record.trainerId)record.trainerId=trainer.id;if(action.milestoneReached)record.milestoneReached=true;
  const cost=action.mode==='instruction'?Math.ceil(action.minutes*trainingConfig.costCentsPerHour/60):0;assert(pc.cash>=cost,'insufficient_training_funds');pc.cash-=cost;record.costPaidCents+=cost;
  if(action.mode==='practice')record.practiceMinutes+=action.minutes;else record.minutesInvested+=action.minutes;
  const current=targetSkill?Number(pc.skills[targetSkill.id]??0):Number(pc.attributes[attribute!]??0),scale=targetSkill?targetDefinition!.scale:s.settings.attributeScale,maximum=scale.max;
  assert(current<maximum,'training_target_at_maximum');
  const complete=record.minutesInvested>=record.requiredMinutes&&record.practiceMinutes>=record.requiredPracticeMinutes&&record.costPaidCents>=record.requiredCostCents&&(!trainingConfig.requiresMilestone||record.milestoneReached);
  if(complete){const next=Math.min(maximum,current+scale.step);if(targetSkill)pc.skills[targetSkill.id]=next;else pc.attributes[attribute!]=next;record.status='completed';record.completedAt=s.clock;say((targetSkill?.name??attribute)+' advanced to '+next+'.');}
  else say((targetSkill?.name??attribute)+' training recorded; instruction '+record.minutesInvested+'/'+record.requiredMinutes+' minutes, practice '+record.practiceMinutes+'/'+record.requiredPracticeMinutes+' minutes'+(trainingConfig.requiresMilestone&&!record.milestoneReached?', milestone pending':'')+'.');
  minutes=action.minutes;break;
 } case 'combat':{
  requireRule(s);const target=getEntity(s,action.targetId,'character');nearby(target);assert(target.id!==actorId&&!activeCombat(),'combat_unavailable');
  const order=[actor,target].sort((a,b)=>Number(b.data.attributes&& (b.data.attributes as Record<string,number>).Agility)-Number(a.data.attributes&&(a.data.attributes as Record<string,number>).Agility)||a.id.localeCompare(b.id));
  add(s,'combat','Conflict',{participants:order.map(e=>e.id)},'campaign');say('Conflict begins. Initiative is recorded.');break;
 }
 case 'tactical-move':{const combat=combatTurn(),c=data(combat,'combat');assert(s.settings.tactics&&c.positions[actorId]!==undefined,'configure_tactical_movement_first');assert(Math.abs(action.position-c.positions[actorId]!)<=s.settings.tactics!.movementMeters,'movement_out_of_range');c.positions[actorId]=action.position;combat.data=c as Entity['data'];say('Tactical position updated.');minutes=1;break;}
 case 'attack':{
  const rule=requireRule(s),combat=combatTurn(),target=getEntity(s,action.targetId,'character');nearby(target);assert((combat.data.participants as string[]).includes(target.id)&&target.id!==actorId,'invalid_combat_target');
  const tactical=data(combat,'combat');
  assert(!tactical.blockedLines.some(line=>line.fromId===actorId&&line.toId===target.id||line.fromId===target.id&&line.toId===actorId),'line_of_fire_blocked');
  let category:'gunshot'|'blunt'='blunt',skillId:string|null=null,penalty=0,shotEvidenceId:string|null=null;
  if(action.weaponId){const weapon=owned(action.weaponId),w=data(weapon,'item');assert(['weapon','firearm'].includes(w.category)&&w.condition>0,'weapon_unavailable');
   if(w.rangeMeters!==null){assert(tactical.positions[actorId]!==undefined&&tactical.positions[target.id]!==undefined,'tactical_positions_required');assert(Math.abs(tactical.positions[actorId]!-tactical.positions[target.id]!)<=w.rangeMeters,'target_out_of_range');}
   if(w.category==='firearm'){
    if(w.malfunction!=='none'){recordWeaponEvent(s,weapon,eventId,'malfunction',actorId,'Trigger attempt blocked by '+w.malfunction+'.');say('The firearm cannot fire: '+w.malfunction+'.','weapon.malfunction',weapon.id);delete tactical.defenses[target.id];combat.data=tactical as Entity['data'];minutes=1;break;}
    const malfunctionChance=Math.min(100,s.settings.weapons.malfunctionBasePercent+(100-w.condition)*s.settings.weapons.conditionMalfunctionFactor);
    if(malfunctionChance>0&&rng.integer(100)<malfunctionChance){w.malfunction='jammed';weapon.data=w as Entity['data'];recordWeaponEvent(s,weapon,eventId,'malfunction',actorId,'Condition-based firing malfunction.');say('The firearm malfunctions before a shot is emitted.','weapon.malfunction',weapon.id);delete tactical.defenses[target.id];combat.data=tactical as Entity['data'];minutes=1;break;}
    const round=consumeFirearmRound(s,weapon);if(!round.fired){recordWeaponEvent(s,weapon,eventId,'empty-click',actorId,'Trigger pulled with no chambered or available round.',0);say('The firearm produces an empty click; no shot is emitted.','weapon.empty-click',weapon.id);delete tactical.defenses[target.id];combat.data=tactical as Entity['data'];minutes=1;break;}
    const current=data(weapon,'item');current.shotsSinceMaintenance++;current.condition=Math.max(0,current.condition-s.settings.weapons.conditionLossPerShot);weapon.data=current as Entity['data'];category='gunshot';recordWeaponEvent(s,weapon,eventId,'shot',actorId,'Fired '+(round.ammoType||'authored ammunition')+'.');
    const casing=add(s,'evidence','Spent '+(round.ammoType||current.caliber||'firearm')+' casing',{description:'Casing emitted by firearm '+weapon.id+'.',tags:['firearm-discharge',round.ammoType||current.caliber].filter(Boolean),locationId:pc.locationId,objectId:weapon.id,sourceEventId:eventId},'knowledge');shotEvidenceId=casing.id;
    const witnesses=atLocation(s,pc.locationId).map(entity=>entity.id);emit(effects,weapon.name+' fires one '+(round.ammoType||current.caliber||'authored')+' round.',witnesses,'weapon.shot',weapon.id);
   }
   const family=w.weaponFamily||w.proficiency,skill=s.entities.find(e=>e.kind==='skill'&&e.name===family);skillId=skill?.id??null;if(!skillId||!pc.skills[skillId])penalty=rule.unfamiliarPenalty;
  }
  const c=data(combat,'combat'),cover=c.cover[target.id]??0,defense=c.defenses[target.id]?2:0;
  if(roll(category==='gunshot'?'Perception':'Strength',skillId,rule.threshold+cover+defense+penalty)){
   const result=category==='gunshot'?applyBallisticProtection(s,target.id,action.bodyPart,rule.damage):{armor:[] as Entity[],protection:0,absorbed:0,damage:rule.damage,formula:'unprotected-blunt'};
   for(const armor of result.armor)recordItemEvent(s,armor,eventId,'damaged',actorId,{quantity:1,note:'Absorbed '+result.absorbed+' configured damage at '+action.bodyPart+'.'});
   if(result.damage>0){hurt(target,result.damage,category,action.bodyPart,shotEvidenceId?[shotEvidenceId]:[]);say('The attack causes an externally visible injury.','injury',target.id);}else say('Covered protection absorbs this impact and loses condition.','armor.impact',target.id);
  }else say('The attack does not connect.');
  delete c.defenses[target.id];combat.data=c as Entity['data'];minutes=1;break;
 }
 case 'defend':{const combat=combatTurn();(combat.data.defenses as Record<string,string>)[actorId]=action.defense;say('Defensive stance: '+action.defense+'.');break;}
 case 'grapple':case 'restrain':case 'shove':case 'disarm':{
  combatTurn();const target=getEntity(s,action.targetId,'character');nearby(target);assert(target.id!==actorId,'invalid_target');
  if(action.type==='restrain'){const item=owned(action.itemId);assert((item.data.tags as string[]).includes('restraint'),'restraint_item_required');}
  if(roll('Strength')){
   if(action.type==='grapple'||action.type==='restrain')target.data.restrainedBy=actorId;
   if(action.type==='shove')target.data.fatigue=Math.min(100,Number(target.data.fatigue)+5);
   if(action.type==='disarm'){const weapon=s.entities.find(e=>e.kind==='item'&&itemPossessor(s,e)===target.id&&e.data.equipped&&['firearm','weapon'].includes(String(e.data.category)));if(weapon){weapon.data.possessorId=null;weapon.data.locationId=pc.locationId;weapon.data.equipped=false;weapon.data.wearState='stowed';weapon.data.carryState='stored';weapon.data.concealed=false;weapon.data.concealment=0;weapon.data.concealmentContextId=null;recordItemEvent(s,weapon,eventId,'disarmed',actorId,{fromId:target.id,locationId:pc.locationId,note:'Weapon mechanically disarmed.'});moveWeaponParts(weapon,null,pc.locationId,'disarmed',target.id,null);say(weapon.name+' is disarmed and falls at the scene.','weapon.disarmed',weapon.id);}}
   if(action.type!=='disarm')say(action.type+' succeeds.');
  }minutes=1;break;
 }
 case 'surrender':{const combat=activeCombat();assert(combat,'combat_not_active');combat!.data.active=false;say('Surrender offered.');break;}
 case 'chase':{
  requireRule(s);const target=getEntity(s,action.targetId,'character');nearby(target);assert(!target.data.playable,'other_player_action_required');
  assert(pc.locationId,'starting_location_required');const location=data(getEntity(s,pc.locationId!,'location'),'location');
  const route=location.exits.find(e=>e.to===action.destinationId&&!e.locked&&e.modes.includes(action.vehicleId?'drive':'walk'));
  assert(route,'route_unavailable');const destination=getEntity(s,action.destinationId,'location');assert(visible(s,destination,actorId),'destination_unknown');
  if(action.vehicleId){const vehicle=getEntity(s,action.vehicleId,'vehicle'),v=data(vehicle,'vehicle');nearby(vehicle);assert(v.ownerId===actorId&&vehicleOperational(v),'vehicle_access_denied');if(s.settings.fuel){assert(v.fuel>=route!.minutes/10,'insufficient_fuel');v.fuel-=route!.minutes/10;}v.locationId=destination.id;vehicle.data=v as Entity['data'];}
  const driving=s.entities.find(e=>e.kind==='skill'&&e.name.toLowerCase()==='driving');
  const vehiclePenalty=action.vehicleId?vehiclePenaltyFor(data(getEntity(s,action.vehicleId,'vehicle'),'vehicle')):0;
  const success=roll(action.vehicleId?'Perception':'Agility',action.vehicleId?driving?.id??null:null,requireRule(s).threshold+route!.terrainPenalty+(action.vehicleId?route!.trafficPenalty+vehiclePenalty:0));
  if(action.vehicleId){const vehicle=getEntity(s,action.vehicleId,'vehicle'),v=data(vehicle,'vehicle');assert(v.occupants.every(id=>id===actorId||!getEntity(s,id,'character').data.playable),'passenger_consent_required');for(const id of v.occupants)if(id!==actorId)getEntity(s,id,'character').data.locationId=destination.id;if(!success&&s.settings.tactics){const damaged=damageVehicle(v,s.settings.tactics.failedChaseVehicleDamage,rng);vehicle.data=v as Entity['data'];say(damaged?'Vehicle damage recorded: '+damaged+'.':'Vehicle condition worsened.','vehicle.damage',vehicle.id);}}
  arrivalId=destination.id;pc.locationId=null;target.data.locationId=destination.id;minutes=route!.minutes;
  if(success)target.data.fatigue=Math.min(100,Number(target.data.fatigue)+10);
  say(success?'The pursuit closes the distance.':'The pursued character maintains separation.');fact(s,target.id,'chase',{pursuerId:actorId,closed:success},eventId,atLocation(s,destination.id).map(e=>e.id));break;
 }
 case 'search':{
  assert(pc.locationId,'starting_location_required');
  const method=action.method??'visual',target=action.targetId?getEntity(s,action.targetId):getEntity(s,pc.locationId!,'location'),requestedMinutes=action.minutes??5;
  assert(['location','character','item','vehicle'].includes(target.kind),'invalid_search_target');
  if(target.kind==='location')assert(target.id===pc.locationId,'search_target_not_present');
  if(target.kind==='character'){if(target.id!==actorId)nearby(target);}
  if(['item','vehicle'].includes(target.kind)){assert(visible(s,target,actorId),'search_target_not_observable');if(target.kind==='item')assert(data(target,'item').category==='container','search_target_not_container');}
  const risky=target.kind==='character'&&target.id!==actorId||target.kind==='item'&&itemPossessor(s,target)!==actorId&&data(target,'item').ownerId!==actorId||target.kind==='vehicle'&&data(target,'vehicle').ownerId!==actorId;
  assert(!risky||action.acceptRisk===true,'search_risk_confirmation_required');
  const physicallyWithin=(entity:Entity)=>target.kind==='location'?entity.data.locationId===target.id:target.kind==='character'?entity.kind==='item'&&itemPossessor(s,entity)===target.id:entity.data.containerId===target.id;
  const searchSkill=s.entities.find(entity=>entity.kind==='skill'&&!entity.archived&&entity.name.toLowerCase()==='search'),skill=searchSkill?Number(pc.skills[searchSkill.id]??0):0,knowledge=s.knowledge.some(row=>row.observerId===actorId&&s.facts.some(entry=>entry.id===row.factId&&entry.subjectId===target.id))?10:0;
  const methodBonus={visual:-20,'pat-down':5,thorough:20,forensic:35}[method],ability=Number(pc.attributes.Perception??0)+skill+knowledge+Math.min(30,requestedMinutes),limit=Math.max(1,Math.floor(requestedMinutes/(method==='visual'?5:method==='pat-down'?3:2)));let found=0;
  if(target.kind==='location')for(const exit of data(target,'location').exits){if(found>=limit)break;const destination=getEntity(s,exit.to,'location');if(destination.data.discoverable&&destination.visibility!=='creator'&&ability+methodBonus+rng.integer(100)>=60){fact(s,destination.id,'discovered',true,eventId,[actorId],{source:'physical-search'});say('Route discovered: '+destination.name+'.','discovery',destination.id);found++;}}
  const candidates=s.entities.filter(entity=>!entity.archived&&entity.visibility!=='creator'&&physicallyWithin(entity)&&(entity.kind==='item'||entity.kind==='evidence'));
  for(const entity of candidates){if(found>=limit)break;
   if(entity.kind==='item'){const d=data(entity,'item');if(!d.concealed||d.discoveredByIds.includes(actorId))continue;const concealment=Math.max(d.concealment,d.concealed?25:0);if(ability+methodBonus+rng.integer(100)<50+concealment)continue;d.discoveredByIds.push(actorId);entity.data=d as Entity['data'];recordItemEvent(s,entity,eventId,'discovered',actorId,{locationId:pc.locationId,note:method+' search'});fact(s,entity.id,'discovered',{targetId:target.id,method},eventId,[actorId],{source:'physical-search'});say('Found: '+entity.name+'.','discovery',entity.id);found++;continue;}
   const d=data(entity,'evidence');if(d.destroyed||d.discoveredBy.includes(actorId))continue;const obscured=Boolean(entity.data.concealed),obscurity=obscured?50:0;if(obscured&&ability+methodBonus+rng.integer(100)<50+obscurity)continue;d.discoveredBy.push(actorId);entity.data=d as Entity['data'];fact(s,entity.id,'discovered',{targetId:target.id,method},eventId,[actorId],{source:'physical-search',evidenceIds:[entity.id]});say('Discovered evidence: '+entity.name+'.','discovery',entity.id);found++;
  }
  if(!found)say('The search finds nothing further under the chosen method and time.','search.result',target.id);
  if(risky)fact(s,actorId,'risky-search',{targetId:target.id,method},eventId,atLocation(s,pc.locationId).filter(entity=>entity.id!==actorId).map(entity=>entity.id),{source:'physical-search'});
  minutes=requestedMinutes;break;
 }
 case 'crime':{
  const law=getEntity(s,action.lawId,'law'),l=data(law,'law');assert(pc.locationId&&l.jurisdictionIds.includes(pc.locationId),'jurisdiction_not_authored');
  if(action.targetId)nearby(getEntity(s,action.targetId));
  const witnesses=atLocation(s,pc.locationId).map(e=>e.id);fact(s,actorId,'alleged-act',{lawId:law.id,targetId:action.targetId},eventId,witnesses);
  say('The declared act is recorded. Only witnesses acquire knowledge.');minutes=1;break;
 }
 case 'report':{
  assert(s.knowledge.some(k=>k.observerId===actorId&&k.factId===action.factId),'fact_unknown');
  const agency=getEntity(s,action.agencyId,'faction'),officer=getEntity(s,action.investigatorId,'character');
  assert((agency.data.memberIds as string[]).includes(officer.id),'investigator_not_in_agency');
  assert(canCommunicate(officer),'report_communication_required');
  observe(s,officer.id,action.factId,'report:'+actorId);
  const f=s.facts.find(f=>f.id===action.factId)!;
  add(s,'case','Report',{agencyId:agency.id,investigatorId:officer.id,suspectIds:[f.subjectId],leads:['Report from '+actor.name]},'knowledge');
  const subject=s.entities.find(e=>e.id===f.subjectId&&e.kind==='character');if(subject){const heat=subject.id===actorId?pc.heat:subject.data.heat as Record<string,number>;heat[agency.id]=Math.min(100,(heat[agency.id]??0)+1);}
  say('Report received; it is a lead, not a finding of guilt.');minutes=5;break;
 }
 case 'report-belief':{
  const belief=s.beliefs.find(b=>b.id===action.beliefId&&b.observerId===actorId);assert(belief,'belief_unknown');
  const target=getEntity(s,action.targetId,'character');assert(visible(s,target,actorId),'target_unknown');
  const agency=getEntity(s,action.agencyId,'faction'),officer=getEntity(s,action.investigatorId,'character');
  assert((agency.data.memberIds as string[]).includes(officer.id),'investigator_not_in_agency');
  assert(canCommunicate(officer),'report_communication_required');
  s.beliefs.push({id:randomUUID(),observerId:officer.id,proposition:belief!.proposition,confidence:Math.min(0.5,belief!.confidence),source:'unverified-report:'+actorId,at:s.clock,correctedBy:null});
  add(s,'case','Unverified report',{agencyId:agency.id,investigatorId:officer.id,suspectIds:[target.id],leads:['Unverified allegation: '+belief!.proposition]},'knowledge');
  say('An unverified allegation is recorded separately from world truth.');minutes=5;break;
 }
 case 'collect':{
  const evidence=getEntity(s,action.evidenceId,'evidence'),d=data(evidence,'evidence'),file=getEntity(s,action.caseId,'case'),c=data(file,'case');
  assert(c.investigatorId===actorId&&d.discoveredBy.includes(actorId)&&d.locationId===pc.locationId&&!d.destroyed,'evidence_access_denied');
  d.custody.push({at:s.clock,fromId:d.custodianId,toId:actorId,eventId,reason:'collected'});d.custodianId=actorId;d.caseId=file.id;d.locationId=null;
  if(!c.evidenceIds.includes(evidence.id))c.evidenceIds.push(evidence.id);evidence.data=d as Entity['data'];file.data=c as Entity['data'];say('Evidence collected; custody recorded.');minutes=5;break;
 }
 case 'custody':{
  const evidence=getEntity(s,action.evidenceId,'evidence'),d=data(evidence,'evidence'),target=getEntity(s,action.toId,'character');nearby(target);
  assert(d.custodianId===actorId&&!d.destroyed,'custody_authority_required');
  d.custody.push({at:s.clock,fromId:actorId,toId:target.id,eventId,reason:action.reason});d.custodianId=target.id;
  if(!d.discoveredBy.includes(target.id))d.discoveredBy.push(target.id);evidence.data=d as Entity['data'];say('Custody transfer recorded.');minutes=1;break;
 }
 case 'case':{
  const file=getEntity(s,action.caseId,'case'),c=data(file,'case');assert(c.investigatorId===actorId,'investigator_required');
  const agency=data(getEntity(s,c.agencyId,'faction'),'faction');assert(pc.locationId&&agency.jurisdictionIds.includes(pc.locationId),'outside_jurisdiction');
  if(['search','arrest','charge','sentence'].includes(action.operation)){
   const permission=action.operation==='charge'?'charge':action.operation==='sentence'?'sentence':action.operation;
   const laws=c.lawIds.map(id=>data(getEntity(s,id,'law'),'law')).filter(l=>l.agencyIds.includes(c.agencyId)&&l.jurisdictionIds.includes(pc.locationId!)&&l.permits.includes(permission as never));
   assert(laws.length,'legal_authority_not_authored');
   if(action.operation==='search')assert(action.targetId&&laws.some(l=>!l.requiresWarrant||c.warrantLocationIds.includes(action.targetId!)),'warrant_required');
   if(action.operation==='arrest'){assert(action.targetId&&c.suspectIds.includes(action.targetId),'suspect_required');const target=getEntity(s,action.targetId!,'character');nearby(target);target.data.restrainedBy=actorId;}
  }
  // Warrants are Creator-authored legal decisions; an officer cannot self-issue one.
  assert(action.operation!=='warrant','creator_judicial_authorization_required');
  assert(action.operation!=='bail','use_authorized_bail_payment');
  const allowed:Record<string,string[]>={investigate:['reported','investigating'],search:['investigating','warrant'],arrest:['investigating','warrant'],booking:['arrest'],jail:['booking'],bail:['jail'],interrogation:['arrest','booking','jail','bail','interrogation'],charge:['investigating','interrogation','jail','bail'],trial:['charged'],sentence:['trial'],probation:['sentenced'],parole:['sentenced'],close:['reported','investigating','warrant','charged','trial','sentenced','probation','parole']};
  assert(allowed[action.operation]?.includes(c.stage),'illegal_case_transition');
  if(action.operation==='charge')assert(c.evidenceIds.length>0,'supporting_evidence_required');
  if(action.operation==='search')say('The authored legal search is permitted. Physical discovery still requires a search action.');
  const stages:Record<string,string>={investigate:'investigating',arrest:'arrest',booking:'booking',jail:'jail',bail:'bail',interrogation:'interrogation',charge:'charged',trial:'trial',sentence:'sentenced',probation:'probation',parole:'parole',close:'closed'};
  if(stages[action.operation])c.stage=stages[action.operation] as typeof c.stage;
  file.data=c as Entity['data'];say('Case action recorded: '+action.operation+'.');minutes=5;break;
 }
 default:minutes=extendedAction(s,actorId,pc,action,eventId,effects);
 }
 actor.data=pc as Entity['data'];
 if(minutes>0)advance(s,minutes,eventId,effects,actorId);
 if(arrivalId){actor.data.locationId=arrivalId;fact(s,arrivalId,'visited',true,eventId,[actorId]);}
 // Non-player initiative is deterministic; it never supplies an action for a playable character.
 const combat=activeCombat();
 if(combat&&['combat','attack','defend','grapple','restrain','disarm','shove','reload','cover','consume','treat','say','flee','tactical-move'].includes(action.type)){
  const c=data(combat,'combat');if(action.type!=='combat'){c.turnIndex=(c.turnIndex+1)%c.participants.length;if(c.turnIndex===0)c.round++;}
  let steps=0;
  while(steps++<c.participants.length){
   const next=getEntity(s,c.participants[c.turnIndex]!,'character');if(next.data.playable)break;
   if(next.data.condition==='conscious'){
    if((next.data.goals as string[]).includes('attack')&&s.settings.rules){
     const rule=s.settings.rules,hit=rng.integer(rule.dieSides)+1+Number((next.data.attributes as Record<string,number>).Strength)>=rule.threshold+(c.defenses[actorId]?2:0);
     if(hit)hurt(actor,rule.damage,'blunt','torso');
     emit(effects,next.name+(hit?' strikes, causing an injury.':' attacks without connecting.'),[actorId],'npc.attack',next.id);
    }else{c.defenses[next.id]='dodge';emit(effects,next.name+' holds a defensive position.',[actorId],'npc.defend',next.id);}
   }
   c.turnIndex=(c.turnIndex+1)%c.participants.length;if(c.turnIndex===0)c.round++;
  }combat.data=c as Entity['data'];
 }
 for(const effect of effects)for(const observer of effect.observers)remember(s,observer,effect.text,eventId,0.5);
 return {effects,draws:rng.draws,checks};
}
