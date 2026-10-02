import {data,getEntity} from './model.ts';
import type {Data,Entity,State} from './model.ts';
import {carriedBy,itemDefinition,recordItemEvent} from './items.ts';

type ItemData=Data<'item'>;

const assert=(ok:unknown,code:string)=>{if(!ok)throw new Error(code);};
const ammoType=(item:ItemData)=>item.ammoType||item.caliber;

export function compatibleAmmunition(weapon:ItemData,ammo:ItemData){
 if(weapon.category!=='firearm'||ammo.category!=='ammo')return false;
 if(!weapon.caliber||!ammo.caliber||weapon.caliber!==ammo.caliber)return false;
 const accepted=weapon.compatibleAmmoTypes.length?weapon.compatibleAmmoTypes:weapon.ammoType?[weapon.ammoType]:[];
 return !accepted.length||!ammoType(ammo)||accepted.includes(ammoType(ammo));
}

export function compatibleMagazine(weapon:ItemData,magazine:ItemData){
 if(weapon.category!=='firearm'||magazine.category!=='magazine')return false;
 if(!weapon.caliber||!magazine.caliber||weapon.caliber!==magazine.caliber)return false;
 return !weapon.compatibleMagazineFamilies.length||Boolean(magazine.magazineFamily&&weapon.compatibleMagazineFamilies.includes(magazine.magazineFamily));
}

export function installedMagazine(s:State,weapon:Entity){
 const id=data(weapon,'item').installedMagazineId;if(!id)return null;
 const magazine=getEntity(s,id,'item');assert(data(magazine,'item').category==='magazine','magazine_install_target');return magazine;
}

function reservoir(s:State,weapon:Entity){return installedMagazine(s,weapon)??weapon;}

function primeChamber(s:State,weapon:Entity){
 const w=data(weapon,'item');if(s.settings.weapons.chamberMode!=='modeled'||w.chamberState==='loaded')return false;
 const source=reservoir(s,weapon),rounds=data(source,'item');if(rounds.loaded<1){w.chamberState='empty';w.chamberAmmoType='';weapon.data=w as Entity['data'];return false;}
 rounds.loaded--;w.chamberState='loaded';w.chamberAmmoType=ammoType(rounds)||ammoType(w);source.data=rounds as Entity['data'];weapon.data=w as Entity['data'];return true;
}

export function loadMagazineFromAmmo(s:State,magazine:Entity,ammo:Entity,requested?:number){
 const m=data(magazine,'item'),a=data(ammo,'item');assert(m.category==='magazine'&&a.category==='ammo','incompatible_ammunition');assert(m.caliber&&a.caliber&&m.caliber===a.caliber,'incompatible_ammunition');
 if(m.ammoType&&ammoType(a)&&m.ammoType!==ammoType(a)&&m.loaded)throw new Error('mixed_ammunition_not_supported');
 const count=Math.min(requested??a.quantity,m.magazine-m.loaded,a.quantity);assert(count>0,'nothing_to_reload');m.loaded+=count;m.ammoType=ammoType(a);a.quantity-=count;magazine.data=m as Entity['data'];ammo.data=a as Entity['data'];return count;
}

export function reloadFirearm(s:State,weapon:Entity,source:Entity){
 const w=data(weapon,'item');assert(w.category==='firearm','weapon_unavailable');
 if(data(source,'item').category==='magazine'){
  const m=data(source,'item');assert(compatibleMagazine(w,m),'incompatible_magazine');const replaced=w.installedMagazineId;w.installedMagazineId=source.id;weapon.data=w as Entity['data'];primeChamber(s,weapon);return {count:0,replaced,magazineId:source.id};
 }
 const a=data(source,'item');assert(compatibleAmmunition(w,a),'incompatible_ammunition');const target=installedMagazine(s,weapon);
 let count:number;if(target)count=loadMagazineFromAmmo(s,target,source);else{
  const room=w.magazine-w.loaded;
  if(s.settings.weapons.chamberMode==='modeled'&&room===0&&w.chamberState!=='loaded'){assert(a.quantity>0,'nothing_to_reload');count=1;a.quantity--;w.chamberState='loaded';w.chamberAmmoType=ammoType(a);}
  else{count=Math.min(room,a.quantity);assert(count>0,'nothing_to_reload');w.loaded+=count;a.quantity-=count;}
  w.ammoType=ammoType(a);weapon.data=w as Entity['data'];source.data=a as Entity['data'];primeChamber(s,weapon);
 }
 return {count,replaced:null,magazineId:target?.id??null};
}

