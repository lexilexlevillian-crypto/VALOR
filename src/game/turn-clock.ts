import {matchesCondition} from './conditions.ts';
import {acceptsCommunication,phonePowered,recipientPhone} from './phone.ts';
import {data,type State} from './model.ts';

// Owners opt authored events into mandatory handoffs. Hidden candidate IDs are
// used only within simulation and never appear in player-facing results.
export function compressionLimit(s:State,actorId:string,requestedMinutes:number){
 const start=Date.parse(s.clock),end=start+requestedMinutes*60000;
 const candidates:Array<{at:number;priority:number;id:string}>=[];
 for(const entity of s.entities.filter(e=>!e.archived)){
  if(entity.kind==='watcher'){
   const w=data(entity,'watcher');
   if(w.requiresPlayerResponse&&!w.suppressed&&!(w.once&&w.fired)&&w.trigger==='time'&&w.dueAt&&w.notifyCharacterIds.includes(actorId)){
    const at=Date.parse(w.dueAt),atState={...s,clock:w.dueAt};
    const conditions=w.conditions.map(c=>matchesCondition(atState,c));
    if(conditions.length&&!(w.conditionMode==='all'?conditions.every(Boolean):conditions.some(Boolean)))continue;
    if(w.lastFired&&at-Date.parse(w.lastFired)<w.cooldownMinutes*60000)continue;
    if(at>start&&at<=end&&(!w.expiresAt||at<=Date.parse(w.expiresAt)))candidates.push({at,priority:w.priority,id:entity.id});
   }
  }
  if(entity.kind==='message'){
   const m=data(entity,'message');
   if(m.requiresPlayerResponse&&m.toId===actorId&&['queued','sent'].includes(m.status)&&m.availableAt){
    const receiver=m.recipientPhoneId?s.entities.find(e=>e.id===m.recipientPhoneId&&!e.archived):recipientPhone(s,actorId,m.toNumber,m.medium);
    if(!receiver||!phonePowered(receiver,true)||!acceptsCommunication(receiver,m.fromId,m.medium))continue;
    const at=Date.parse(m.availableAt);if(at>start&&at<=end)candidates.push({at,priority:0,id:entity.id});
   }
  }
 }
 candidates.sort((a,b)=>a.at-b.at||b.priority-a.priority||a.id.localeCompare(b.id));
 const first=candidates[0];
 return {minutes:first?(first.at-start)/60000:requestedMinutes,interrupted:Boolean(first),candidateIds:candidates.filter(c=>c.at===first?.at).map(c=>c.id)};
}
