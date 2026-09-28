import {z} from 'zod';
import {observerView} from './epistemics.ts';
import type {Entity,State} from './model.ts';

export const chronicleNoticeSchema=z.strictObject({
 category:z.enum(['time','items','health','money','contacts','relationships','cases','messages','clues','combat']),
 label:z.string().min(1).max(120),detail:z.string().min(1).max(1000)
});
export const chronicleSceneSchema=z.strictObject({clock:z.iso.datetime(),locationId:z.uuid().nullable(),locationName:z.string().max(160).nullable()});
export type ChronicleNotice=z.infer<typeof chronicleNoticeSchema>;
export type ChronicleScene=z.infer<typeof chronicleSceneSchema>;

const entities=(state:ReturnType<typeof observerView>)=>new Map(state.entities.map(entity=>[entity.id,entity]));
const names=(rows:Entity[])=>rows.map(row=>row.name).slice(0,4).join(', ')+(rows.length>4?` and ${rows.length-4} more`:'');
const amount=(cents:number)=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(cents/100);
const changed=(a:unknown,b:unknown)=>JSON.stringify(a)!==JSON.stringify(b);

// Both sides are projected through the same observer before comparison. A notice
// can therefore never disclose data that the character could not see at that turn.
export function chroniclePresentation(before:State,after:State,observerId:string):{scene:ChronicleScene;notices:ChronicleNotice[]}{
 const afterView=observerView(after,observerId),afterById=entities(afterView),self=afterById.get(observerId);
 const locationId=typeof self?.data.locationId==='string'?self.data.locationId:null;
 const scene=chronicleSceneSchema.parse({clock:afterView.clock,locationId,locationName:locationId?afterById.get(locationId)?.name??null:null});
 if(!before.entities.some(entity=>entity.id===observerId&&entity.kind==='character'&&!entity.archived))return {scene,notices:[]};
 const beforeView=observerView(before,observerId),beforeById=entities(beforeView),oldSelf=beforeById.get(observerId),notices:ChronicleNotice[]=[];
 const add=(category:ChronicleNotice['category'],label:string,detail:string)=>notices.push({category,label,detail});

 if(beforeView.clock!==afterView.clock){
  const minutes=Math.round((Date.parse(afterView.clock)-Date.parse(beforeView.clock))/60000);
  add('time','Time advanced',`${minutes>=0?'+':''}${minutes} min · ${new Date(afterView.clock).toLocaleString('en-US')}`);
 }
 const oldLocation=typeof oldSelf?.data.locationId==='string'?beforeById.get(oldSelf.data.locationId)?.name:null;
 if(oldLocation!==scene.locationName)add('time','Location changed',`${oldLocation??'Unknown'} → ${scene.locationName??'Unknown'}`);

 const owned=(rows:Entity[],id:string)=>rows.filter(entity=>entity.kind==='item'&&(entity.data.ownerId===id||typeof entity.data.containerId==='string'&&rows.some(container=>container.id===entity.data.containerId&&container.data.ownerId===id)));
 const oldItems=owned(beforeView.entities,observerId),newItems=owned(afterView.entities,observerId),oldItemIds=new Set(oldItems.map(item=>item.id)),newItemIds=new Set(newItems.map(item=>item.id));
 const acquired=newItems.filter(item=>!oldItemIds.has(item.id)),lost=oldItems.filter(item=>!newItemIds.has(item.id));
 if(acquired.length)add('items','Items acquired',names(acquired));
 if(lost.length)add('items','Items removed',names(lost));
 for(const item of newItems){const old=beforeById.get(item.id);if(old&&changed({quantity:old.data.quantity,equipped:old.data.equipped,condition:old.data.condition},{quantity:item.data.quantity,equipped:item.data.equipped,condition:item.data.condition}))add('items',item.name,'Quantity, equipment, or condition changed');}

 if(oldSelf&&self){
  const oldCash=Number(oldSelf.data.cash??0)+Number(oldSelf.data.bank??0),newCash=Number(self.data.cash??0)+Number(self.data.bank??0);
  if(oldCash!==newCash)add('money','Funds changed',`${newCash-oldCash>=0?'+':''}${amount(newCash-oldCash)} · ${amount(newCash)} total`);
  const healthKeys=['condition','blood','fatigue','hunger','thirst','hygiene','intoxication'] as const;
  const healthChanges=healthKeys.filter(key=>changed(oldSelf.data[key],self.data[key])).map(key=>`${key}: ${String(oldSelf.data[key]??'—')} → ${String(self.data[key]??'—')}`);
  if(healthChanges.length)add('health','Condition updated',healthChanges.join(' · '));
 }
 const newInjuries=afterView.entities.filter(entity=>entity.kind==='injury'),injuryChanges=newInjuries.filter(injury=>changed(beforeById.get(injury.id)?.data,injury.data));
 if(injuryChanges.length)add('health','Injuries updated',names(injuryChanges));

 const contacts=(rows:Entity[])=>new Map(rows.filter(entity=>entity.kind==='item'&&entity.data.category==='phone').flatMap(phone=>((phone.data.contacts??[]) as {characterId:string;label:string}[]).map(contact=>[`${phone.id}:${contact.characterId}`,contact.label] as const)));
 const oldContacts=contacts(beforeView.entities),newContacts=contacts(afterView.entities),contactAdds=[...newContacts].filter(([key])=>!oldContacts.has(key)).map(([,label])=>label);
 if(contactAdds.length)add('contacts','Contacts added',contactAdds.slice(0,5).join(', '));
 const contactRemovals=[...oldContacts].filter(([key])=>!newContacts.has(key)).map(([,label])=>label),contactRenames=[...newContacts].filter(([key,label])=>oldContacts.has(key)&&oldContacts.get(key)!==label).map(([,label])=>label);
 if(contactRemovals.length)add('contacts','Contacts removed',contactRemovals.slice(0,5).join(', '));
 if(contactRenames.length)add('contacts','Contacts updated',contactRenames.slice(0,5).join(', '));

 const changedVisible=(kind:Entity['kind'])=>afterView.entities.filter(entity=>entity.kind===kind&&changed(beforeById.get(entity.id)?.data,entity.data));
 const relationships=changedVisible('relationship');if(relationships.length)add('relationships','Relationship update',names(relationships));
 const cases=changedVisible('case');if(cases.length)add('cases','Case update',names(cases));
 const oldMessages=new Set(beforeView.entities.filter(entity=>entity.kind==='message').map(entity=>entity.id));
 const messages=afterView.entities.filter(entity=>entity.kind==='message'&&entity.data.toId===observerId&&!oldMessages.has(entity.id));if(messages.length)add('messages','New message',names(messages));
 const oldEvidence=new Set(beforeView.entities.filter(entity=>entity.kind==='evidence').map(entity=>entity.id));
 const evidence=afterView.entities.filter(entity=>entity.kind==='evidence'&&!oldEvidence.has(entity.id));
 const newFacts=afterView.facts.filter(record=>!beforeView.facts.some(old=>old.id===record.id));
 if(evidence.length||newFacts.length)add('clues','New information',evidence.length?names(evidence):`${newFacts.length} fact${newFacts.length===1?'':'s'} learned`);
 const combats=changedVisible('combat').filter(combat=>Array.isArray(combat.data.participants)&&combat.data.participants.includes(observerId));if(combats.length)add('combat','Combat changed',names(combats));
 return {scene,notices:z.array(chronicleNoticeSchema).max(50).parse(notices.slice(0,50))};
}
