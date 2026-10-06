import {simulationId as randomUUID,withTurnRuntime} from './turn-runtime.ts';
import {z} from 'zod';
import type {FastifyInstance} from 'fastify';
import type {Actor} from '../contracts.ts';
import {Fault} from '../contracts.ts';
import type {Game} from './engine.ts';
import {informationPurposeSchema,propositionSchema,informationRecordSchema,transmissionSchema,observationSchema,activeInformationSchema} from './information-contracts.ts';
import {information,informationProjection,playerInformationProjection,informationDiagnostics,authorInformation,researchInformation,addProposition,addInformationRecord,transmitInformation,exposeTransmission,recordObservation,retconImpact,syncInformation,cohortAwareness,instantiateCohortAwareness} from './information.ts';
import {buildInformationContext,rebuildInformationSummary} from './information-context.ts';
import {advance} from './simulation.ts';
import type {Effect} from './simulation.ts';
import {reviseActiveInformation} from './information.ts';

export function informationRoutes(app:FastifyInstance,game:Game,actor:(r:object)=>Actor,key:(headers:Record<string,unknown>)=>string){
 const path='/game/timelines/:id/information',params=z.strictObject({id:z.uuid()}),revision=z.number().int().positive(),characterId=z.uuid();
 const safe=async<T>(fn:()=>T|Promise<T>)=>{try{return await fn();}catch(e){if(e instanceof Fault||e instanceof z.ZodError)throw e;if(e instanceof Error&&/^[a-z_]+$/.test(e.message))throw new Fault(400,e.message);throw e;}};
 app.post(path+'/active/:recordId',async r=>safe(async()=>{const {id,recordId}=z.strictObject({id:z.uuid(),recordId:z.uuid()}).parse(r.params),b=z.strictObject({revision,characterId,status:activeInformationSchema.shape.status.optional(),confidence:z.number().min(0).max(1).optional(),sourceIds:z.array(z.uuid()).max(100).optional(),contradictsIds:z.array(z.uuid()).max(100).optional()}).parse(r.body);await game.authorizeCharacter(actor(r),id,b.characterId);return game.mutate(actor(r),id,b.revision,key(r.headers),b,'information.revised',false,async s=>{await game.authorizeCharacter(actor(r),id,b.characterId);const {revision,characterId,...patch}=b;return {result:{entry:reviseActiveInformation(s,characterId,recordId,patch)}};});}));
 app.get(path,async r=>safe(async()=>{const {id}=params.parse(r.params),q=z.strictObject({characterId,query:z.string().max(1000).default(''),offset:z.coerce.number().int().min(0).default(0),limit:z.coerce.number().int().min(1).max(100).default(100)}).parse(r.query);await game.authorizeCharacter(actor(r),id,q.characterId);const s=await game.load(id);syncInformation(s);return playerInformationProjection(s,q.characterId,q.query,q.offset,q.limit);}));
 app.post(path+'/author',async r=>safe(async()=>{const {id}=params.parse(r.params),b=z.strictObject({revision,characterId,kind:z.enum(['belief','note','ooc-note','hypothesis','lead']),text:z.string().min(1).max(16000),sourceIds:z.array(z.uuid()).max(100).default([]),confidence:z.number().min(0).max(1).default(0.5)}).parse(r.body);await game.authorizeCharacter(actor(r),id,b.characterId);return game.mutate(actor(r),id,b.revision,key(r.headers),b,'information.authored',false,async(s,eventId)=>{await game.authorizeCharacter(actor(r),id,b.characterId);return {result:{entry:authorInformation(s,b.characterId,b,eventId)}};});}));
 app.post(path+'/research',async r=>safe(async()=>{const {id}=params.parse(r.params),b=z.strictObject({revision,characterId,query:z.string().min(1).max(1000),depth:z.enum(['quick','standard','thorough']).default('standard')}).parse(r.body);await game.authorizeCharacter(actor(r),id,b.characterId);return game.mutate(actor(r),id,b.revision,key(r.headers),b,'information.researched',false,async(s,eventId,seed)=>{await game.authorizeCharacter(actor(r),id,b.characterId);return withTurnRuntime(seed,eventId,s,'information',()=>{const result=researchInformation(s,b.characterId,b.query,b.depth),effects:Effect[]=[];advance(s,result.minutes,eventId,effects,b.characterId);effects.push({id:randomUUID(),type:'information.researched',subjectId:b.characterId,observers:[b.characterId],text:result.records.length?'Read '+result.records.length+' accessible source records: '+result.records.map(record=>record.title).join('; ')+'. Source claims remain unverified.':result.meaning});return {result,effects,characterId:b.characterId,turnText:b.query};});});}));
 app.get(path+'/diagnostics',async r=>safe(async()=>{const {id}=params.parse(r.params);await game.access(actor(r),id,true);const s=await game.load(id);syncInformation(s);return informationDiagnostics(s);}));
 app.post(path+'/retcon-preview',async r=>safe(async()=>{const {id}=params.parse(r.params);await game.access(actor(r),id,true);const b=z.strictObject({sourceIds:z.array(z.uuid()).min(1).max(100)}).parse(r.body);return {dryRun:true,...retconImpact(await game.load(id),b.sourceIds)};}));
 app.get(path+'/context',async r=>safe(async()=>{const {id}=params.parse(r.params),q=z.strictObject({characterId,purpose:informationPurposeSchema.default('knowledge-query'),query:z.string().max(2000).default('')}).parse(r.query),{t}=await game.access(actor(r),id,true),cursor=await game.store.get<{cursor:string}>('SELECT cursor FROM timeline_turn_cursors WHERE timeline_id=?',id),s=await game.load(id);syncInformation(s);const result=buildInformationContext(s,{campaignId:t.campaign_id,timelineId:id,viewerId:q.characterId,stateVersion:t.revision,eventCursor:cursor!.cursor},q.purpose,q.query);await game.store.run('INSERT INTO information_context_manifests VALUES (?,?,?,?,?,?,?,?)',result.manifest.callId,id,q.characterId,q.purpose,t.revision,cursor!.cursor,JSON.stringify(result),new Date().toISOString());return result;}));
 const command=z.discriminatedUnion('operation',[
  z.strictObject({operation:z.literal('proposition'),value:propositionSchema}),z.strictObject({operation:z.literal('record'),value:informationRecordSchema}),z.strictObject({operation:z.literal('transmission'),value:transmissionSchema}),z.strictObject({operation:z.literal('observation'),value:observationSchema}),z.strictObject({operation:z.literal('active'),value:activeInformationSchema}),
  z.strictObject({operation:z.literal('exposure'),id:z.uuid(),characterId,delivered:z.boolean(),exposed:z.boolean(),comprehension:z.number().min(0).max(1),acceptance:z.number().min(0).max(1),fragment:z.string().max(1000).optional()}),
  z.strictObject({operation:z.literal('summary'),characterId,level:z.enum(['scene','thread','relationship','character','campaign']),key:z.string().max(200),sourceIds:z.array(z.uuid()).max(10000)}),
  z.strictObject({operation:z.literal('cohort'),id:z.uuid(),label:z.string().max(200),transmissionIds:z.array(z.uuid()).max(10000),exposure:z.number().min(0).max(1)}),z.strictObject({operation:z.literal('cohort-exposure'),cohortId:z.uuid(),characterId}),z.strictObject({operation:z.literal('invalidate')}),z.strictObject({operation:z.literal('canary'),text:z.string().min(8).max(1000),aliases:z.array(z.string().min(3).max(1000)).max(20)})
 ]);
 app.post(path+'/developer',async r=>safe(async()=>{const {id}=params.parse(r.params),b=z.strictObject({revision,command}).parse(r.body);return game.mutate(actor(r),id,b.revision,key(r.headers),b,'creator.information',true,(s,eventId)=>{const c=b.command;let result:unknown;
  if(c.operation==='proposition')result=addProposition(s,c.value);
  if(c.operation==='record')result=addInformationRecord(s,c.value);
  if(c.operation==='transmission')result=transmitInformation(s,c.value);
  if(c.operation==='observation')result=recordObservation(s,c.value);
  if(c.operation==='exposure')result=exposeTransmission(s,c.id,c.characterId,c);
  if(c.operation==='active'){const i=information(s),old=i.active.find(a=>a.id===c.value.id);if(old){const history=[...(old.history??[]),{at:s.clock,status:old.status,confidence:old.confidence,sourceIds:old.sourceIds,contradictsIds:old.contradictsIds}];i.active[i.active.indexOf(old)]={...c.value,history};}else i.active.push(c.value);result=c.value;}
  if(c.operation==='summary')result=rebuildInformationSummary(s,c.characterId,c.level,c.key,c.sourceIds,eventId);
  if(c.operation==='cohort')result=cohortAwareness(s,{id:c.id,label:c.label,transmissionIds:c.transmissionIds,exposure:c.exposure});
  if(c.operation==='cohort-exposure')result=instantiateCohortAwareness(s,c.cohortId,c.characterId);
  if(c.operation==='invalidate'){information(s).summaries=[];information(s).generation++;result={invalidated:true,rebuildable:true};}
  if(c.operation==='canary'){const canary={id:randomUUID(),text:c.text,aliases:c.aliases};information(s).canaries.push(canary);result={id:canary.id};}
  return {result:{information:result}};
 });}));
}
