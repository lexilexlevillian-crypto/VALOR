import {randomUUID} from 'node:crypto';
import {data,getEntity,validateEntity} from './model.ts';
import type {Data,Entity,State} from './model.ts';

const fallbackStackable=new Set(['ammo','cash','food','drink','medicine','drug','substance']);
const fallbackUnique=new Set(['phone','key','weapon','firearm','magazine','document','camera','computer','storage-media']);

export function itemPossessor(s:State,item:Entity):string|null{
 const d=data(item,'item');if(d.possessorId)return d.possessorId;if(d.locationId||d.containerId)return null;
 return d.ownerId&&s.entities.some(entity=>entity.id===d.ownerId&&entity.kind==='character'&&!entity.archived)?d.ownerId:null;
}
export const carriedBy=(s:State,item:Entity,characterId:string)=>item.kind==='item'&&itemPossessor(s,item)===characterId;

export function itemDefinition(s:State,item:Entity):Data<'itemType'>|null{
 const d=data(item,'item');if(!d.typeId)return null;return data(getEntity(s,d.typeId,'itemType'),'itemType');
}

export function itemStackRules(s:State,item:Entity){
 const d=data(item,'item'),definition=itemDefinition(s,item);
 if(definition)return definition.stackability;
 const stackable=fallbackStackable.has(d.category)&&!fallbackUnique.has(d.category);
 return {mode:stackable?'stackable' as const:'unique' as const,maxStack:stackable?100000:1};
}

export function itemUnitWeight(s:State,item:Entity){const d=data(item,'item'),definition=itemDefinition(s,item);return d.weight||definition?.dimensions.weightKg||0;}
export function containerCapacity(s:State,container:Entity){if(container.kind==='vehicle')return data(container,'vehicle').trunkCapacity;const d=data(container,'item'),definition=itemDefinition(s,container);return d.capacity||definition?.capacity.weightKg||0;}
export function containedWeight(s:State,containerId:string){return s.entities.filter(entity=>entity.kind==='item'&&!entity.archived&&entity.data.containerId===containerId).reduce((sum,item)=>sum+itemUnitWeight(s,item)*data(item,'item').quantity,0);}

export function recordItemEvent(s:State,item:Entity,eventId:string,action:Data<'item'>['eventHistory'][number]['action'],actorId:string|null,details:Partial<Omit<Data<'item'>['eventHistory'][number],'at'|'eventId'|'action'|'actorId'>>={}){
 const d=data(item,'item');d.eventHistory.push({at:s.clock,eventId,action,actorId,fromId:details.fromId??null,toId:details.toId??null,locationId:details.locationId??null,containerId:details.containerId??null,quantity:details.quantity??d.quantity,note:details.note??''});
 if(d.eventHistory.length>5000)d.eventHistory.splice(0,d.eventHistory.length-5000);item.data=d as Entity['data'];
}

export function splitStack(s:State,item:Entity,quantity:number,eventId:string,actorId:string){
 const d=data(item,'item'),rules=itemStackRules(s,item);if(rules.mode!=='stackable')throw new Error('item_not_stackable');if(quantity<1||quantity>=d.quantity)throw new Error('invalid_split_quantity');
 d.quantity-=quantity;item.data=d as Entity['data'];recordItemEvent(s,item,eventId,'split',actorId,{quantity,note:'Stack quantity separated.'});
 const copy=structuredClone(item);copy.id=randomUUID();copy.revision=1;copy.data={...copy.data,quantity,eventHistory:[]} as Entity['data'];const created=validateEntity(copy);recordItemEvent(s,created,eventId,'split',actorId,{fromId:item.id,quantity,note:'Created from stack '+item.id+'.'});s.entities.push(created);return created;
}

export function evidenceForItem(s:State,itemId:string){return s.entities.filter(entity=>entity.kind==='evidence'&&!entity.archived&&(entity.data.objectId===itemId||(entity.data.objectIds as string[]|undefined)?.includes(itemId))).map(entity=>{const d=data(entity,'evidence');return {id:entity.id,name:entity.name,medium:d.medium,evidenceType:d.evidenceType,caseId:d.caseId,caseIds:d.caseIds,sourceEventId:d.sourceEventId,sourceLocationId:d.sourceLocationId,sourceAt:d.sourceAt,custodianId:d.custodianId,condition:d.condition,contaminated:d.contaminated,destroyed:d.destroyed,custody:d.custody};});}

export function inventoryView(s:State,characterId:string,options:{sort?:'name'|'category'|'condition'|'quantity';category?:string;equipped?:boolean}={}){
 getEntity(s,characterId,'character');let items=s.entities.filter(entity=>entity.kind==='item'&&!entity.archived&&carriedBy(s,entity,characterId));
 if(options.category)items=items.filter(entity=>entity.data.category===options.category);if(options.equipped!==undefined)items=items.filter(entity=>Boolean(entity.data.equipped)===options.equipped);
 const sort=options.sort??'name';items.sort((left,right)=>sort==='name'?left.name.localeCompare(right.name):sort==='category'?String(left.data.category).localeCompare(String(right.data.category))||left.name.localeCompare(right.name):Number(left.data[sort])-Number(right.data[sort])||left.name.localeCompare(right.name));
 return {characterId,sort,category:options.category??null,equipped:options.equipped??null,items:items.map(item=>{const d=data(item,'item'),definition=itemDefinition(s,item),magazine=d.installedMagazineId?s.entities.find(entity=>entity.id===d.installedMagazineId&&entity.kind==='item'&&!entity.archived):null,m=magazine?data(magazine,'item'):null;return {id:item.id,name:item.name,description:d.description,category:d.category,typeId:d.typeId,typeName:definition?s.entities.find(entity=>entity.id===d.typeId)?.name??null:null,quantity:d.quantity,condition:d.condition,equipped:d.equipped,wearState:d.wearState,concealed:d.concealed,weight:itemUnitWeight(s,item),ownerId:d.ownerId,possessorId:itemPossessor(s,item),locationId:d.locationId,containerId:d.containerId,markings:d.markings,modifications:d.modifications,provenance:d.provenance,history:d.eventHistory,evidence:evidenceForItem(s,item.id),stackability:itemStackRules(s,item),legal:definition?.legal??null,weapon:['firearm','weapon','magazine','ammo','armor'].includes(d.category)?{family:d.weaponFamily||d.magazineFamily||d.proficiency,caliber:d.caliber,ammoType:d.ammoType,serial:d.serial,capacity:m?.magazine??d.magazine,rounds:m?.loaded??d.loaded,installedMagazineId:d.installedMagazineId,chamber:s.settings.weapons.chamberMode==='modeled'?{state:d.chamberState,ammoType:d.chamberAmmoType}:null,malfunction:d.malfunction,lastMaintainedAt:d.lastMaintainedAt,shotsSinceMaintenance:d.shotsSinceMaintenance,attachmentIds:d.attachmentIds,carryState:d.carryState,concealmentContextId:d.concealmentContextId,coverage:d.coverage,protection:d.protection,protectionClass:d.protectionClass}:null};})};
}
