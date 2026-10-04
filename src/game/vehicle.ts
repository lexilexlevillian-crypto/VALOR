import {randomUUID} from 'node:crypto';
import {data,getEntity} from './model.ts';
import type {Data,Entity,State} from './model.ts';
import {carriedBy} from './items.ts';

export type VehicleRandom={integer(maxExclusive:number):number};

export function vehicleOperational(vehicle:Data<'vehicle'>){
 if(vehicle.condition<=0)return false;
 return ['engine','tires','brakes'].every(component=>vehicle.components[component]===undefined||vehicle.components[component]>0);
}

export function vehiclePenalty(vehicle:Data<'vehicle'>){
 const values=Object.values(vehicle.components),health=values.length?Math.min(vehicle.condition,...values):vehicle.condition;
 return (100-health)/10-vehicle.handlingModifier;
}

export function damageVehicle(vehicle:Data<'vehicle'>,amount:number,rng:VehicleRandom){
 if(amount<=0)return null;
 amount*=Math.max(.5,1-vehicle.durability/200);
 const components=Object.keys(vehicle.components);
 if(!components.length){vehicle.condition=Math.max(0,vehicle.condition-amount);return null;}
 const component=components[rng.integer(components.length)]!,before=vehicle.components[component]??vehicle.condition,next=Math.max(0,before-amount);
 vehicle.components[component]=next;vehicle.condition=Math.min(vehicle.condition,next);return component;
}

export type VehiclePermission='enter'|'drive'|'trunk'|'manage';
export function vehicleHasPermission(s:State,vehicle:Entity,actorId:string,permission:VehiclePermission){
 const v=data(vehicle,'vehicle'),now=Date.parse(s.clock);
 if(v.ownerId===actorId||v.registeredOwnerId===actorId||v.custodianId===actorId)return true;
 if(v.authorizedDriverIds.includes(actorId)&&permission!=='manage')return true;
 if(v.hotwiredByIds.includes(actorId)&&['enter','drive'].includes(permission))return true;
 if(v.accessGrants.some(grant=>grant.characterId===actorId&&grant.permissions.includes(permission)&&(!grant.startsAt||Date.parse(grant.startsAt)<=now)&&(!grant.endsAt||Date.parse(grant.endsAt)>now)))return true;
 if(permission!=='manage'&&v.keyIds.some(id=>{const key=s.entities.find(entity=>entity.id===id&&entity.kind==='item'&&!entity.archived);return !!key&&carriedBy(s,key,actorId);} ))return true;
 return false;
}

export function recordVehicleEvent(s:State,vehicle:Entity,eventId:string|null,action:Data<'vehicle'>['history'][number]['action'],actorId:string|null,details:Partial<Omit<Data<'vehicle'>['history'][number],'at'|'eventId'|'action'|'actorId'|'fuel'|'condition'|'odometerKm'>>={}){
 const v=data(vehicle,'vehicle');v.history.push({at:s.clock,eventId,action,actorId,fromLocationId:details.fromLocationId??null,toLocationId:details.toLocationId??null,fuel:v.fuel,condition:v.condition,odometerKm:v.odometerKm,note:details.note??'',evidenceIds:details.evidenceIds??[]});if(v.history.length>10000)v.history.splice(0,v.history.length-10000);vehicle.data=v as Entity['data'];
}

export function recordVehicleDamage(s:State,vehicle:Entity,eventId:string,kind:Data<'vehicle'>['damageRecords'][number]['kind'],severity:number,description:string,component=''){
 const v=data(vehicle,'vehicle'),record={id:randomUUID(),at:s.clock,eventId,kind,component,severity:Math.max(0,Math.min(100,severity)),description,repairedAt:null};v.damageRecords.push(record);if(v.damageRecords.length>5000)v.damageRecords.splice(0,v.damageRecords.length-5000);vehicle.data=v as Entity['data'];return record;
}

export function moveVehicle(s:State,vehicle:Entity,driverId:string,destinationId:string,minutes:number,eventId:string,mode:'drive'|'tow'='drive',distanceKm?:number){
 const v=data(vehicle,'vehicle'),originId=v.locationId;if(!originId)throw new Error('vehicle_location_unresolved');getEntity(s,destinationId,'location');
 const departedAt=s.clock,arrivesAt=new Date(Date.parse(s.clock)+minutes*60000).toISOString();v.locationId=null;v.routeState={originId,destinationId,departedAt,arrivesAt,mode,status:'enroute'};vehicle.data=v as Entity['data'];recordVehicleEvent(s,vehicle,eventId,mode==='tow'?'towed':'departed',driverId,{fromLocationId:originId,toLocationId:destinationId,note:'Route state '+originId+' to '+destinationId+'.'});
 const moving=data(vehicle,'vehicle');moving.locationId=destinationId;moving.routeState=null;moving.odometerKm+=Math.max(0,distanceKm??minutes*s.settings.vehicles.distanceKmPerMinute);for(const id of moving.occupants){const occupant=getEntity(s,id,'character'),character=data(occupant,'character');character.locationId=destinationId;occupant.data=character as Entity['data'];}vehicle.data=moving as Entity['data'];recordVehicleEvent(s,vehicle,eventId,'arrived',driverId,{fromLocationId:originId,toLocationId:destinationId,note:'Vehicle and occupants arrived; trunk contents remain contained.'});
}

export function transitOption(s:State,fromId:string,toId:string,mode:'transit'|'taxi'){
 const current=timeMinute(s.clock,s.settings.timezone),services=s.entities.filter(entity=>entity.kind==='transportService'&&!entity.archived&&data(entity,'transportService').active&&(mode==='taxi'?data(entity,'transportService').mode==='taxi':['bus','transit'].includes(data(entity,'transportService').mode)));
 const options=services.flatMap(service=>{const d=data(service,'transportService');return d.routes.filter(route=>route.fromId===fromId&&route.toId===toId&&(d.scheduleMode==='on-demand'||route.departures.length>0)).map(route=>{const wait=d.scheduleMode==='on-demand'?0:Math.min(...route.departures.map(departure=>departure>=current?departure-current:1440-current+departure));return {service,route,wait,totalMinutes:wait+route.minutes};});}).sort((a,b)=>a.totalMinutes-b.totalMinutes||a.service.id.localeCompare(b.service.id));return options[0]??null;
}

function timeMinute(at:string,timezone:string){const parts=new Intl.DateTimeFormat('en-US',{timeZone:timezone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(at)),value=(kind:string)=>Number(parts.find(part=>part.type===kind)!.value);return value('hour')*60+value('minute');}

export function vehicleState(s:State,vehicle:Entity){const v=data(vehicle,'vehicle');return {id:vehicle.id,category:v.category,ownerId:v.ownerId,registeredOwnerId:v.registeredOwnerId,location:v.routeState?{kind:'route' as const,...v.routeState}:{kind:'location' as const,locationId:v.locationId},identifiers:{plate:v.plate,registration:v.registration,vin:v.vin},description:{make:v.make,model:v.model,year:v.year,color:v.color},fuel:v.fuel,condition:v.condition,components:v.components,damage:v.damageRecords,repairs:v.repairRecords,occupants:v.occupants,trunkItemIds:s.entities.filter(entity=>entity.kind==='item'&&!entity.archived&&entity.data.containerId===vehicle.id).map(entity=>entity.id),stolen:v.stolen,theftStatus:v.theftStatus,custodianId:v.custodianId,custodyRole:v.custodyRole,roles:v.roles,history:v.history};}
