import {randomUUID} from 'node:crypto';
import {data,getEntity} from './model.ts';
import type {Action,Entity,State} from './model.ts';
import {atLocation,add,advance,emit,isOpen,timeParts} from './simulation.ts';
import type {Effect} from './simulation.ts';
import {fact,observe,remember,visible} from './epistemics.ts';
import {randomSource} from '../random.ts';
import {extendedAction} from './extended-actions.ts';
const requireRule=(s:State)=>{if(!s.settings.rules)throw new Error('configure_resolution_rules_first');return s.settings.rules;};
const assert=(ok:unknown,code:string)=>{if(!ok)throw new Error(code);};
export function resolveAction(s:State,actorId:string,action:Action,eventId:string,seed:string){
 const actor=getEntity(s,actorId,'character');let pc=data(actor,'character');const effects:Effect[]=[];
 const rng=randomSource(seed);let minutes=0;let arrivalId:string|null=null;
 assert(pc.condition==='conscious','character_cannot_act');
 assert(!pc.restrainedBy||['look','say','wait','surrender','pay-bail'].includes(action.type),'character_restrained');
 const say=(text:string,type:string=action.type,subjectId=actorId,observers=[actorId])=>emit(effects,text,observers,type,subjectId);
 const nearby=(target:Entity)=>{assert(target.data.locationId===pc.locationId&&pc.locationId&&visible(s,target,actorId),'target_not_present');};
 const owned=(id:string)=>{const item=getEntity(s,id,'item');assert(item.data.ownerId===actorId&&visible(s,item,actorId),'item_not_owned');return item;};
 const canCommunicate=(target:Entity)=>target.data.locationId===pc.locationId&&!!pc.locationId||s.entities.some(e=>e.kind==='item'&&e.data.category==='phone'&&e.data.ownerId===actorId&&!e.data.locked&&Number(e.data.battery)>0&&(e.data.contacts as {characterId:string}[]).some(c=>c.characterId===target.id));
 const roll=(attribute:keyof typeof pc.attributes,skillId:string|null=null,difficulty?:number)=>{
  const rule=requireRule(s);const die=rng.integer(rule.dieSides)+1,skill=skillId?(pc.skills[skillId]??0):0;
  const modifier=pc.traits.reduce((n,id)=>n+Number(data(getEntity(s,id,'trait'),'trait').modifiers[attribute]??0),0)+s.entities.filter(e=>e.kind==='injury'&&!e.archived&&e.data.characterId===actorId).reduce((n,e)=>n+Number(data(e,'injury').modifiers[attribute]??0),0);
  const target=difficulty??rule.threshold,total=die+pc.attributes[attribute]+skill+modifier;
  say('Check: '+total+' against '+target+'. '+(total>=target?'Success.':'Failure.'),'check');
  return total>=target;
 };
 const activeCombat=()=>s.entities.find(e=>e.kind==='combat'&&!e.archived&&e.data.active&&(e.data.participants as string[]).includes(actorId));
 const combatTurn=()=>{const combat=activeCombat();assert(combat,'combat_not_active');const d=data(combat!,'combat');assert(d.participants[d.turnIndex]===actorId,'not_your_turn');return combat!;};
 if(activeCombat()&&!['look','say','surrender'].includes(action.type)){
  assert(['attack','defend','grapple','restrain','disarm','shove','flee','reload','cover','consume','treat','tactical-move'].includes(action.type),'use_combat_action_or_flee');
  combatTurn();
 }
 const hurt=(target:Entity,amount:number,category:'gunshot'|'blunt',part:string)=>{
  const wounds=add(s,'injury',category+' injury',{characterId:target.id,bodyPart:part,category,severity:amount,pain:amount,bleeding:category==='gunshot'?amount/10:0,startedAt:s.clock},'owner');
  const witnesses=atLocation(s,pc.locationId).map(e=>e.id);
  fact(s,target.id,'injury',{injuryId:wounds.id,category,bodyPart:part},eventId,witnesses);
  const td=data(target,'character');if(amount>=100){td.condition='unconscious';target.data=td as Entity['data'];}
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
 case 'wait': minutes=action.minutes;say('Time passes.');break;
 case 'sleep':minutes=action.minutes;pc.fatigue=Math.max(0,pc.fatigue-action.minutes/6);say('The rest interval passes.');break;
 case 'say':say(action.text,'player.dialogue',actorId,atLocation(s,pc.locationId).map(e=>e.id));minutes=1;break;
 case 'travel':case 'flee':{
  assert(pc.locationId,'starting_location_required');
  if(action.type==='flee')combatTurn();
  const location=data(getEntity(s,pc.locationId!,'location'),'location'),destination=getEntity(s,action.destinationId,'location');
  assert(visible(s,destination,actorId)||data(destination,'location').discoverable,'destination_unknown');
  const mode=action.type==='travel'?action.mode:'walk';
  const exit=location.exits.find(e=>e.to===destination.id&&e.modes.includes(mode));assert(exit,'route_unavailable');
  if(exit!.locked)assert(exit!.keyId&&s.entities.some(e=>e.id===exit!.keyId&&e.data.ownerId===actorId),'route_locked');
  assert(isOpen(data(destination,'location').hours,s),'destination_closed');
  assert(!data(destination,'location').closedDates.includes(timeParts(s.clock,s.settings.timezone).date),'destination_closed');
  assert(pc.cash>=exit!.fare,'insufficient_funds');
  const interruption=exit!.interruption&&(!exit!.interruption.whenWeather||exit!.interruption.whenWeather===s.settings.weather)?exit!.interruption:null;
  const arrival=interruption?getEntity(s,interruption.locationId,'location'):destination,travelMinutes=interruption?.afterMinutes??exit!.minutes;
  if(action.type==='flee'&&!roll('Agility')){say('The escape attempt fails.');minutes=1;break;}
  pc.cash-=exit!.fare;
  if(mode==='drive'){
   const vehicle=getEntity(s,action.type==='travel'?action.vehicleId??'':'','vehicle'),d=data(vehicle,'vehicle');nearby(vehicle);
   assert(d.ownerId===actorId||d.keyId&&s.entities.some(e=>e.id===d.keyId&&e.data.ownerId===actorId),'vehicle_access_denied');
   assert(d.condition>0,'vehicle_disabled');if(s.settings.fuel){assert(d.fuel>=travelMinutes/10,'insufficient_fuel');d.fuel-=travelMinutes/10;}
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
  const item=getEntity(s,action.itemId,'item'),d=data(item,'item');assert(!d.ownerId&&!d.containerId,'item_not_available');nearby(item);
  assert(!d.concealed||visible(s,item,actorId),'item_not_discovered');d.ownerId=actorId;d.locationId=null;item.data=d as Entity['data'];say(item.name+' added to inventory.');minutes=1;break;
 }
 case 'give':{const item=owned(action.itemId),target=getEntity(s,action.toId,'character');nearby(target);assert(target.id!==actorId,'invalid_target');item.data.ownerId=target.id;item.data.equipped=false;say(item.name+' transferred to '+target.name+'.');minutes=1;break;}
 case 'steal':{
  const target=getEntity(s,action.targetId,'character'),item=getEntity(s,action.itemId,'item');nearby(target);
  assert(item.data.ownerId===target.id&&visible(s,item,actorId),'item_not_observable');
  if(roll('Agility')){item.data.ownerId=actorId;item.data.stolen=true;item.data.equipped=false;say(item.name+' changes possession. Ownership history remains recorded.');}
  else{fact(s,actorId,'attempted-theft',{itemId:item.id,targetId:target.id},eventId,atLocation(s,pc.locationId).map(e=>e.id));say('The attempted theft is noticed.');}
  minutes=1;break;
 }
 case 'cover':{
  const combat=combatTurn();assert(pc.locationId,'starting_location_required');const protection=data(getEntity(s,pc.locationId!,'location'),'location').cover;
  assert(protection>0,'no_authored_cover');(combat.data.cover as Record<string,number>)[actorId]=protection;say('Available cover is used.');break;
 }
 case 'equip':{const item=owned(action.itemId);item.data.equipped=action.equipped;say(item.name+(action.equipped?' equipped.':' unequipped.'));break;}
 case 'conceal':{const item=owned(action.itemId);item.data.concealed=action.concealed;say(item.name+(action.concealed?' concealed.':' made visible.'));minutes=1;break;}
 case 'store':case 'retrieve':{
  const container=getEntity(s,action.containerId);assert(['item','vehicle'].includes(container.kind),'container_unavailable');
  const vehicle=container.kind==='vehicle'?data(container,'vehicle'):null,c=container.kind==='item'?data(container,'item'):null;
  assert(vehicle?!vehicle.locked:c?.category==='container'&&!c.locked,'container_unavailable');
  const owner=vehicle?.ownerId??c?.ownerId,location=vehicle?.locationId??c?.locationId,capacity=vehicle?.trunkCapacity??c?.capacity??0;
  assert(visible(s,container,actorId)&&(vehicle?location===pc.locationId&&pc.locationId&&(owner===actorId||vehicle.keyId&&s.entities.some(e=>e.id===vehicle.keyId&&e.data.ownerId===actorId)):owner===actorId||location===pc.locationId&&pc.locationId),'container_access_denied');
  const item=getEntity(s,action.itemId,'item'),d=data(item,'item');assert(item.id!==container.id,'containment_cycle');
  if(action.type==='store'){owned(item.id);const used=s.entities.filter(e=>e.kind==='item'&&!e.archived&&e.data.containerId===container.id).reduce((n,e)=>n+Number(e.data.weight)*Number(e.data.quantity),0);assert(used+d.weight*d.quantity<=capacity,'container_capacity');d.ownerId=null;d.locationId=null;d.containerId=container.id;d.equipped=false;}
  else{assert(d.containerId===container.id&&visible(s,item,actorId),'item_not_in_container');d.containerId=null;d.ownerId=actorId;}
  item.data=d as Entity['data'];say(item.name+(action.type==='store'?' stored.':' retrieved.'));minutes=1;break;
 }
 case 'reload':{
  const weapon=owned(action.weaponId),ammo=owned(action.ammoId),w=data(weapon,'item'),a=data(ammo,'item');
  assert(w.category==='firearm'&&a.category==='ammo'&&w.caliber&&w.caliber===a.caliber,'incompatible_ammunition');
  const count=Math.min(w.magazine-w.loaded,a.quantity);assert(count>0,'nothing_to_reload');w.loaded+=count;a.quantity-=count;
  weapon.data=w as Entity['data'];ammo.data=a as Entity['data'];say(count+' rounds loaded.');minutes=1;break;
 }
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
 case 'message':{
  const phone=owned(action.phoneId),p=data(phone,'item'),target=getEntity(s,action.toId,'character');
  assert(p.category==='phone'&&!p.locked&&p.battery>0,'phone_unavailable');assert(p.contacts.some(c=>c.characterId===target.id),'contact_unknown');
  const recipientAvailable=s.entities.some(e=>e.kind==='item'&&e.data.category==='phone'&&e.data.ownerId===target.id&&Number(e.data.battery)>0);
  const message=add(s,'message',action.medium.toUpperCase(),{fromId:actorId,toId:target.id,phoneId:phone.id,medium:action.medium,body:action.text,at:s.clock,status:recipientAvailable?'delivered':'queued'},'owner');
  fact(s,message.id,'communication',{fromId:actorId,toId:target.id,body:action.text},eventId,recipientAvailable?[actorId,target.id]:[actorId]);
  if(recipientAvailable)s.beliefs.push({id:randomUUID(),observerId:target.id,proposition:action.text,confidence:0.5,source:'message:'+message.id,at:s.clock,correctedBy:null});
  p.battery=Math.max(0,p.battery-1);phone.data=p as Entity['data'];say(action.medium.toUpperCase()+' sent.');minutes=1;break;
 }
 case 'buy':case 'sell':{
  const business=getEntity(s,action.businessId,'business'),b=data(business,'business');assert(b.locationId===pc.locationId&&isOpen(b.hours,s),'business_closed_or_unreachable');
  const item=getEntity(s,action.itemId,'item'),d=data(item,'item'),price=Math.round(d.price*b.priceMultiplier);
  assert(d.quantity>0,'out_of_stock');assert(!d.stolen||b.contraband,'merchant_refuses_stolen_goods');
  if(action.type==='buy'){assert(b.stock.includes(item.id)&&d.ownerId===business.id,'out_of_stock');const payment=action.payment??'cash';if(payment==='bank')assert(s.entities.some(e=>e.kind==='item'&&e.data.ownerId===actorId&&(e.data.tags as string[]).includes('payment-card')),'payment_card_required');assert(pc[payment]>=price,'insufficient_funds');pc[payment]-=price;b.cash+=price;b.stock=b.stock.filter(id=>id!==item.id);d.ownerId=actorId;}
  else{assert(d.ownerId===actorId,'item_not_owned');assert(b.cash>=price,'merchant_insufficient_funds');b.cash-=price;pc.cash+=price;b.stock.push(item.id);d.ownerId=business.id;d.equipped=false;}
  assert(Number.isSafeInteger(pc.cash)&&Number.isSafeInteger(b.cash),'money_overflow');business.data=b as Entity['data'];item.data=d as Entity['data'];
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
  const romantic=['flirt','date','commit','cohabit','marry','reconcile','intimacy'].includes(action.intent);
  assert(!pc.boundaries.includes(action.intent)&&!(target.data.boundaries as string[]).includes(action.intent),'boundary_declined');
  if(romantic){assert(s.settings.romance,'romance_disabled');assert(action.consent,'explicit_consent_required');
   const adult=(dob:unknown)=>typeof dob==='string'&&(Date.parse(s.clock)-Date.parse(dob))/31557600000>=18;
   assert(adult(pc.dob)&&adult(target.data.dob),'adult_age_verification_required');
  }
  if(action.intent==='intimacy')assert(s.settings.intimacy==='fade-to-black','intimacy_disabled');
  let relation=s.entities.find(e=>e.kind==='relationship'&&!e.archived&&e.data.fromId===target.id&&e.data.toId===actorId);
  if(!relation)relation=add(s,'relationship',target.name+' → '+actor.name,{fromId:target.id,toId:actorId,secret:false},'campaign');
  const r=data(relation,'relationship');
  assert(!r.boundaries.includes(action.intent),'boundary_declined');
  if(['date','commit','cohabit','marry','reconcile','intimacy'].includes(action.intent)){assert(r.pending===action.intent,'reciprocal_consent_required');r.pending='';r.labels=[...new Set([...r.labels,action.intent])];}
  if(action.intent==='breakup')r.labels=r.labels.filter(x=>!['date','commit','cohabit','marry','reconcile','intimacy'].includes(x));
  if(action.intent==='decline')r.pending='';
  r.familiarity=Math.min(100,r.familiarity+1-r.inertia);r.history.push({at:s.clock,eventId,label:action.intent});relation.data=r as Entity['data'];
  // Never assign an emotion or a relationship meter to the player.
  say(action.intent==='intimacy'?'The scene fades to black.':'Interaction recorded: '+action.intent+'.');minutes=5;break;
 }
 case 'share':{
  const target=getEntity(s,action.targetId,'character');nearby(target);assert(s.knowledge.some(k=>k.observerId===actorId&&k.factId===action.factId),'fact_unknown');
  observe(s,target.id,action.factId,'told-by:'+actorId+':'+eventId);say('Information shared with '+target.name+'.');minutes=1;break;
 }
 case 'check':roll(action.attribute,action.skillId);break;
 case 'combat':{
  requireRule(s);const target=getEntity(s,action.targetId,'character');nearby(target);assert(target.id!==actorId&&!activeCombat(),'combat_unavailable');
  const order=[actor,target].sort((a,b)=>Number(b.data.attributes&& (b.data.attributes as Record<string,number>).Agility)-Number(a.data.attributes&&(a.data.attributes as Record<string,number>).Agility)||a.id.localeCompare(b.id));
  add(s,'combat','Conflict',{participants:order.map(e=>e.id)},'campaign');say('Conflict begins. Initiative is recorded.');break;
 }
 case 'tactical-move':{const combat=combatTurn(),c=data(combat,'combat');assert(s.settings.tactics&&c.positions[actorId]!==undefined,'configure_tactical_movement_first');assert(Math.abs(action.position-c.positions[actorId]!)<=s.settings.tactics!.movementMeters,'movement_out_of_range');c.positions[actorId]=action.position;combat.data=c as Entity['data'];say('Tactical position updated.');minutes=1;break;}
 case 'attack':{
  const rule=requireRule(s),combat=combatTurn(),target=getEntity(s,action.targetId,'character');nearby(target);assert((combat.data.participants as string[]).includes(target.id)&&target.id!==actorId,'invalid_combat_target');
  const tactical=data(combat,'combat');
  assert(!tactical.blockedLines.some(line=>line.fromId===actorId&&line.toId===target.id||line.fromId===target.id&&line.toId===actorId),'line_of_fire_blocked');
  let category:'gunshot'|'blunt'='blunt',skillId:string|null=null,penalty=0;
  if(action.weaponId){const weapon=owned(action.weaponId),w=data(weapon,'item');assert(['weapon','firearm'].includes(w.category)&&w.condition>0,'weapon_unavailable');
   if(w.rangeMeters!==null){assert(tactical.positions[actorId]!==undefined&&tactical.positions[target.id]!==undefined,'tactical_positions_required');assert(Math.abs(tactical.positions[actorId]!-tactical.positions[target.id]!)<=w.rangeMeters,'target_out_of_range');}
   if(w.category==='firearm'){assert(w.loaded>0,'empty_firearm');w.loaded--;category='gunshot';weapon.data=w as Entity['data'];add(s,'evidence','Spent casing',{locationId:pc.locationId,objectId:weapon.id,sourceEventId:eventId},'knowledge');}
   const skill=s.entities.find(e=>e.kind==='skill'&&e.name===w.proficiency);skillId=skill?.id??null;if(!skillId||!pc.skills[skillId])penalty=rule.unfamiliarPenalty;
  }
  const c=data(combat,'combat'),cover=c.cover[target.id]??0,defense=c.defenses[target.id]?2:0;
  if(roll(category==='gunshot'?'Perception':'Strength',skillId,rule.threshold+cover+defense+penalty)){
   const armor=s.entities.filter(e=>e.kind==='item'&&e.data.ownerId===target.id&&e.data.equipped&&e.data.category==='armor'&&(e.data.coverage as string[]).includes(action.bodyPart));
   const amount=Math.max(0,rule.damage-armor.reduce((n,e)=>n+data(e,'item').protection*Number(e.data.condition)/100,0));if(amount>0){hurt(target,amount,category,action.bodyPart);say('The attack causes an externally visible injury.','injury',target.id);}else say('Authored protection prevents injury.');
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
   if(action.type==='disarm'){const weapon=s.entities.find(e=>e.kind==='item'&&e.data.ownerId===target.id&&e.data.equipped&&['firearm','weapon'].includes(String(e.data.category)));if(weapon){weapon.data.ownerId=null;weapon.data.locationId=pc.locationId;weapon.data.equipped=false;}}
   say(action.type+' succeeds.');
  }minutes=1;break;
 }
 case 'surrender':{const combat=activeCombat();assert(combat,'combat_not_active');combat!.data.active=false;say('Surrender offered.');break;}
 case 'chase':{
  requireRule(s);const target=getEntity(s,action.targetId,'character');nearby(target);assert(!target.data.playable,'other_player_action_required');
  assert(pc.locationId,'starting_location_required');const location=data(getEntity(s,pc.locationId!,'location'),'location');
  const route=location.exits.find(e=>e.to===action.destinationId&&!e.locked&&e.modes.includes(action.vehicleId?'drive':'walk'));
  assert(route,'route_unavailable');const destination=getEntity(s,action.destinationId,'location');assert(visible(s,destination,actorId),'destination_unknown');
  if(action.vehicleId){const vehicle=getEntity(s,action.vehicleId,'vehicle'),v=data(vehicle,'vehicle');nearby(vehicle);assert(v.ownerId===actorId&&v.condition>0,'vehicle_access_denied');if(s.settings.fuel){assert(v.fuel>=route!.minutes/10,'insufficient_fuel');v.fuel-=route!.minutes/10;}v.locationId=destination.id;vehicle.data=v as Entity['data'];}
  const driving=s.entities.find(e=>e.kind==='skill'&&e.name.toLowerCase()==='driving');
  const vehiclePenalty=action.vehicleId?(100-Number(getEntity(s,action.vehicleId,'vehicle').data.condition))/10:0;
  const success=roll(action.vehicleId?'Perception':'Agility',action.vehicleId?driving?.id??null:null,requireRule(s).threshold+route!.terrainPenalty+(action.vehicleId?route!.trafficPenalty+vehiclePenalty:0));
  if(action.vehicleId){const vehicle=getEntity(s,action.vehicleId,'vehicle'),v=data(vehicle,'vehicle');assert(v.occupants.every(id=>id===actorId||!getEntity(s,id,'character').data.playable),'passenger_consent_required');for(const id of v.occupants)if(id!==actorId)getEntity(s,id,'character').data.locationId=destination.id;if(!success&&s.settings.tactics)vehicle.data.condition=Math.max(0,v.condition-s.settings.tactics.failedChaseVehicleDamage);}
  arrivalId=destination.id;pc.locationId=null;target.data.locationId=destination.id;minutes=route!.minutes;
  if(success)target.data.fatigue=Math.min(100,Number(target.data.fatigue)+10);
  say(success?'The pursuit closes the distance.':'The pursued character maintains separation.');fact(s,target.id,'chase',{pursuerId:actorId,closed:success},eventId,atLocation(s,destination.id).map(e=>e.id));break;
 }
 case 'search':{
  assert(pc.locationId,'starting_location_required');
  const location=data(getEntity(s,pc.locationId!,'location'),'location');
  for(const exit of location.exits){const destination=getEntity(s,exit.to,'location');if(destination.data.discoverable&&destination.visibility!=='creator'){fact(s,destination.id,'discovered',true,eventId,[actorId]);say('Route discovered: '+destination.name+'.','discovery',destination.id);}}
  for(const e of s.entities.filter(e=>!e.archived&&e.data.locationId===pc.locationId&&e.visibility!=='creator')){
   if(e.kind==='evidence'&&!e.data.destroyed){const d=data(e,'evidence');if(!d.discoveredBy.includes(actorId))d.discoveredBy.push(actorId);e.data=d as Entity['data'];fact(s,e.id,'discovered',true,eventId,[actorId]);say('Discovered: '+e.name+'.','discovery',e.id);}
   if(e.kind==='item'&&e.data.concealed){requireRule(s);if(roll('Perception')){e.data.concealed=false;fact(s,e.id,'discovered',true,eventId,[actorId]);say('Found: '+e.name+'.','discovery',e.id);}}
  }minutes=5;break;
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
 return {effects,draws:rng.draws};
}
