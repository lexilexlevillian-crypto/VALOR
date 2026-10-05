import {createHash} from 'node:crypto';
import {data,getEntity,type Action,type Entity,type State} from './model.ts';
import {carriedBy,itemUnitWeight,recordItemEvent,containedWeight,containerCapacity} from './items.ts';
import {visible,fact} from './epistemics.ts';
import {vehicleHasPermission} from './vehicle.ts';
import {recordCrime} from './law.ts';
type PhysicalAction=Extract<Action,{type:'physical'}>;
type Services={check:(attribute:'Strength'|'Agility'|'Perception',difficulty:number,context:string)=>boolean;say:(text:string,type?:string,subjectId?:string,observers?:string[])=>void};
const requireValue=(value:unknown,code:string)=>{if(!value)throw new Error(code);};
export function physicalInteraction(s:State,actorId:string,a:PhysicalAction,eventId:string,services:Services){
 const actor=getEntity(s,actorId,'character'),pc=data(actor,'character'),target=getEntity(s,a.targetId);
 requireValue(visible(s,target,actorId),'target_unavailable');
 requireValue(target.data.locationId===pc.locationId||target.id===pc.locationId||target.kind==='item'&&carriedBy(s,target,actorId),'target_not_present');
 const observers=s.entities.filter(e=>e.kind==='character'&&!e.archived&&e.data.locationId===pc.locationId&&e.data.condition==='conscious').map(e=>e.id);
 const item=target.kind==='item'?data(target,'item'):null,mechanism=item?.mechanism;
 const instrument=a.instrumentId?getEntity(s,a.instrumentId,'item'):null;
 if(instrument)requireValue(carriedBy(s,instrument,actorId),'item_not_possessed');
 const say=(text:string,type='physical.result')=>services.say(text,type,target.id,[actorId]);
 let minutes=mechanism?.minutes??1,success=true,noisy=false;
 if(['open','close','unlock','lockpick','force'].includes(a.operation)){
  requireValue(item&&mechanism&&['door','window','container'].includes(mechanism.kind),'object_has_no_opening');
  if(mechanism!.obstructedById&&a.operation!=='close'){say(target.name+' is obstructed.','physical.blocked');return {minutes:0,status:'FAILED' as const};}
  if(a.operation==='close'){mechanism!.open=false;say(target.name+' closed.');}
  else {
   const signature=createHash('sha256').update(JSON.stringify([a.operation,a.instrumentId,item!.locked,item!.condition,pc.attributes,pc.skills,pc.condition,mechanism!.forceDifficulty,mechanism!.lockDifficulty])).digest('hex');
   const repeated=mechanism!.attempts.find(r=>r.actorId===actorId&&r.signature===signature&&!r.success);
   if(a.operation==='unlock'){
    requireValue(instrument&&mechanism!.keyId===instrument.id,'matching_key_required');item!.locked=false;
   }else if(a.operation==='lockpick'){
    requireValue(instrument&&(instrument.data.tags as string[]).includes('lockpick'),'lockpick_required');
    if(item!.locked)success=repeated?false:services.check('Agility',mechanism!.lockDifficulty,'lockpicking');
    const tool=data(instrument!,'item');requireValue(tool.condition>0,'tool_broken');tool.condition=Math.max(0,tool.condition-mechanism!.toolWear);instrument!.data=tool as Entity['data'];
    if(success)item!.locked=false;
   }else if(a.operation==='force'){
    success=repeated?false:services.check('Strength',mechanism!.forceDifficulty,'forcing an opening');
    noisy=true;if(success){item!.locked=false;item!.condition=Math.max(0,item!.condition-mechanism!.forceDamage);}
   }else if(item!.locked){success=false;say(target.name+' is locked.','physical.blocked');}
   if(['lockpick','force'].includes(a.operation))mechanism!.attempts.push({actorId,signature,success,eventId,at:s.clock});
   if(mechanism!.attempts.length>100)mechanism!.attempts.splice(0,mechanism!.attempts.length-100);
   if(success){if(a.operation==='open'||a.operation==='force')mechanism!.open=true;say(target.name+(a.operation==='unlock'||a.operation==='lockpick'?' unlocked.':' opened.'),'object.opened');}
   else if(a.operation!=='open')say(repeated?'The unchanged approach makes no further progress.':target.name+' stays closed.','physical.failed');
  }
  target.data=item as Entity['data'];
  if(success&&mechanism?.destinationId){
   const place=getEntity(s,pc.locationId!,'location'),d=data(place,'location'),exit=d.exits.find(e=>e.to===mechanism.destinationId);
   if(exit)exit.locked=item!.locked||!mechanism.open;
   place.data=d as Entity['data'];
   if(mechanism.open){const destination=getEntity(s,mechanism.destinationId,'location');fact(s,destination.id,'opening-visible',true,eventId,[actorId]);const threats=s.entities.filter(e=>e.kind==='character'&&!e.archived&&e.data.locationId===destination.id&&(e.data.tags as string[]).includes('immediate-threat'));
    for(const threat of threats)fact(s,threat.id,'observed',true,eventId,[actorId]);
    if(threats.length)services.say('An armed person is visible beyond the opening. You can react.','turn.interrupted',target.id,[actorId]);
   }
  }
 }else if(a.operation==='push'){
  requireValue(item&&!mechanism?.fixed,'object_not_movable');
  const weight=itemUnitWeight(s,target);if(weight>pc.attributes.Strength)success=services.check('Strength',mechanism?.forceDifficulty??weight,'moving a heavy object');
  if(success&&a.destinationId){const destination=getEntity(s,a.destinationId,'item');requireValue(visible(s,destination,actorId)&&destination.data.locationId===pc.locationId,'target_not_present');
   const door=data(destination,'item');requireValue(door.mechanism,'destination_has_no_mechanism');door.mechanism!.obstructedById=target.id;destination.data=door as Entity['data'];}
  say(success?target.name+' moved into position.':target.name+' did not move.',success?'object.moved':'physical.failed');noisy=success;
 }else if(a.operation==='throw'){
  requireValue(instrument,'throwable_item_required');const projectile=data(instrument!,'item');
  requireValue(itemUnitWeight(s,instrument!)<=Math.max(1,pc.attributes.Strength),'object_too_heavy');
  success=services.check('Agility',mechanism?.throwDifficulty??s.settings.rules?.threshold??50,'throwing at a target');
  projectile.possessorId=null;projectile.locationId=pc.locationId;projectile.containerId=null;instrument!.data=projectile as Entity['data'];recordItemEvent(s,instrument!,eventId,'discarded',actorId,{locationId:pc.locationId,note:'Thrown at '+target.id});
  if(success&&item){item.condition=Math.max(0,item.condition-(projectile.damage||mechanism?.impactDamage||25));if(mechanism?.kind==='light')mechanism.lit=false;target.data=item as Entity['data'];}
  noisy=true;say(success?instrument!.name+' struck '+target.name+'.':instrument!.name+' missed '+target.name+'.',success?'object.struck':'physical.failed');
 }else if(a.operation==='place'){
  requireValue(item,'movable_item_required');requireValue(a.destinationId,'container_required');
  const container=getEntity(s,a.destinationId!);requireValue(visible(s,container,actorId)&&container.data.locationId===pc.locationId,'target_not_present');
  requireValue(['vehicle','item'].includes(container.kind),'invalid_container');requireValue(!container.data.locked,'container_locked');
  if(container.kind==='vehicle')requireValue(vehicleHasPermission(s,container,actorId,'trunk'),'vehicle_access_denied');
  requireValue(container.id!==target.id&&!item!.mechanism?.fixed,'invalid_container');
  requireValue(containedWeight(s,container.id)+itemUnitWeight(s,target)*item!.quantity<=containerCapacity(s,container),'container_capacity');
  if(item!.deceasedId){minutes=5;const weight=itemUnitWeight(s,target);if(weight>pc.attributes.Strength)success=services.check('Strength',weight,'moving remains');}
  if(success){item!.containerId=container.id;item!.locationId=null;item!.possessorId=null;item!.equipped=false;target.data=item as Entity['data'];recordItemEvent(s,target,eventId,'stored',actorId,{containerId:container.id,locationId:pc.locationId});say(target.name+' placed in '+container.name+'.','item.stored');
   fact(s,target.id,'physical-transfer',{containerId:container.id,actorId},eventId,observers,{source:'physical-observation'});
  }else say(target.name+' could not be moved.','physical.failed');
 }else{
  // Generic plausible physical attempt: the object owner records an attempt,
  // never manufactures a goal outcome for an unsupported mechanism.
  say('The attempt to '+a.goal+' produced no established change.','physical.no-effect');success=false;
 }
 if(a.quiet&&success)noisy=!services.check('Agility',mechanism?.noiseDifficulty??s.settings.rules?.threshold??50,'avoiding noise');
 if(noisy){services.say('A sharp noise carries through the area.','environment.noise',target.id,observers);fact(s,target.id,'noise-heard',true,eventId,observers,{source:'hearing'});}
 if(success&&['force','throw'].includes(a.operation)&&item?.ownerId&&item.ownerId!==actorId){
  if(pc.locationId)recordCrime(s,{offenderIds:[actorId],victimIds:[item.ownerId],locationId:pc.locationId,eventId,category:'property',name:'Damage to '+target.name});
 }
 return {minutes,status:success?(a.quiet&&noisy?'PARTIAL' as const:'SUCCEEDED' as const):'FAILED' as const};
}
