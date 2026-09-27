import {z} from 'zod';
import type {FastifyInstance,FastifyRequest} from 'fastify';
import {Game} from './engine.ts';
import {dataSchemas,kinds,actionSchema,settingsSchema} from './model.ts';
import {id,name,Fault} from '../contracts.ts';
import type {Actor} from '../contracts.ts';
import {NarrativeGateway,GroundedProvider,JsonGatewayProvider} from './ai.ts';
import type {NarrativeProvider} from './ai.ts';
import {Readable} from 'node:stream';
import {geminiFromEnvironment} from './gemini.ts';
import {IntentGateway} from './ai-intent.ts';
export function gameRoutes(app:FastifyInstance,game:Game,actor:(r:object)=>Actor,key:(headers:Record<string,unknown>)=>string){
 const providers:NarrativeProvider[]=[new GroundedProvider(),...(process.env.AI_GATEWAY_URL&&process.env.AI_GATEWAY_SECRET?[new JsonGatewayProvider(process.env.AI_GATEWAY_URL,process.env.AI_GATEWAY_SECRET)]:[])];
 const gemini=geminiFromEnvironment();if(gemini)providers.push(gemini);
 const ai=new NarrativeGateway(game,providers);
 const intent=new IntentGateway(game,gemini?[gemini]:[],ai.inflight);
 const timeline=(r:FastifyRequest)=>z.object({id}).parse(r.params).id;
 const bodyRevision=z.number().int().positive();
 const wrap=async(fn:()=>unknown)=>{try{return await fn();}catch(error){if(error instanceof Fault||error instanceof z.ZodError)throw error;if(error instanceof Error&&/^[a-z_]+$/.test(error.message))throw new Fault(400,error.message);throw error;}};
 app.get('/game/catalog',async r=>{actor(r);return {kinds,schemas:Object.fromEntries(kinds.map(k=>[k,z.toJSONSchema(dataSchemas[k])])),settings:z.toJSONSchema(settingsSchema),actions:actionSchema.options.map(option=>z.toJSONSchema(option)),providers:providers.map(p=>p.id)};});
 app.get('/game/campaigns/:id/timelines',async r=>(await game.list(actor(r),timeline(r))));
 app.post('/game/campaigns/:id/timelines',async r=>(await game.initialize(actor(r),timeline(r))));
 app.get('/game/timelines/:id/roster',async r=>(await game.roster(actor(r),timeline(r))));
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
  const b=z.strictObject({revision:bodyRevision,packageId:id.optional(),definition:z.unknown().optional()}).refine(v=>Boolean(v.packageId)!==Boolean(v.definition),'one_start_source_required').parse(r.body);
  return wrap(()=>game.start(actor(r),timeline(r),b,key(r.headers)));
 });
 app.get('/game/timelines/:id/view',async r=>{const query=z.strictObject({characterId:id}).parse(r.query);return wrap(async ()=>(await game.view(actor(r),timeline(r),query.characterId)));});
 app.get('/game/timelines/:id/projections',async r=>{const query=z.strictObject({characterId:id}).parse(r.query);return wrap(()=>game.projections(actor(r),timeline(r),query.characterId));});
 app.get('/game/timelines/:id/creator',async r=>(await game.creator(actor(r),timeline(r))));
 app.get('/game/timelines/:id/developer/overview',async r=>(await game.creator(actor(r),timeline(r))));
 app.post('/game/timelines/:id/developer/validate',async r=>{const b=z.strictObject({revision:bodyRevision,entities:z.array(z.unknown()).min(1).max(100)}).parse(r.body);return wrap(()=>game.developerValidate(actor(r),timeline(r),b));});
 app.post('/game/timelines/:id/developer/validate-settings',async r=>{const b=z.strictObject({revision:bodyRevision,settings:z.unknown()}).parse(r.body);return wrap(()=>game.developerValidateSettings(actor(r),timeline(r),b));});
 app.get('/game/timelines/:id/developer/simulation-preview',async r=>{const q=z.strictObject({minutes:z.coerce.number().int().min(1).max(1440)}).parse(r.query);return wrap(()=>game.developerSimulationPreview(actor(r),timeline(r),q.minutes));});
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
  const b=z.strictObject({revision:bodyRevision,layer:z.enum(['truth','knowledge','belief','memory','correct-belief','retire-truth','refresh-memory']),subjectId:id,text:z.string().max(16000),factId:id.optional(),confidence:z.number().min(0).max(1).optional(),recordId:id.optional(),salience:z.number().min(0).max(1).optional(),decayPerDay:z.number().min(0).max(1).optional()}).parse(r.body);
  return wrap(async ()=>(await game.epistemic(actor(r),timeline(r),b.revision,b,key(r.headers))));
 });
 app.post('/game/timelines/:id/parse',async r=>{const b=z.strictObject({characterId:id,text:z.string().min(1).max(1000)}).parse(r.body);return wrap(async ()=>(await game.parse(actor(r),timeline(r),b.characterId,b.text)));});
 app.post('/game/timelines/:id/interpret',async r=>{const b=z.strictObject({characterId:id,text:z.string().min(1).max(1000),provider:z.literal('gemini')}).parse(r.body);return intent.propose(actor(r),timeline(r),b.characterId,b.text,b.provider);});
 app.post('/game/timelines/:id/turns',async r=>{const b=z.strictObject({revision:bodyRevision,characterId:id,action:actionSchema,text:z.string().max(1000).optional()}).parse(r.body);return wrap(async ()=>(await game.turn(actor(r),timeline(r),b,key(r.headers))));});
 app.post('/game/timelines/:id/narrate',async r=>{const b=z.strictObject({turnId:id,provider:z.string().max(100).default('grounded')}).parse(r.body);return (await ai.narrate(actor(r),timeline(r),b.turnId,b.provider));});
 app.post('/game/timelines/:id/narrate/stream',async(r,reply)=>{
  const b=z.strictObject({turnId:id,provider:z.string().max(100).default('grounded')}).parse(r.body);
  // Validate and commit the complete narration before exposing any model-influenced text.
  const result=await ai.narrate(actor(r),timeline(r),b.turnId,b.provider);
  const lines=[...result.narration!.split('\n\n').map(text=>JSON.stringify({type:'paragraph',text})),JSON.stringify({type:'complete',status:result.status,promptVersion:result.promptVersion})];
  return reply.type('application/x-ndjson').send(Readable.from(lines.map(line=>line+'\n')));
 });
 app.get('/game/timelines/:id/saves',async r=>(await game.saves(actor(r),timeline(r))));
 app.post('/game/timelines/:id/saves',async r=>(await game.save(actor(r),timeline(r),z.strictObject({name}).parse(r.body).name)));
 app.post('/game/timelines/:id/branch',async r=>{const b=z.strictObject({saveId:id,name}).parse(r.body);return wrap(async ()=>(await game.branch(actor(r),timeline(r),b.saveId,b.name)));});
 app.get('/game/timelines/:id/export',async r=>(await game.export(actor(r),timeline(r))));
 app.post('/game/timelines/:id/import',{bodyLimit:game.importBytes},async r=>{const b=z.strictObject({name,bundle:z.unknown(),dryRun:z.boolean().default(true)}).parse(r.body);return wrap(async ()=>(await game.import(actor(r),timeline(r),b.name,b.bundle,b.dryRun)));});
 app.post('/game/timelines/:id/template',async r=>(await game.template(actor(r),timeline(r),z.strictObject({name}).parse(r.body).name)));
 app.get('/game/timelines/:id/templates',async r=>(await game.templates(actor(r),timeline(r))));
 app.post('/game/timelines/:id/templates/use',async r=>{const b=z.strictObject({templateId:id,name}).parse(r.body);return wrap(async ()=>(await game.instantiateTemplate(actor(r),timeline(r),b.templateId,b.name)));});
 app.post('/game/timelines/:id/catalog',async r=>{const b=z.strictObject({revision:bodyRevision}).parse(r.body);return (await game.installCatalog(actor(r),timeline(r),b.revision,key(r.headers)));});
 app.get('/game/timelines/:id/history',async r=>(await game.history(actor(r),timeline(r))));
 app.get('/game/timelines/:id/context',async r=>{const q=z.strictObject({characterId:id,query:z.string().max(1000)}).parse(r.query);return wrap(async ()=>(await game.context(actor(r),timeline(r),q.characterId,q.query)));});
 app.get('/game/timelines/:id/ai-usage',async r=>{(await game.access(actor(r),timeline(r),true));return (await game.store.all('SELECT provider,reserved_tokens,used_tokens,status,created_at FROM ai_usage WHERE timeline_id=? ORDER BY rowid DESC LIMIT 100',timeline(r)));});
}
