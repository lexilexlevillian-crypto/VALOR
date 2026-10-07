import {z} from 'zod';
import type {FastifyInstance} from 'fastify';
import {Fault,type Actor} from '../contracts.ts';
import type {Game} from './engine.ts';
import {memoryMutationTypeSchema} from './memory-contracts.ts';
import {formObservationMemory,formInformationMemory,formExperiencedMemory,recallMemories,inspectMemories,mutateMemory,consolidateMemories,rebuildMemories} from './memory.ts';
import {recallInformation} from './information-operations.ts';
import {information,retconImpact} from './information.ts';

export function memoryRoutes(app:FastifyInstance,game:Game,actor:(r:object)=>Actor,key:(headers:Record<string,unknown>)=>string){
 const id=z.uuid(),params=z.strictObject({id}),base='/game/timelines/:id/memory',revision=z.number().int().positive();
 const safe=async(fn:()=>unknown)=>{try{return await fn();}catch(e){if(e instanceof Fault||e instanceof z.ZodError)throw e;if(e instanceof Error&&/^[a-z_]+$/.test(e.message))throw new Fault(400,e.message);throw e;}};
 app.get(base+'/recall',async r=>safe(async()=>{const {id:tid}=params.parse(r.params),q=z.strictObject({characterId:id,query:z.string().max(1000).default('')}).parse(r.query);await game.authorizeCharacter(actor(r),tid,q.characterId);return recallInformation(await game.load(tid),q.characterId,q.query);}));
 app.get(base+'/inspect',async r=>safe(async()=>{const {id:tid}=params.parse(r.params),q=z.strictObject({characterId:id,offset:z.coerce.number().int().nonnegative().default(0)}).parse(r.query);await game.access(actor(r),tid,true);return inspectMemories(await game.load(tid),q.characterId,q.offset);}));
 app.post(base+'/anchor',async r=>safe(async()=>{const {id:tid}=params.parse(r.params),b=z.strictObject({revision,characterId:id,memoryId:id}).parse(r.body);await game.authorizeCharacter(actor(r),tid,b.characterId);return game.mutate(actor(r),tid,b.revision,key(r.headers),b,'memory.anchor',false,(s,eventId)=>({result:{mutation:mutateMemory(s,b.characterId,b.memoryId,'anchor',eventId,{reason:'Player explicitly marked an existing experience as significant'})}}));}));
 app.post(base+'/recall',async r=>safe(async()=>{const {id:tid}=params.parse(r.params),b=z.strictObject({revision,characterId:id,query:z.string().max(1000).default('')}).parse(r.body);await game.authorizeCharacter(actor(r),tid,b.characterId);return game.mutate(actor(r),tid,b.revision,key(r.headers),b,'memory.recall',false,(s,eventId)=>{const recalled=recallMemories(s,b.characterId,{query:b.query,explicit:true});for(const row of recalled)if(s.memories.find(m=>m.id===row.id)?.cognition)mutateMemory(s,b.characterId,row.id,'reinforce',eventId);return {result:recallInformation(s,b.characterId,b.query)};});}));
 const command=z.discriminatedUnion('operation',[
  z.strictObject({operation:z.literal('grant'),characterId:id,sourceId:id.optional(),backstory:z.string().min(1).max(16000).optional()}),
  z.strictObject({operation:z.literal('mutate'),characterId:id,memoryId:id,type:memoryMutationTypeSchema,causeId:id.optional(),interpretation:z.string().max(16000).optional(),confidence:z.number().min(0).max(1).optional(),reason:z.string().max(2000).default('Creator memory maintenance')}),
  z.strictObject({operation:z.literal('consolidate'),characterId:id}),z.strictObject({operation:z.literal('rebuild'),characterId:id}),
 ]);
 app.post(base+'/developer',async r=>safe(async()=>{const {id:tid}=params.parse(r.params),b=z.strictObject({revision,command}).parse(r.body);return game.mutate(actor(r),tid,b.revision,key(r.headers),b,'creator.memory',true,async(s,eventId)=>{
  const c=b.command;let result:unknown;
  if(c.operation==='grant'){
   if(Boolean(c.sourceId)===Boolean(c.backstory))throw new Error('memory_source_or_explicit_backstory_required');
   if(c.backstory)result=formExperiencedMemory(s,{ownerId:c.characterId,eventId,text:c.backstory,kind:'authored-backstory',sourceKind:'authored-backstory',salience:0.7});
   else{const o=s.information?.observations.find(o=>o.id===c.sourceId&&o.observerId===c.characterId),e=s.information?.entries.find(e=>e.id===c.sourceId&&e.characterId===c.characterId&&e.status==='active');if(o)result=formObservationMemory(s,o);else if(e)result=formInformationMemory(s,e);else throw new Error('memory_source_unavailable');}
  }
  if(c.operation==='mutate'){
   const impact=retconImpact(s,[c.memoryId]),affectedIds=[c.memoryId,...Object.values(impact).flat()],contexts=c.type==='invalidate'?await game.store.all<{event_id:string;context_json:string}>('SELECT c.event_id,c.context_json FROM turn_narrative_contexts c JOIN game_events e ON e.id=c.event_id WHERE e.timeline_id=?',tid):[],committedEventIds=contexts.filter(row=>affectedIds.some(id=>row.context_json.includes(id))).map(row=>row.event_id);
   result=mutateMemory(s,c.characterId,c.memoryId,c.type,c.causeId??eventId,{...c,committedEventIds});
   if(c.type==='invalidate'){const i=information(s);i.invalidatedNodeIds=[...new Set([...i.invalidatedNodeIds,...affectedIds])];for(const entry of i.entries)if(affectedIds.includes(entry.id))entry.status='invalidated';i.summaries=i.summaries.filter(summary=>!affectedIds.includes(summary.id));result={mutation:result,impact,committedEventIds,historyDecision:'Committed events are preserved; Creator may branch or retcon explicitly.'};}
  }
  if(c.operation==='consolidate')result={memoryIds:consolidateMemories(s,c.characterId).map(m=>m.id)};
  if(c.operation==='rebuild')result=rebuildMemories(s,c.characterId);
  return {result:{memory:result}};
 });}));
}