export function consumeFirearmRound(s:State,weapon:Entity){
 const w=data(weapon,'item');assert(w.category==='firearm','weapon_unavailable');
 if(s.settings.weapons.chamberMode==='modeled'){
  if(w.chamberState!=='loaded')return {fired:false,ammoType:null};
  const firedType=w.chamberAmmoType||ammoType(w);w.chamberState='empty';w.chamberAmmoType='';weapon.data=w as Entity['data'];primeChamber(s,weapon);return {fired:true,ammoType:firedType};
 }
 const source=reservoir(s,weapon),rounds=data(source,'item');if(rounds.loaded<1)return {fired:false,ammoType:null};rounds.loaded--;source.data=rounds as Entity['data'];return {fired:true,ammoType:ammoType(rounds)||ammoType(w)};
}

export function weaponState(s:State,weapon:Entity){
 const w=data(weapon,'item'),installed=installedMagazine(s,weapon),m=installed?data(installed,'item'):null;
 return {id:weapon.id,type:w.category,family:w.weaponFamily||w.proficiency,caliber:w.caliber,serial:w.serial,markings:w.markings,condition:w.condition,malfunction:w.malfunction,carryState:w.carryState,possessorId:w.possessorId,ownerId:w.ownerId,concealed:w.concealed,concealmentContextId:w.concealmentContextId,attachments:w.attachmentIds,magazine:installed?{id:installed.id,family:m!.magazineFamily,capacity:m!.magazine,rounds:m!.loaded,ammoType:m!.ammoType}:{id:null,family:w.magazineFamily,capacity:w.magazine,rounds:w.loaded,ammoType:w.ammoType},chamber:s.settings.weapons.chamberMode==='modeled'?{state:w.chamberState,ammoType:w.chamberAmmoType}:null,totalRounds:(m?.loaded??w.loaded)+(s.settings.weapons.chamberMode==='modeled'&&w.chamberState==='loaded'?1:0),history:w.eventHistory.filter(entry=>['loaded','unloaded','shot','empty-click','malfunction','maintained','disarmed','recovered'].includes(entry.action))};
}

export function concealmentFor(s:State,actorId:string,item:Entity,contextId:string){
 const context=getEntity(s,contextId),d=data(item,'item'),definition=itemDefinition(s,item),length=definition?.dimensions.lengthCm??0;
 if(context.kind==='character'){assert(context.id===actorId,'invalid_concealment_context');const rating=Math.max(0,55-length/2);assert(rating>0,'item_too_large_to_conceal');return rating;}
 assert(context.kind==='item'&&carriedBy(s,context,actorId),'invalid_concealment_context');const c=data(context,'item');assert(['clothing','container','armor'].includes(c.category)&&(c.wearState==='worn'||c.category==='container'),'invalid_concealment_context');
 const definitionContext=itemDefinition(s,context),capacity=Math.max(c.capacity,definitionContext?.capacity.volumeLiters??0),rating=Math.max(0,35+capacity*2-length/2);assert(rating>0,'item_too_large_to_conceal');return Math.min(100,rating);
}

export function applyBallisticProtection(s:State,targetId:string,bodyPart:string,damage:number){
 if(s.settings.weapons.ballisticsFormula==='authored-result')throw new Error('authored_ballistics_result_required');
 const armor=s.entities.filter(entity=>entity.kind==='item'&&carriedBy(s,entity,targetId)&&entity.data.equipped&&entity.data.category==='armor'&&(entity.data.coverage as string[]).includes(bodyPart));
 const protection=armor.reduce((sum,entity)=>sum+data(entity,'item').protection*data(entity,'item').condition/100,0),absorbed=Math.min(damage,protection);
 for(const entity of armor){const d=data(entity,'item');d.condition=Math.max(0,d.condition-s.settings.weapons.armorConditionLossPerHit);entity.data=d as Entity['data'];}
 return {armor,protection,absorbed,damage:Math.max(0,damage-protection),formula:s.settings.weapons.ballisticsFormula};
}

export function recordWeaponEvent(s:State,weapon:Entity,eventId:string,action:Parameters<typeof recordItemEvent>[3],actorId:string,note:string,quantity=1){recordItemEvent(s,weapon,eventId,action,actorId,{locationId:data(getEntity(s,actorId,'character'),'character').locationId,quantity,note});}
