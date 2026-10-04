import {z} from 'zod';
import type {FastifyInstance,FastifyRequest} from 'fastify';
import {Game} from './engine.ts';
import {geography} from './geography.ts';
import {SharedWorld} from './shared-world.ts';
import {dataSchemas,kinds,actionSchema,settingsSchema} from './model.ts';
import {id,name,Fault} from '../contracts.ts';
import type {Actor} from '../contracts.ts';
import {NarrativeGateway,GroundedProvider,JsonGatewayProvider} from './ai.ts';
import type {NarrativeProvider} from './ai.ts';
import {Readable} from 'node:stream';
import {directProviderIds,directProvidersFromEnvironment,preferredDirectProvider,preferredDirectProviderId} from './direct-provider.ts';
import {storyIntent} from './story-intent.ts';
import {IntentGateway} from './ai-intent.ts';
import {simulationTiers} from './simulation.ts';
export function gameRoutes(app:FastifyInstance,game:Game,actor:(r:object)=>Actor,key:(headers:Record<string,unknown>)=>string){
 const world=new SharedWorld(game);
 app.get('/game/lives',async r=>world.lives(actor(r)));
 app.post('/game/lives/:id/delete',async r=>{const p=z.strictObject({id}).parse(r.params);z.strictObject({confirmed:z.literal(true)}).parse(r.body);return world.setLifeDeleted(actor(r),p.id,true);});
 app.post('/game/lives/:id/restore',async r=>{const p=z.strictObject({id}).parse(r.params);z.strictObject({}).parse(r.body);return world.setLifeDeleted(actor(r),p.id,false);});
 app.get('/game/geography',async r=>{await game.domain.active(actor(r));return wrap(()=>geography(r.query));});
 app.get('/game/world',async r=>world.describe(actor(r)));
 app.post('/game/world/setup',async r=>{const b=z.strictObject({timelineId:id.optional()}).parse(r.body);return world.setup(actor(r),b.timelineId);});
 app.post('/game/world/life',async r=>{z.strictObject({}).parse(r.body);return world.enter(actor(r),key(r.headers));});
 const providers:NarrativeProvider[]=[new GroundedProvider(),...(process.env.AI_GATEWAY_URL&&process.env.AI_GATEWAY_SECRET?[new JsonGatewayProvider(process.env.AI_GATEWAY_URL,process.env.AI_GATEWAY_SECRET)]:[])];
 const directProviders=directProvidersFromEnvironment(),preferredProvider=preferredDirectProvider(directProviders);providers.push(...directProviders);
 app.post('/game/ai/health',async r=>{
  const user=await game.domain.active(actor(r));if(!['creator','admin'].includes(user.role))throw new Fault(403,'forbidden');
  const b=z.strictObject({provider:z.enum(directProviderIds).optional()}).parse(r.body),selected=b.provider?directProviders.find(provider=>provider.id===b.provider):preferredProvider,providerId=b.provider??preferredDirectProviderId(directProviders);
  if(!selected)return {status:'unconfigured',provider:providerId};
  const started=performance.now();try{return {...await selected.healthCheck(AbortSignal.timeout(12000)),latencyMs:Math.round(performance.now()-started)};}catch{return {status:'unavailable',provider:selected.id,latencyMs:Math.round(performance.now()-started),message:'The AI provider did not complete a valid test response. Check the server key, model, provider quota and connectivity.'};}
 });
 const ai=new NarrativeGateway(game,providers);
 const narrate=async(...args:Parameters<NarrativeGateway['narrate']>)=>{
  const result=await ai.narrate(...args);
  if(result.status==='grounded-fallback')app.log.warn({traceId:result.traceId,failureCode:'failureCode' in result?result.failureCode:undefined},'ai.narration_fallback');
  return result;
 };
 const intent=new IntentGateway(game,directProviders,ai.inflight);
 const timeline=(r:FastifyRequest)=>z.object({id}).parse(r.params).id;
 const bodyRevision=z.number().int().positive();
 const wrap=async(fn:()=>unknown)=>{try{return await fn();}catch(error){if(error instanceof Fault||error instanceof z.ZodError)throw error;if(error instanceof Error&&/^[a-z_]+$/.test(error.message))throw new Fault(400,error.message);throw error;}};
 app.get('/game/catalog',async r=>{actor(r);return {kinds,schemas:Object.fromEntries(kinds.map(k=>[k,z.toJSONSchema(dataSchemas[k])])),settings:z.toJSONSchema(settingsSchema),actions:actionSchema.options.map(option=>z.toJSONSchema(option)),simulationTiers,providers:providers.map(p=>p.id),defaultProvider:preferredProvider?.id??'grounded'};});
 app.get('/game/campaigns/:id/timelines',async r=>(await game.list(actor(r),timeline(r))));
 app.post('/game/campaigns/:id/timelines',async r=>(await game.initialize(actor(r),timeline(r))));
 app.get('/game/timelines/:id/roster',async r=>(await game.roster(actor(r),timeline(r))));
 app.get('/game/timelines/:id/creation-options',async r=>wrap(()=>game.creationOptions(actor(r),timeline(r))));
 app.get('/game/timelines/:id/start-packages',async r=>wrap(()=>game.startPackages(actor(r),timeline(r))));
 app.post('/game/timelines/:id/start-packages',async r=>{
  const b=z.strictObject({name,slug:z.string().trim().min(1).max(80).regex(/^[a-z0-9][a-z0-9._-]*$/),description:z.string().max(16000).default(''),kind:z.enum(['guided','freeform','template']),visibility:z.enum(['creator','campaign']).default('campaign'),status:z.enum(['draft','published','archived']).default('draft'),definition:z.unknown()}).parse(r.body);
  return wrap(()=>game.createStartPackage(actor(r),timeline(r),b,key(r.headers)));
 });
 app.post('/game/timelines/:id/start-packages/:packageId/duplicate',async r=>{
  const p=z.object({id,packageId:id}).parse(r.params),b=z.strictObject({name,slug:z.string().trim().min(1).max(80).regex(/^[a-z0-9][a-z0-9._-]*$/),visibility:z.enum(['creator','campaign']).optional(),status:z.enum(['draft','published']).optional()}).parse(r.body);
  return wrap(()=>game.duplicateStartPackage(actor(r),p.id,p.packageId,b,key(r.headers)));
 });
 app.post('/game/timelines/:id/start',async r=>{
  const b=z.strictObject({revision:bodyRevision,packageId:id.optional(),definition:z.unknown().optional(),choices:z.unknown().optional()}).refine(v=>Boolean(v.packageId)!==Boolean(v.definition),'one_start_source_required').parse(r.body);
  return wrap(()=>game.start(actor(r),timeline(r),b,key(r.headers)));
 });
 app.get('/game/timelines/:id/view',async r=>{const query=z.strictObject({characterId:id}).parse(r.query);return wrap(async ()=>(await game.view(actor(r),timeline(r),query.characterId)));});
 app.get('/game/timelines/:id/relationships',async r=>{const query=z.strictObject({characterId:id}).parse(r.query);return wrap(()=>game.relationships(actor(r),timeline(r),query.characterId));});
 app.get('/game/timelines/:id/phone',async r=>{const query=z.strictObject({characterId:id}).parse(r.query);return wrap(()=>game.phone(actor(r),timeline(r),query.characterId));});
 app.get('/game/timelines/:id/inventory',async r=>{const query=z.strictObject({characterId:id,sort:z.enum(['name','category','condition','quantity']).optional(),category:z.string().max(80).optional(),equipped:z.enum(['true','false']).transform(value=>value==='true').optional()}).parse(r.query);return wrap(()=>game.inventory(actor(r),timeline(r),query.characterId,query));});
 app.get('/game/timelines/:id/developer/social-graph',async r=>wrap(()=>game.socialGraph(actor(r),timeline(r))));
 app.get('/game/timelines/:id/projections',async r=>{const query=z.strictObject({characterId:id}).parse(r.query);return wrap(()=>game.projections(actor(r),timeline(r),query.characterId));});
 app.get('/game/timelines/:id/creator',async r=>(await game.creator(actor(r),timeline(r))));
 app.get('/game/timelines/:id/developer/overview',async r=>(await game.creator(actor(r),timeline(r))));
 app.get('/game/timelines/:id/character-profile-templates',async r=>wrap(()=>game.characterProfileTemplates(actor(r),timeline(r))));
 app.post('/game/timelines/:id/character-profile-templates',async r=>{const b=z.strictObject({name,characterId:id}).parse(r.body);return wrap(()=>game.createCharacterProfileTemplate(actor(r),timeline(r),b));});
 app.post('/game/timelines/:id/character-profile-templates/use',async r=>{const b=z.strictObject({revision:bodyRevision,templateId:id,characterId:id}).parse(r.body);return wrap(()=>game.useCharacterProfileTemplate(actor(r),timeline(r),b,key(r.headers)));});
 const optionalBoolean=z.enum(['true','false']).transform(value=>value==='true').optional();
 app.get('/game/timelines/:id/npcs',async r=>{
  const q=z.strictObject({query:z.string().max(160).optional(),status:z.enum(['active','inactive','missing','retired']).optional(),locationId:id.optional(),factionId:id.optional(),relationship:z.string().max(160).optional(),job:z.string().max(160).optional(),schedule:z.string().max(160).optional(),scheduled:optionalBoolean,tags:z.string().max(1000).optional(),visibility:z.enum(['creator','campaign','owner','knowledge']).optional(),alive:optionalBoolean,injured:optionalBoolean,arrested:optionalBoolean,lastActiveFrom:z.iso.datetime().optional(),lastActiveUntil:z.iso.datetime().optional(),archive:z.enum(['active','archived','all']).optional()}).parse(r.query);
  return wrap(()=>game.npcRegistry(actor(r),timeline(r),{...q,tags:q.tags?.split(',').map(tag=>tag.trim()).filter(Boolean)}));
 });
 app.get('/game/timelines/:id/npcs/merge-preview',async r=>{const q=z.strictObject({sourceNpcId:id,targetNpcId:id}).parse(r.query);return wrap(()=>game.previewNpcMerge(actor(r),timeline(r),q.sourceNpcId,q.targetNpcId));});
 app.post('/game/timelines/:id/npcs/merge',async r=>{const b=z.strictObject({revision:bodyRevision,sourceNpcId:id,targetNpcId:id,resolution:z.record(z.string(),z.enum(['source','target']))}).parse(r.body);return wrap(()=>game.mergeNpcs(actor(r),timeline(r),b,key(r.headers)));});
 app.post('/game/timelines/:id/npcs/merges/:mergeId/reverse',async r=>{const p=z.object({id,mergeId:id}).parse(r.params),b=z.strictObject({revision:bodyRevision}).parse(r.body);return wrap(()=>game.reverseNpcMerge(actor(r),p.id,{revision:b.revision,mergeId:p.mergeId},key(r.headers)));});
 app.get('/game/timelines/:id/npcs/:npcId/dossier',async r=>{const p=z.object({id,npcId:id}).parse(r.params);return wrap(()=>game.creatorNpcProfile(actor(r),p.id,p.npcId));});
 app.get('/game/timelines/:id/npcs/:npcId/profile',async r=>{const p=z.object({id,npcId:id}).parse(r.params),q=z.strictObject({characterId:id}).parse(r.query);return wrap(()=>game.playerNpcProfile(actor(r),p.id,p.npcId,q.characterId));});
 app.post('/game/timelines/:id/npcs/:npcId/retire',async r=>{const p=z.object({id,npcId:id}).parse(r.params),b=z.strictObject({revision:bodyRevision,strategy:z.enum(['replacement','retirement']),replacementId:id.optional(),narrative:z.string().trim().min(1).max(16000)}).parse(r.body);return wrap(()=>game.retireNpc(actor(r),p.id,{...b,npcId:p.npcId},key(r.headers)));});
 app.post('/game/timelines/:id/developer/validate',async r=>{const b=z.strictObject({revision:bodyRevision,entities:z.array(z.unknown()).min(1).max(100)}).parse(r.body);return wrap(()=>game.developerValidate(actor(r),timeline(r),b));});
 app.post('/game/timelines/:id/developer/validate-settings',async r=>{const b=z.strictObject({revision:bodyRevision,settings:z.unknown()}).parse(r.body);return wrap(()=>game.developerValidateSettings(actor(r),timeline(r),b));});
 app.get('/game/timelines/:id/developer/simulation-preview',async r=>{const q=z.strictObject({minutes:z.coerce.number().int().min(1).max(1440)}).parse(r.query);return wrap(()=>game.developerSimulationPreview(actor(r),timeline(r),q.minutes));});
 app.get('/game/timelines/:id/studio/drafts',async r=>{const q=z.strictObject({query:z.string().max(160).optional(),kind:z.string().max(80).optional(),status:z.enum(['draft','published','archived']).optional()}).parse(r.query);return wrap(()=>game.studioDrafts(actor(r),timeline(r),q));});
 app.get('/game/timelines/:id/studio/drafts/:draftId',async r=>{const p=z.object({id,draftId:id}).parse(r.params);return wrap(()=>game.studioDraft(actor(r),p.id,p.draftId));});
 app.post('/game/timelines/:id/studio/drafts',{bodyLimit:2*1024*1024},async r=>{const b=z.strictObject({draftId:id.optional(),expectedVersion:z.number().int().positive().optional(),entity:z.unknown(),reason:z.string().trim().min(1).max(500)}).parse(r.body);return wrap(()=>game.saveStudioDraft(actor(r),timeline(r),b));});
 app.get('/game/timelines/:id/studio/drafts/:draftId/validate',async r=>{const p=z.object({id,draftId:id}).parse(r.params),q=z.strictObject({characterId:id.optional()}).parse(r.query);return wrap(()=>game.validateStudioDraft(actor(r),p.id,p.draftId,q.characterId));});
 app.post('/game/timelines/:id/studio/publish',async r=>{const b=z.strictObject({drafts:z.array(z.strictObject({id,version:z.number().int().positive()})).min(1).max(100),revision:bodyRevision,reason:z.string().trim().min(1).max(500),confirmed:z.literal(true)}).parse(r.body);return wrap(()=>game.publishStudioDraft(actor(r),timeline(r),b,key(r.headers)));});
 app.post('/game/timelines/:id/studio/drafts/:draftId/restore',async r=>{const p=z.object({id,draftId:id}).parse(r.params),b=z.strictObject({version:z.number().int().positive(),reason:z.string().trim().min(1).max(500)}).parse(r.body);return wrap(()=>game.restoreStudioVersion(actor(r),p.id,p.draftId,b.version,b.reason));});
 app.get('/game/timelines/:id/studio/templates',async r=>{const q=z.strictObject({kind:z.string().max(80).optional()}).parse(r.query);return wrap(()=>game.studioTemplates(actor(r),timeline(r),q.kind));});
 app.post('/game/timelines/:id/studio/templates',async r=>{const b=z.strictObject({draftId:id,name}).parse(r.body);return wrap(()=>game.createStudioTemplate(actor(r),timeline(r),b));});
 app.post('/game/timelines/:id/studio/templates/use',async r=>{const b=z.strictObject({templateId:id,name,reason:z.string().trim().min(1).max(500)}).parse(r.body);return wrap(()=>game.instantiateStudioTemplate(actor(r),timeline(r),b));});
 app.get('/game/timelines/:id/developer/snapshot',async r=>{const q=z.strictObject({characterId:id.optional()}).parse(r.query);return wrap(()=>game.developerDebugSnapshot(actor(r),timeline(r),q.characterId));});
 app.post('/game/timelines/:id/developer/fixtures/preview',async r=>{const b=z.strictObject({seed:z.string().trim().min(1).max(200)}).parse(r.body);return wrap(()=>game.previewDeveloperFixture(actor(r),timeline(r),b.seed));});
 app.post('/game/timelines/:id/developer/fixtures/apply',async r=>{const b=z.strictObject({token:id,revision:bodyRevision,confirmation:z.string().max(100)}).parse(r.body);return wrap(()=>game.applyDeveloperFixture(actor(r),timeline(r),b,key(r.headers)));});
 app.post('/game/timelines/:id/developer/repair/preview',async r=>{z.strictObject({}).parse(r.body);return wrap(()=>game.previewDeveloperRepair(actor(r),timeline(r)));});
 app.post('/game/timelines/:id/developer/repair/apply',async r=>{const b=z.strictObject({token:id,revision:bodyRevision,confirmation:z.string().max(100)}).parse(r.body);return wrap(()=>game.applyDeveloperRepair(actor(r),timeline(r),b));});
 app.get('/game/timelines/:id/developer/operations',async r=>wrap(()=>game.operationalMetrics(actor(r),timeline(r))));
 app.get('/game/timelines/:id/checks',async r=>{const q=z.strictObject({characterId:id}).parse(r.query);return wrap(()=>game.checks(actor(r),timeline(r),q.characterId));});
 app.get('/game/timelines/:id/preview',async r=>{const q=z.strictObject({characterId:id}).parse(r.query);return wrap(()=>game.preview(actor(r),timeline(r),q.characterId));});
 app.get('/game/timelines/:id/diagnostics',async r=>wrap(()=>game.diagnostics(actor(r),timeline(r))));
 app.get('/game/timelines/:id/media/:mediaId',async(r,reply)=>{const p=z.object({id,mediaId:id}).parse(r.params),q=z.strictObject({characterId:id}).parse(r.query);const asset=await game.media(actor(r),p.id,p.mediaId,q.characterId);return reply.type(asset.mime).header('Content-Disposition','inline').send(asset.bytes);});
 app.post('/game/timelines/:id/media',{bodyLimit:400000},async r=>{const b=z.strictObject({revision:bodyRevision,entity:z.unknown()}).parse(r.body);const entity=z.object({kind:z.literal('media')}).passthrough().parse(b.entity);return wrap(()=>game.edit(actor(r),timeline(r),{revision:b.revision,entity},key(r.headers)));});
 app.get('/game/timelines/:id/saves/compatibility',async r=>{const q=z.strictObject({saveId:id}).parse(r.query);return wrap(()=>game.saveCompatibility(actor(r),timeline(r),q.saveId));});
 app.post('/game/timelines/:id/entities',async r=>{const input=z.strictObject({revision:bodyRevision,entity:z.unknown()}).parse(r.body);return wrap(async ()=>(await game.edit(actor(r),timeline(r),input,key(r.headers))));});
 app.post('/game/timelines/:id/entities/bulk',{bodyLimit:2*1024*1024},async r=>{const b=z.strictObject({revision:bodyRevision,entities:z.array(z.unknown()).min(1).max(100)}).parse(r.body);return wrap(()=>game.bulkEdit(actor(r),timeline(r),b,key(r.headers)));});
 app.get('/game/timelines/:id/saves/compare',async r=>{const q=z.strictObject({saveId:id}).parse(r.query);return wrap(()=>game.compareSave(actor(r),timeline(r),q.saveId));});
 app.post('/game/timelines/:id/entities/restore',async r=>{const b=z.strictObject({revision:bodyRevision,saveId:id,entityId:id}).parse(r.body);return wrap(()=>game.restoreEntity(actor(r),timeline(r),b,key(r.headers)));});
 app.post('/game/timelines/:id/settings',async r=>{const b=z.strictObject({revision:bodyRevision,settings:z.unknown()}).parse(r.body);return wrap(async ()=>(await game.configure(actor(r),timeline(r),b.revision,b.settings,key(r.headers))));});
 app.post('/game/timelines/:id/epistemic',async r=>{
  const b=z.strictObject({revision:bodyRevision,layer:z.enum(['truth','knowledge','belief','memory','gossip','correct-belief','retire-truth','refresh-memory']),subjectId:id,text:z.string().max(16000),factId:id.optional(),confidence:z.number().min(0).max(1).optional(),recordId:id.optional(),targetId:id.optional(),salience:z.number().min(0).max(1).optional(),decayPerDay:z.number().min(0).max(1).optional(),predicate:z.string().max(160).optional(),value:z.json().optional(),propositionSubjectId:id.nullable().optional(),objectId:id.nullable().optional(),qualifiers:z.record(z.string(),z.json()).optional(),source:z.string().max(1000).optional(),truthStatus:z.enum(['verified','asserted','disputed','false','superseded','believed','doubted','disproven','confirmed']).optional(),audience:z.array(z.string().max(160)).max(100).optional(),observedAt:z.iso.datetime().nullable().optional(),learnedAt:z.iso.datetime().nullable().optional(),validFrom:z.iso.datetime().nullable().optional(),validUntil:z.iso.datetime().nullable().optional(),eventIds:z.array(id).max(100).optional(),evidenceIds:z.array(id).max(100).optional(),tags:z.array(z.string().max(80)).max(100).optional(),interpretation:z.string().max(16000).optional(),privacy:z.enum(['private','shared']).optional(),recallConditions:z.strictObject({entityIds:z.array(id).max(100).optional(),tags:z.array(z.string().max(80)).max(100).optional(),locationId:id.nullable().optional(),from:z.iso.datetime().nullable().optional(),until:z.iso.datetime().nullable().optional()}).optional(),expiresAt:z.iso.datetime().nullable().optional()}).parse(r.body);
  return wrap(async ()=>(await game.epistemic(actor(r),timeline(r),b.revision,b,key(r.headers))));
 });
 app.post('/game/timelines/:id/story/resolve',async r=>wrap(async()=>{
  const b=z.strictObject({characterId:id,text:z.string().trim().min(1).max(1000),provider:z.enum(['grounded',...directProviderIds]).default('grounded')}).parse(r.body),a=actor(r),tid=timeline(r);
  await game.authorizeCharacter(a,tid,b.characterId);const state=await game.load(tid),direct=storyIntent(state,b.characterId,b.text);
  if(direct)return {action:direct};
  let interpretationWarning:string|undefined;
  if(b.provider!=='grounded'&&!/\b(?:don't|didn't|doesn't|never|not|would|could|might|if|consider|remember)\b|\?/i.test(b.text)){
   try{const proposal=await intent.propose(a,tid,b.characterId,b.text,b.provider);if(proposal.action)return {action:proposal.action};}
   catch(error){if(!(error instanceof Error)||!['provider_unavailable','provider_circuit_open','narration_busy','context_limit','ai_budget_exceeded','ai_user_budget_exceeded'].includes(error.message))throw error;interpretationWarning='AI interpretation is unavailable or its allowance is exhausted. Only recognized actions can change the world.';}
  }
  // Non-mechanical prose is kept as prose; unrecognized game actions never silently succeed.
  if(/\b(?:buy|bought|take|took|pick up|attack|punch|shoot|go to|walk to|equip|consume|give|sell|steal|drive|flee|work|pay|drop|dropped|discard|gave|worked)\b/i.test(b.text))return {action:null,clarification:'Which known item, person, or destination did you mean? Be specific so the right action happens.'};
  return {action:{type:'story',text:b.text},...(interpretationWarning?{interpretationWarning}:{})};
 }));
 app.post('/game/timelines/:id/parse',async r=>{const b=z.strictObject({characterId:id,text:z.string().min(1).max(1000)}).parse(r.body);return wrap(async ()=>(await game.parse(actor(r),timeline(r),b.characterId,b.text)));});
 app.post('/game/timelines/:id/interpret',async r=>{const b=z.strictObject({characterId:id,text:z.string().min(1).max(1000),provider:z.enum(directProviderIds)}).parse(r.body);return intent.propose(actor(r),timeline(r),b.characterId,b.text,b.provider);});
 app.post('/game/timelines/:id/turns',async r=>{const b=z.strictObject({revision:bodyRevision,cursor:z.string().min(16).max(128),characterId:id,action:actionSchema,text:z.string().max(1000).optional()}).parse(r.body);return wrap(async ()=>(await game.turn(actor(r),timeline(r),b,key(r.headers))));});
 app.post('/game/timelines/:id/narrate',async r=>{const b=z.strictObject({turnId:id,provider:z.string().max(100).default('grounded'),style:z.literal('story').optional()}).parse(r.body);return (await narrate(actor(r),timeline(r),b.turnId,b.provider,undefined,b.style));});
 app.post('/game/timelines/:id/narrate/stream',async(r,reply)=>{
  const b=z.strictObject({turnId:id,provider:z.string().max(100).default('grounded'),style:z.literal('story').optional()}).parse(r.body);
  const controller=new AbortController(),abort=()=>controller.abort();
  const close=()=>{if(!reply.raw.writableFinished)abort();};
  r.raw.once('aborted',abort);reply.raw.once('close',close);
  try{
   // Validate and atomically commit the complete narration before exposing any model-influenced text.
   const result=await narrate(actor(r),timeline(r),b.turnId,b.provider,controller.signal,b.style);
   if(controller.signal.aborted)throw new Error('narration_canceled');
   const lines=[...result.narration!.split('\n\n').map(text=>JSON.stringify({type:'paragraph',text})),JSON.stringify({type:'complete',status:result.status,promptVersion:result.promptVersion,...('failureCode' in result?{failureCode:result.failureCode,fallbackMessage:result.fallbackMessage}:{})})];
   return reply.type('application/x-ndjson').send(Readable.from(lines.map(line=>line+'\n')));
  }finally{r.raw.off('aborted',abort);reply.raw.off('close',close);}
 });
 app.get('/game/timelines/:id/saves',async r=>(await game.saves(actor(r),timeline(r))));
 app.post('/game/timelines/:id/saves',async r=>(await game.save(actor(r),timeline(r),z.strictObject({name,thumbnailMediaId:id.nullable().optional()}).parse(r.body))));
 app.post('/game/timelines/:id/branch',async r=>{const b=z.strictObject({saveId:id.optional(),cursor:z.string().min(16).max(128).optional(),eventId:id.optional(),name}).parse(r.body);return wrap(async ()=>(await game.branchFromHere(actor(r),timeline(r),b)));});
 app.post('/game/timelines/:id/duplicate-campaign',async r=>{const b=z.strictObject({name}).parse(r.body);return wrap(()=>game.duplicateCampaign(actor(r),timeline(r),b.name));});
 app.get('/game/timelines/:id/export',async r=>{const q=z.strictObject({mediaStrategy:z.enum(['inline','references']).optional()}).parse(r.query);return game.export(actor(r),timeline(r),q);});
 app.post('/game/timelines/:id/import',{bodyLimit:game.importBytes},async r=>{const b=z.strictObject({name,bundle:z.unknown(),dryRun:z.boolean().default(true),confirmationToken:id.optional()}).refine(value=>value.dryRun||Boolean(value.confirmationToken),'confirmation_token_required').parse(r.body);return wrap(async ()=>(await game.import(actor(r),timeline(r),b.name,b.bundle,b.dryRun,b.confirmationToken)));});
 app.post('/game/timelines/:id/template',async r=>(await game.template(actor(r),timeline(r),z.strictObject({name}).parse(r.body).name)));
 app.get('/game/timelines/:id/templates',async r=>(await game.templates(actor(r),timeline(r))));
 app.post('/game/timelines/:id/templates/use',async r=>{const b=z.strictObject({templateId:id,name}).parse(r.body);return wrap(async ()=>(await game.instantiateTemplate(actor(r),timeline(r),b.templateId,b.name)));});
 app.post('/game/timelines/:id/catalog',async r=>{const b=z.strictObject({revision:bodyRevision}).parse(r.body);return (await game.installCatalog(actor(r),timeline(r),b.revision,key(r.headers)));});
 app.post('/game/timelines/:id/traits/generate',async r=>{const b=z.strictObject({revision:bodyRevision,characterId:id,templateId:id,seed:z.string().min(1).max(200)}).parse(r.body);return wrap(()=>game.generateNpcTraits(actor(r),timeline(r),b,key(r.headers)));});
 app.get('/game/timelines/:id/history',async r=>(await game.history(actor(r),timeline(r))));
 const retrievalFilterSchema=z.strictObject({entityIds:z.array(id).max(100).optional(),tags:z.array(z.string().max(80)).max(100).optional(),from:z.iso.datetime().nullable().optional(),until:z.iso.datetime().nullable().optional(),placeIds:z.array(id).max(100).optional(),personIds:z.array(id).max(100).optional(),relationshipIds:z.array(id).max(100).optional(),eventIds:z.array(id).max(100).optional(),evidenceIds:z.array(id).max(100).optional(),factionIds:z.array(id).max(100).optional(),kinds:z.array(z.enum(['lore','storycard','canon'])).max(3).optional()});
 const retrievalQuery=(r:FastifyRequest)=>{const q=z.strictObject({characterId:id,query:z.string().max(1000).default(''),filters:z.string().max(16000).default('{}')}).parse(r.query);let raw:unknown;try{raw=JSON.parse(q.filters);}catch{throw new Fault(400,'invalid_retrieval_filters');}return {...q,filters:retrievalFilterSchema.parse(raw)};};
 app.get('/game/timelines/:id/retrieval',async r=>{const q=retrievalQuery(r);return wrap(()=>game.semanticRetrieval(actor(r),timeline(r),q.characterId,q.query,q.filters,false));});
 app.get('/game/timelines/:id/developer/retrieval',async r=>{const q=retrievalQuery(r);return wrap(()=>game.semanticRetrieval(actor(r),timeline(r),q.characterId,q.query,q.filters,true));});
 app.get('/game/timelines/:id/context',async r=>{const q=z.strictObject({characterId:id,query:z.string().max(1000)}).parse(r.query);return wrap(async ()=>(await game.context(actor(r),timeline(r),q.characterId,q.query)));});
 app.get('/game/timelines/:id/developer/context-manifest',async r=>{const q=z.strictObject({characterId:id,query:z.string().max(1000).default('')}).parse(r.query);return wrap(()=>game.developerContextManifest(actor(r),timeline(r),q.characterId,q.query));});
 app.get('/game/timelines/:id/developer/turn-traces',async r=>{const timelineId=timeline(r);await game.access(actor(r),timelineId,true);const traces=await game.store.all<Record<string,unknown>>('SELECT trace_id AS traceId,actor_id AS actorId,request_key AS requestKey,original_text AS originalText,expected_revision AS expectedRevision,expected_cursor AS expectedCursor,event_id AS eventId,status,failure_reason AS failureReason,created_at AS createdAt,completed_at AS completedAt FROM turn_traces WHERE timeline_id=? ORDER BY created_at DESC LIMIT 100',timelineId);for(const trace of traces)trace.steps=(await game.store.all<Record<string,unknown>>('SELECT sequence,stage,duration_ms AS durationMs,status,failure_reason AS failureReason,details_json AS details,created_at AS createdAt FROM turn_trace_steps WHERE trace_id=? ORDER BY sequence',String(trace.traceId))).map(step=>({...step,details:JSON.parse(String(step.details))}));return traces;});
 app.get('/game/timelines/:id/ai-requests',async r=>{const timelineId=timeline(r);await game.access(actor(r),timelineId,true);return await game.store.all('SELECT trace_id AS traceId,purpose,provider,model,configuration_id AS configurationId,budget_json AS budget,allowed_tools_json AS allowedTools,response_schema_id AS responseSchemaId,response_schema_version AS responseSchemaVersion,prompt_id AS promptId,prompt_version AS promptVersion,cache_policy AS cachePolicy,status,attempt_count AS attempts,input_tokens AS inputTokens,output_tokens AS outputTokens,failure_code AS failureCode,created_at AS createdAt FROM ai_requests WHERE trace_id IN (SELECT id FROM ai_usage WHERE timeline_id=? UNION SELECT id FROM ai_intent_usage WHERE timeline_id=?) ORDER BY created_at DESC LIMIT 100',timelineId,timelineId);});
 app.get('/game/timelines/:id/ai-usage',async r=>{(await game.access(actor(r),timeline(r),true));return (await game.store.all('SELECT provider,reserved_tokens,used_tokens,status,created_at FROM ai_usage WHERE timeline_id=? ORDER BY rowid DESC LIMIT 100',timeline(r)));});
}
