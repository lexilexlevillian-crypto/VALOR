import {randomUUID} from 'node:crypto';
import {data,getEntity} from './model.ts';
import type {Data,Entity,State} from './model.ts';
import {observerView} from './epistemics.ts';

export function phonePowered(phone:Entity,incoming=false){
 const item=data(phone,'item');
 return item.category==='phone'&&item.phoneState==='active'&&item.condition>0&&item.service!=='none'&&(!item.batteryRequired||item.battery>0)&&(incoming||!item.locked);
}
export function canAccessPhone(phone:Entity,characterId:string){
 const item=data(phone,'item');
 const possessor=item.possessorId??(!item.locationId&&!item.containerId?item.ownerId:null);return item.category==='phone'&&phonePowered(phone)&&!item.locked&&(possessor===characterId||item.authorizedUserIds.includes(characterId));
}
export function requirePhone(s:State,phoneId:string,characterId:string){
 const phone=getEntity(s,phoneId,'item');
 if(!canAccessPhone(phone,characterId))throw new Error('phone_unavailable');
 return phone;
}
export function recipientPhone(s:State,characterId:string|null,number:string,medium:'sms'|'mms'|'call'|'voicemail'|'email'){
 return s.entities.find(entity=>{
  if(entity.kind!=='item'||entity.archived)return false;
  const phone=data(entity,'item');
  if(phone.category!=='phone'||!phonePowered(entity,true))return false;
  if(characterId&&(phone.possessorId??phone.ownerId)!==characterId)return false;
  if(number&&phone.phoneNumber&&phone.phoneNumber!==number)return false;
  if(['sms','mms'].includes(medium)&&phone.phoneType==='landline')return false;
  if(medium==='email'&&!phone.phoneApps.email)return false;
  return true;
 })??null;
}
export function acceptsCommunication(phone:Entity,fromId:string,medium:'sms'|'mms'|'call'|'voicemail'|'email'){
 const contact=contactFor(phone,fromId);
 return !contact?.blocked&&(!contact||contact.permissions[medium==='call'||medium==='voicemail'?'calls':medium]);
}
export function communicationDelayMinutes(s:State,sender:Entity,recipient:Entity|null){
 const services=[data(sender,'item').service,...(recipient?[data(recipient,'item').service]:[])];
 return services.includes('poor')?s.settings.communications.poorServiceDelayMinutes:services.includes('fair')?Math.max(2,s.settings.communications.smsDelayMinutes):s.settings.communications.smsDelayMinutes;
}
export function contactFor(phone:Entity,characterId:string|null,number=''){
 const item=data(phone,'item');
 return item.contacts.find(contact=>characterId?contact.characterId===characterId:Boolean(number)&&contact.number===number)??null;
}
export function touchContact(phone:Entity,characterId:string|null,number:string,at:string){
 const item=data(phone,'item'),contact=contactFor(phone,characterId,number);
 if(contact)contact.lastInteractionAt=at;
 phone.data=item as Entity['data'];
}
export function conversationThread(s:State,fromId:string,toId:string|null,number:string){
 const prior=s.entities.filter(entity=>entity.kind==='message'&&!entity.archived).map(entity=>data(entity,'message')).find(message=>message.threadId&&message.fromId===fromId&&message.toId===toId&&(!number||message.toNumber===number)||message.threadId&&message.toId===fromId&&message.fromId===toId&&(!number||message.fromNumber===number));
 return prior?.threadId??randomUUID();
}
export function phoneView(s:State,observerId:string){
 getEntity(s,observerId,'character');
 const view=observerView(s,observerId),phones=s.entities.filter(entity=>entity.kind==='item'&&!entity.archived&&canAccessPhone(entity,observerId));
 const accessibleIds=new Set(phones.map(phone=>phone.id));
 const messages=view.entities.filter(entity=>entity.kind==='message'&&(accessibleIds.has(String(entity.data.phoneId))||accessibleIds.has(String(entity.data.recipientPhoneId))));
 const socialPosts=view.entities.filter(entity=>entity.kind==='socialPost').sort((a,b)=>String(b.data.at).localeCompare(String(a.data.at)));
 const locations=view.entities.filter(entity=>entity.kind==='location').map(entity=>({id:entity.id,name:entity.name,description:entity.data.description,exits:entity.data.exits}));
 return {
  clock:s.clock,
  phones:phones.map(phone=>{const item=data(phone,'item'),apps=Object.fromEntries(Object.entries(item.phoneApps).map(([app,enabled])=>[app,enabled&&s.settings.campaign?.technology.features[app]!==false]));return {id:phone.id,name:phone.name,number:item.phoneNumber,type:item.phoneType,state:item.phoneState,condition:item.condition,battery:item.battery,batteryRequired:item.batteryRequired,service:item.service,apps,contacts:item.contacts.map(contact=>({...contact,savedName:contact.savedName||contact.label})),photoIds:item.mediaIds};}),
  messages:messages.map(entity=>({id:entity.id,name:entity.name,...data(entity,'message')})).sort((a,b)=>a.at.localeCompare(b.at)),
  socialFeed:socialPosts.map(entity=>({id:entity.id,name:entity.name,...data(entity,'socialPost')})),
  map:{currentLocationId:data(getEntity(s,observerId,'character'),'character').locationId,locations}
 };
}
