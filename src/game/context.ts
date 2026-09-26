import {observerView,retrieve} from './epistemics.ts';
import type {State} from './model.ts';
export type ContextSource={id:string;layer:'fact'|'belief'|'memory'|'lore';text:string;source:string};
export function contextBrief(s:State,observerId:string,query:string,byteLimit=4000){
 const view=observerView(s,observerId),retrieved=retrieve(s,observerId,query,12);
 const limit=Math.max(256,Math.min(16000,byteLimit));
 const result:{version:number;observerId:string;clock:string;sources:ContextSource[];omitted:number}={version:1,observerId,clock:s.clock,sources:[],omitted:0};
 const candidates:ContextSource[]=[
  ...view.facts.slice(-20).map(f=>({id:f.id,layer:'fact' as const,text:f.predicate+': '+JSON.stringify(f.value),source:f.eventId})),
  ...retrieved.sources.map(r=>({id:r.id,layer:'lore' as const,text:r.name+': '+String(r.text),source:r.source})),
  ...retrieved.beliefs.map(b=>({id:b.id,layer:'belief' as const,text:b.proposition+' (confidence '+b.confidence+'; '+(b.correctedBy?'corrected':'unverified')+')',source:b.source})),
  ...retrieved.memories.map(m=>({id:m.id,layer:'memory' as const,text:m.text,source:m.eventId}))
 ];
 const seen=new Set<string>();
 for(const candidate of candidates){
  if(seen.has(candidate.text)){result.omitted++;continue;}seen.add(candidate.text);
  result.sources.push(candidate);
  if(Buffer.byteLength(JSON.stringify(result))>limit-16){result.sources.pop();result.omitted++;}
 }
 return result;
}
