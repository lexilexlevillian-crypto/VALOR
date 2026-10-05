import {simulationId as randomUUID} from './turn-runtime.ts';
import {data,validateEntity} from './model.ts';
import type {State,Entity} from './model.ts';
// Only starting essentials, never weapons, cash, quest rewards, or model-invented items.
export function grantStarterEssentials(s:State,character:Entity,eventId?:string){
 const c=data(character,'character'),marker='starter-essentials-v1';
 if(!c.playable||c.tags.includes(marker))return [];
 const owned=()=>s.entities.filter(e=>e.kind==='item'&&!e.archived&&(e.data.possessorId??e.data.ownerId)===character.id&&Number(e.data.quantity)>0);
 const created:Entity[]=[];
 const grant=(category:string,name:string,extra:Record<string,unknown>={})=>{
  if(owned().some(e=>e.data.category===category))return;
  const item=validateEntity({id:randomUUID(),kind:'item',name,visibility:'owner',data:{category,ownerId:character.id,possessorId:character.id,locationId:null,provenance:'starter:'+character.id,provenanceRecords:[{at:s.clock,source:'starter-essentials',eventId:eventId??null,ownerId:character.id,note:'One-time starting possession.'}],...extra}});
  s.entities.push(item);created.push(item);
 };
 if(s.settings.campaign?.technology.features.phone!==false&&s.settings.campaign?.enabledSystems.communications!==false)grant('phone','Mobile phone',{description:'A working 2012 smartphone. Contacts must still be learned in the story.',phoneNumber:'555-'+Number.parseInt(character.id.replaceAll('-','').slice(0,10),16).toString().padStart(12,'0'),weight:0.14});
 grant('wallet','Wallet',{description:'A personal wallet. Its cash balance is tracked separately.',weight:0.1});
 grant('clothing','Everyday clothes',{description:'An ordinary outfit for the start of this life.',equipped:true,wearState:'worn',weight:1});
 if(c.homeId||c.residence)grant('key','Home keys',{description:c.residence?c.residence.name+', building '+c.residence.building+', apartment '+c.residence.apartment:'Keys to the starting residence.',weight:0.03,instanceData:{homeId:c.homeId}});
 c.tags.push(marker);character.data=c;return created;
}
