import {data} from './model.ts';
import type {State,Data} from './model.ts';
export function matchesCondition(s:State,c:Data<'watcher'>['conditions'][number]){
 const subject=s.entities.find(e=>e.id===c.subjectId&&!e.archived);
 if(!['time','fact','world'].includes(c.kind)&&!subject)return false;
 let value=false;
 switch(c.kind){
  case 'time':value=!!c.at&&Date.parse(c.at)<=Date.parse(s.clock);break;
  case 'location':value=subject!.data.locationId===c.targetId;break;
  case 'item':value=subject!.kind==='item'&&subject!.data.ownerId===c.targetId&&Number(subject!.data.quantity)>0;break;
  case 'relationship':value=subject!.kind==='relationship'&&Number(subject!.data.trust)>=c.threshold;break;
  case 'health':value=subject!.kind==='character'&&Number(subject!.data.blood)<=c.threshold;break;
  case 'quest':case 'event':value=subject!.kind==='quest'&&(!c.state?subject!.data.status==='active':subject!.data.state===c.state||subject!.data.status===c.state);break;
  case 'evidence':value=subject!.kind==='evidence'&&!subject!.data.destroyed&&data(subject!,'evidence').discoveredBy.includes(c.targetId??'');break;
  case 'knowledge':value=s.knowledge.some(k=>k.observerId===c.subjectId&&s.facts.some(f=>f.id===k.factId&&f.subjectId===c.targetId&&!f.retiredAt));break;
  case 'fact':value=s.facts.some(f=>(!c.subjectId||f.subjectId===c.subjectId)&&(!c.targetId||f.objectId===c.targetId)&&(!c.predicate||f.predicate===c.predicate)&&f.retiredAt===null&&(c.value===null||JSON.stringify(f.value)===JSON.stringify(c.value)));break;
  case 'world':value=c.predicate==='event-recorded'?s.eventIds?.includes(String(c.value))===true:c.predicate==='entity-exists'?!!c.targetId&&s.entities.some(entity=>entity.id===c.targetId&&!entity.archived):false;break;
 }
 return c.negate?!value:value;
}
