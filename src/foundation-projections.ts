import {observerView} from './game/epistemics.ts';
import type {State} from './game/model.ts';

type ChronicleEntry={
 id:string;character_id:string;user_id:string;input_text:string;narration:string;
 narration_status:string;created_at:string;source_event_id:string;notices_json:string;scene_json:string;
};

// Rebuildable, observer-scoped read models. Canonical authority remains in State
// and immutable history; callers never need to maintain client-owned truth.
export function buildFoundationProjections(state:State,observerId:string,chronicle:ChronicleEntry[]){
 const view=observerView(state,observerId),entities=view.entities;
 const byId=new Map(entities.map(entity=>[entity.id,entity]));
 const ownCharacter=byId.get(observerId);
 const ownedItems=entities.filter(entity=>entity.kind==='item'&&(
  entity.data.ownerId===observerId||
  typeof entity.data.containerId==='string'&&byId.get(entity.data.containerId)?.data.ownerId===observerId
 ));
 const phones=ownedItems.filter(entity=>entity.data.category==='phone');
 const messages=entities.filter(entity=>entity.kind==='message'&&(entity.data.fromId===observerId||entity.data.toId===observerId));
 const locations=entities.filter(entity=>entity.kind==='location');
 const cases=entities.filter(entity=>entity.kind==='case');
 const evidence=entities.filter(entity=>entity.kind==='evidence');
 const characters=entities.filter(entity=>entity.kind==='character');
 return {
  schemaVersion:1,
  timeline:{clock:view.clock,calendar:view.calendar},
  chronicle:{
   entries:chronicle.filter(entry=>entry.character_id===observerId).slice(-100).map(entry=>({
    id:entry.id,input:entry.input_text,narration:entry.narration,status:entry.narration_status,
    createdAt:entry.created_at,sourceEventId:entry.source_event_id,
    notices:JSON.parse(entry.notices_json),scene:JSON.parse(entry.scene_json)
   }))
  },
  roster:{
   characters:characters.map(character=>({
    id:character.id,name:character.name,description:character.data.description??'',
    condition:character.data.condition??null,locationId:character.data.locationId??null,
    playable:Boolean(character.data.playable),self:character.id===observerId
   }))
  },
  phoneInbox:{
   phones:phones.map(phone=>({id:phone.id,name:phone.name,contacts:phone.data.contacts??[]})),
   messages:messages.map(message=>({
    id:message.id,fromId:message.data.fromId,toId:message.data.toId,phoneId:message.data.phoneId,
    body:message.data.body,medium:message.data.medium??'sms',status:message.data.status??'delivered',
    at:message.data.at
   })).sort((a,b)=>String(a.at).localeCompare(String(b.at)))
  },
  inventory:{
   ownerId:observerId,cash:ownCharacter?.data.cash??null,
   items:ownedItems.map(item=>({id:item.id,name:item.name,category:item.data.category??'object',
    quantity:item.data.quantity??1,equipped:Boolean(item.data.equipped),containerId:item.data.containerId??null}))
  },
  map:{
   currentLocationId:ownCharacter?.data.locationId??null,
   locations:locations.map(location=>({id:location.id,name:location.name,description:location.data.description??'',
    exits:location.data.exits??[]}))
  },
  caseFile:{
   cases:cases.map(file=>({id:file.id,name:file.name,...file.data})),
   evidence:evidence.map(item=>({id:item.id,name:item.name,...item.data}))
  },
  npcProfile:{
   characters:characters.filter(character=>character.id!==observerId).map(character=>({
    id:character.id,name:character.name,description:character.data.description??'',condition:character.data.condition??null,
    locationId:character.data.locationId??null,appearance:character.data.appearance??null,
    sections:character.data.sections??[]
   }))
  }
 };
}

export type FoundationProjections=ReturnType<typeof buildFoundationProjections>;
