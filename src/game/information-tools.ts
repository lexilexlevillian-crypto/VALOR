import {z} from 'zod';
import {randomUUID} from 'node:crypto';
import type {FastifyInstance} from 'fastify';
import type {Actor} from '../contracts.ts';
import {Fault} from '../contracts.ts';
import type {Game} from './engine.ts';
import {information,retconImpact,informationHash} from './information.ts';
import {secretSchema,identityKnowledgeSchema,spatialKnowledgeSchema,interpretationSchema,knowledgePackageSchema} from './information-extensions.ts';
import {authorSecret,grantInformation,revealSecretFacet,declassifyFacet,changeRecordAccess,learnIdentity,learnSpatial,interpretObservation,authorKnowledgePackage,grantKnowledgePackage,repairAcquisition,queryInformation,contextTiers,extendedDiagnostics,copyInformationRecord} from './information-operations.ts';

export function informationTools(app:FastifyInstance,game:Game,actor:(r:object)=>Actor,key:(headers:Record<string,unknown>)=>string){
 const base='/game/timelines/:id/information',id=z.uuid(),ids=z.array(id).max(10000),params=z.strictObject({id}),revision=z.number().int().positive();
 const safe=async(fn:()=>unknown)=>{try{return await fn();}catch(e){if(e instanceof Error&&/^[a-z_]+$/.test(e.message))throw new Fault(400,e.message);throw e;}};
 const downstream=async(timelineId:string,sourceIds:string[])=>{const rows=await game.store.all<{event_id:string;context_json:string}>('SELECT c.event_id,c.context_json FROM turn_narrative_contexts c JOIN game_events e ON e.id=c.event_id WHERE e.timeline_id=?',timelineId);return rows.filter(row=>sourceIds.some(id=>row.context_json.includes(id))).map(row=>row.event_id);};
 app.get(base+'/query',async r=>safe(async()=>{const {id:tid}=params.parse(r.params),q=z.strictObject({characterId:id,kind:z.enum(['know','remember','observed','where','why']),query:z.string().max(1000).default('')}).parse(r.query);await game.authorizeCharacter(actor(r),tid,q.characterId);return queryInformation(await game.load(tid),q.characterId,q.kind,q.query);}));
 app.get(base+'/inspect',async r=>safe(async()=>{const {id:tid}=params.parse(r.params),q=z.strictObject({characterId:id}).parse(r.query);await game.access(actor(r),tid,true);const s=await game.load(tid);return {viewAs:queryInformation(s,q.characterId,'know',''),recall:queryInformation(s,q.characterId,'remember',''),tiers:contextTiers(s,q.characterId),...extendedDiagnostics(s)};}));
 app.get(base+'/calls',async r=>safe(async()=>{const {id:tid}=params.parse(r.params);await game.access(actor(r),tid,true);return game.store.all('SELECT id,viewer_id AS viewerId,purpose,state_version AS stateVersion,event_cursor AS eventCursor,created_at AS createdAt FROM information_context_manifests WHERE timeline_id=? ORDER BY rowid DESC LIMIT 100',tid);}));
 app.post(base+'/replay',async r=>safe(async()=>{
  const {id:tid}=params.parse(r.params);await game.access(actor(r),tid,true);const b=z.strictObject({callId:id,omitIds:ids.default([]),tokenBudget:z.number().int().min(256).max(16000).optional()}).parse(r.body),row=await game.store.get<{manifest_json:string}>('SELECT manifest_json FROM information_context_manifests WHERE timeline_id=? AND id=?',tid,b.callId);if(!row)throw new Fault(404,'context_unavailable');
  const original=JSON.parse(row.manifest_json),replay=structuredClone(original),required=new Set(original.manifest.requiredRecordIds??original.bundle.sections.filter((s:{category:string})=>['state','event'].includes(s.category)).map((s:{id:string})=>s.id));
  if(b.omitIds.some(id=>required.has(id)))throw new Fault(400,'required_context_cannot_be_removed');replay.bundle.sections=replay.bundle.sections.filter((s:{id:string})=>!b.omitIds.includes(s.id));const budget=b.tokenBudget??original.manifest.totalTokenBudget;
  while(Buffer.byteLength(JSON.stringify(replay.bundle))>budget){const index=replay.bundle.sections.findLastIndex((s:{id:string})=>!required.has(s.id));if(index<0)break;replay.bundle.sections.splice(index,1);}
  replay.manifest.finalEstimatedTokens=Buffer.byteLength(JSON.stringify(replay.bundle));replay.manifest.ready=replay.manifest.finalEstimatedTokens<=budget&&original.manifest.ready;replay.manifest.totalTokenBudget=budget;replay.manifest.noncanonical=true;replay.manifest.replayedFrom=b.callId;replay.manifest.replayChecksum=informationHash(replay.bundle);
  return replay;
 }));
 app.post(base+'/repair-preview',async r=>safe(async()=>{const {id:tid}=params.parse(r.params);await game.access(actor(r),tid,true);const b=z.strictObject({entryId:id}).parse(r.body),s=await game.load(tid),entry=information(s).entries.find(e=>e.id===b.entryId);if(!entry)throw new Fault(404,'information_unavailable');const impact=retconImpact(s,[b.entryId]);return {entry,impact,committedEventIds:await downstream(tid,[b.entryId,entry.propositionId,...Object.values(impact).flat()]),historyWillBePreserved:true};}));
 const command=z.discriminatedUnion('operation',[
  z.strictObject({operation:z.literal('secret'),value:secretSchema}),z.strictObject({operation:z.literal('grant'),characterId:id,propositionId:id,text:z.string().max(16000),type:z.enum(['knowledge','belief'])}),
  z.strictObject({operation:z.literal('reveal-facet'),characterId:id,facetId:id}),z.strictObject({operation:z.literal('declassify'),facetId:id}),
  z.strictObject({operation:z.literal('access'),recordId:id,patch:z.strictObject({scope:z.enum(['public','private','institution','faction']).optional(),allowedCharacterIds:ids.optional(),sealed:z.boolean().optional()})}),
  z.strictObject({operation:z.literal('identity'),value:identityKnowledgeSchema}),z.strictObject({operation:z.literal('spatial'),value:spatialKnowledgeSchema}),z.strictObject({operation:z.literal('interpretation'),value:interpretationSchema}),
  z.strictObject({operation:z.literal('package'),value:knowledgePackageSchema}),z.strictObject({operation:z.literal('grant-package'),characterId:id,packageId:id}),
  z.strictObject({operation:z.literal('repair'),entryId:id,reason:z.string().min(1).max(1000)}),z.strictObject({operation:z.literal('copy-record'),characterId:id,recordId:id})
 ]);
 app.post(base+'/operations',async r=>safe(async()=>{const {id:tid}=params.parse(r.params),b=z.strictObject({revision,command}).parse(r.body);return game.mutate(actor(r),tid,b.revision,key(r.headers),b,'creator.information.operation',true,async(s,eventId)=>{const c=b.command;let result:unknown;
  if(c.operation==='secret')result=authorSecret(s,c.value);if(c.operation==='grant')result=grantInformation(s,c.characterId,c.propositionId,c.text,eventId,c.type);if(c.operation==='reveal-facet')result=revealSecretFacet(s,c.characterId,c.facetId,eventId,true);if(c.operation==='declassify')result=declassifyFacet(s,c.facetId,eventId);if(c.operation==='access')result=changeRecordAccess(s,c.recordId,c.patch,eventId);
  if(c.operation==='identity')result=learnIdentity(s,c.value);if(c.operation==='spatial')result=learnSpatial(s,c.value);if(c.operation==='interpretation')result=interpretObservation(s,c.value);if(c.operation==='package')result=authorKnowledgePackage(s,c.value);if(c.operation==='grant-package')result=grantKnowledgePackage(s,c.characterId,c.packageId,eventId);if(c.operation==='copy-record')result=copyInformationRecord(s,c.characterId,c.recordId,eventId);
  if(c.operation==='repair'){const entry=information(s).entries.find(e=>e.id===c.entryId);if(!entry)throw new Fault(404,'information_unavailable');const impact=retconImpact(s,[c.entryId]);result=repairAcquisition(s,c.entryId,c.reason,eventId,await downstream(tid,[c.entryId,entry.propositionId,...Object.values(impact).flat()]));}
  return {result:{operation:c.operation,value:result}};
 });}));
}
