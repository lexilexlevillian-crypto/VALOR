import {data} from './model.ts';
import type {State,Data} from './model.ts';
export function matchesCondition(s:State,c:Data<'watcher'>['conditions'][number]){
 const subject=s.entities.find(e=>e.id===c.subjectId&&!e.archived);
 if(c.kind!=='time'&&!subject)return false;
 let value=false;
 switch(c.kind){
  case 'time':value=!!c.at&&Date.parse(c.at)<=Date.parse(s.clock);break;
  case 'location':value=subject!.data.locationId===c.targetId;break;
  case 'item':value=subject!.kind==='item'&&subject!.data.ownerId===c.targetId&&Number(subject!.data.quantity)>0;break;
  case 'relationship':value=subject!.kind==='relationship'&&Number(subject!.data.trust)>=c.threshold;break;
  case 'health':value=subject!.kind==='character'&&Number(subject!.data.blood)<=c.threshold;break;
  case 'quest':value=subject!.kind==='quest'&&subject!.data.status==='active';break;
  case 'evidence':value=subject!.kind==='evidence'&&!subject!.data.destroyed&&data(subject!,'evidence').discoveredBy.includes(c.targetId??'');break;
  case 'knowledge':value=s.knowledge.some(k=>k.observerId===c.subjectId&&s.facts.some(f=>f.id===k.factId&&f.subjectId===c.targetId&&!f.retiredAt));break;
 }
 return c.negate?!value:value;
}
