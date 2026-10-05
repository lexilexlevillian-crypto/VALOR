import {installResponseTiming} from './game/response-timing.ts';
import Fastify, { LogController } from 'fastify';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { Store } from './db.ts';
import { Domain } from './domain.ts';
import { Auth, credentials, recoveryCredentials, csrfFor } from './auth.ts';
import { Fault, ensure, envelopeSchema, id, name, scopeSchema } from './contracts.ts';
import type { Actor, Scope } from './contracts.ts';
import type { Config } from './config.ts';
import { Game } from './game/engine.ts';
import { gameRoutes } from './game/routes.ts';
import { publicAssets, shell, shellPolicy, staticRoutes } from './static.ts';
import {FoundationAuthority} from './foundation-authority.ts';

export function buildApp(store:Store,settings:Config,logging:boolean|{write(chunk:string):void}=true) {
  const domain=new Domain(store),auth=new Auth(store,settings),foundation=new FoundationAuthority(store);
  const app=Fastify({
    // AI processing can take two 12-second attempts plus authorization and commits.
    // Keep the request-upload limit separate from the processing/socket timeout.
    bodyLimit:32768,requestTimeout:15000,connectionTimeout:60000,
    trustProxy:false,requestIdHeader:false,genReqId:()=>randomUUID(),logController:new LogController({disableRequestLogging:true}),
    logger:logging?{level:'info',...(typeof logging==='object'?{stream:logging}:{}),redact:{paths:['password','token','csrfToken','secret','contacts','req.url','req.query','req.headers.cookie','req.headers.authorization','req.headers.x-csrf-token','req.body'],censor:'[REDACTED]'}}:false
  });
  installResponseTiming(app);
  const cookieName=settings.production?'__Host-valor_session':'valor_session';
  const cookie=(token:string,maxAge:number)=>cookieName+'='+token+'; Path=/; HttpOnly; SameSite=Strict; Max-Age='+maxAge+(settings.production?'; Secure':'');
  const tokenFrom=(header:string|undefined)=>header?.split(';').map(s=>s.trim()).find(s=>s.startsWith(cookieName+'='))?.slice(cookieName.length+1);
  const actors=new WeakMap<object,Actor>();
  const requestStarted=new WeakMap<object,number>();
  app.addHook('onRequest',async(request,reply)=>{
    requestStarted.set(request,performance.now());
    reply.header('Cache-Control','no-store');
    reply.header('X-Content-Type-Options','nosniff');
    reply.header('Referrer-Policy','no-referrer');
    reply.header('Content-Security-Policy',"default-src 'none'; frame-ancestors 'none'; base-uri 'none'");
    reply.header('X-Request-Id',request.id);
    if(settings.production)reply.header('Strict-Transport-Security','max-age=31536000');
    // Never trust X-Forwarded-For supplied by a client. Proxy policy remains deployment-specific.
    (await auth.limit('request',request.ip,settings.requestLimit,60000));
    const path=request.url.split('?')[0];
    const unsafe=!['GET','HEAD','OPTIONS'].includes(request.method);
    if(unsafe)ensure(request.headers.origin===settings.origin,403,'origin_rejected');
    if((path==='/healthz' || path==='/readyz' || path==='/' || publicAssets.has(path??'')) && (request.method==='GET' || request.method==='HEAD'))return;
    if((path==='/auth/login' || path==='/auth/signup' || path==='/auth/password/recover') && request.method==='POST') {
      (await auth.limit(path==='/auth/password/recover'?'recovery-ip':'login-ip',request.ip,settings.loginLimit*3,900000));
      return;
    }
    const token=tokenFrom(request.headers.cookie);
    const authenticated=await auth.authenticate(token); actors.set(request,{...authenticated,requestId:request.id});
    if(unsafe){
      auth.csrf(token!,request.headers['x-csrf-token']);
      if(path!=='/auth/logout')await auth.limit('mutation-user',authenticated.id,settings.mutationLimit,60000);
    }
    if(path==='/game/ai/health')await auth.limit('ai-health-user',authenticated.id,3,60000);
    if(/^\/game\/timelines\/[^/]+\/(?:story\/resolve|interpret|narrate(?:\/stream)?)$/.test(path??''))await auth.limit('ai-call-user',authenticated.id,settings.aiCallLimit,60000);
    if(request.method==='GET'&&/^\/game\/timelines\/[^/]+\/export$/.test(path??''))await auth.limit('export-user',authenticated.id,settings.exportLimit,60000);
  });
  app.addHook('onResponse',async(request,reply)=>{
    const duration=Math.max(0,performance.now()-(requestStarted.get(request)??performance.now())),route=request.routeOptions.url??'unmatched',path=request.url.split('?')[0]??'',match=/^\/game\/timelines\/([0-9a-f-]{36})(?:\/|$)/i.exec(path),timelineId=match?.[1]??null;
    try{
      const campaign=timelineId?await store.get<{campaign_id:string}>('SELECT campaign_id FROM timelines WHERE id=?',timelineId):null,status=reply.statusCode>=400?'failed':'succeeded',timestamp=new Date().toISOString(),dimensions=JSON.stringify({method:request.method,route,statusCode:reply.statusCode});
      await store.run('INSERT INTO operational_metric_events(campaign_id,timeline_id,metric,value,status,dimensions_json,created_at) VALUES (?,?,?,?,?,?,?)',campaign?.campaign_id??null,timelineId,'api_latency_ms',duration,status,dimensions,timestamp);
      if(reply.statusCode>=400)await store.run('INSERT INTO operational_metric_events(campaign_id,timeline_id,metric,value,status,dimensions_json,created_at) VALUES (?,?,?,?,?,?,?)',campaign?.campaign_id??null,timelineId,'api_error',1,'failed',dimensions,timestamp);
      if(route==='/game/timelines/:id/turns')await store.run('INSERT INTO operational_metric_events(campaign_id,timeline_id,metric,value,status,dimensions_json,created_at) VALUES (?,?,?,?,?,?,?)',campaign?.campaign_id??null,timelineId,'turn_latency_ms',duration,status,dimensions,timestamp);
      if(route==='/game/timelines/:id/developer/simulation-preview')await store.run('INSERT INTO operational_metric_events(campaign_id,timeline_id,metric,value,status,dimensions_json,created_at) VALUES (?,?,?,?,?,?,?)',campaign?.campaign_id??null,timelineId,'simulation_latency_ms',duration,status,dimensions,timestamp);
      if(reply.statusCode>=400&&/^\/game\/timelines\/:id\/(?:saves|branch|import)/.test(route))await store.run('INSERT INTO operational_metric_events(campaign_id,timeline_id,metric,value,status,dimensions_json,created_at) VALUES (?,?,?,?,?,?,?)',campaign?.campaign_id??null,timelineId,'save_failure',1,'failed',dimensions,timestamp);
    }catch{}
    app.log.info({requestId:request.id,method:request.method,route:request.routeOptions.url??'unmatched',status:reply.statusCode},'request.complete');
  });
  app.setErrorHandler((error,request,reply)=>{
    let status=500,code='internal_error';
    if(error instanceof Fault){status=error.status;code=error.code;}
    else if(error instanceof z.ZodError){status=400;code='invalid_input';}
    else if(typeof error==='object' && error!==null && 'statusCode' in error && typeof error.statusCode==='number' && error.statusCode>=400 && error.statusCode<500){
      status=error.statusCode; code=status===413?'body_too_large':'invalid_request';
    }
    if(status===500)app.log.error({requestId:request.id,code},'request.failed');
    if(status===429)reply.header('Retry-After','900');
    reply.code(status).send({error:code,requestId:request.id});
  });
  app.setNotFoundHandler((request,reply)=>reply.code(404).send({error:'not_found',requestId:request.id}));
  const actor=(request:object)=>actors.get(request)!;
  const key=(headers:Record<string,unknown>)=>z.string().regex(/^[A-Za-z0-9_-]{16,128}$/).parse(headers['idempotency-key']);
  const scopeParams=z.strictObject({type:z.enum(['world','campaign']),scopeId:id});
  const getScope=(params:unknown):Scope=>{
    const p=scopeParams.parse(params); return scopeSchema.parse({type:p.type,id:p.scopeId});
  };
  const cursor=(query:unknown)=>z.strictObject({after:id.optional()}).parse(query).after??'';
  app.get('/',async(request,reply)=>{
    if(request.headers.accept?.includes('text/html'))return reply.header('Content-Security-Policy',shellPolicy).type('text/html').send(shell());
    return {name:'VALOR',version:'0.2.0-alpha',status:'integrated-alpha',playable:true,client:'/app'};
  });
  app.get('/healthz',async()=>{(await store.get('SELECT 1'));return {status:'ok'};});
  app.get('/readyz',async()=>{const schema=await store.get<{version:number}>('SELECT max(version) version FROM schema_migrations');ensure(schema?.version===46,503,'schema_not_ready');return {status:'ready',schemaVersion:schema.version};});
  app.post('/auth/login',async(request,reply)=>{
    const input=credentials.parse(request.body);
    (await auth.limit('login-account',input.email,settings.loginLimit,900000));
    const result=await auth.login(input.email,input.password);
    reply.header('Set-Cookie',cookie(result.token,settings.sessionHours*3600));
    return {user:result.user,csrfToken:result.csrfToken};
  });
  app.post('/auth/signup',async(request,reply)=>{
    const input=credentials.parse(request.body);
    (await auth.limit('signup-account',input.email,settings.loginLimit,900000));
    const result=await auth.signup(input.email,input.password);
    reply.code(201).header('Set-Cookie',cookie(result.token,settings.sessionHours*3600));
    return {user:result.user,csrfToken:result.csrfToken};
  });
  app.post('/auth/password/recover',async(request)=>{
    const input=recoveryCredentials.parse(request.body);
    await auth.limit('recovery-account',input.email,settings.loginLimit,900000);
    return auth.recoverPassword(input.email,input.recoveryKey,input.newPassword,request.id);
  });
  app.get('/auth/session',async(request)=>({user:actor(request),csrfToken:csrfFor(tokenFrom(request.headers.cookie)!)}));
  app.post('/auth/logout',async(request,reply)=>{
    (await auth.logout(tokenFrom(request.headers.cookie)!,actor(request)));
    reply.header('Set-Cookie',cookie('',0));return {ok:true};
  });
  app.post('/worlds',async(request,reply)=>{
    const input=z.strictObject({name}).parse(request.body);
    reply.code(201);return (await domain.createWorld(actor(request),input.name,key(request.headers)));
  });
  app.get('/worlds',async(request)=>{
    const after=cursor(request.query);
    return {items:(await store.all('SELECT id,name,revision FROM worlds WHERE owner_id=? AND archived_at IS NULL AND id>? ORDER BY id LIMIT 100',actor(request).id,after))};
  });
  const campaignInput=z.strictObject({
    worldId:id,name,startingAt:z.iso.datetime(),
    timezone:z.string().max(100).refine(value=>{try{new Intl.DateTimeFormat('en-US',{timeZone:value});return true;}catch{return false;}},'Invalid timezone'),
    configuration:z.strictObject({overrides:z.unknown()}).optional()
  });
  app.post('/campaigns',async(request,reply)=>{
    reply.code(201);return (await domain.createCampaign(actor(request),campaignInput.parse(request.body),key(request.headers)));
  });
  app.get('/me/mode',async(request)=>domain.userMode(actor(request)));
  app.post('/me/mode',async(request)=>{
    const b=z.strictObject({mode:z.enum(['player','developer']),expectedRevision:z.number().int().nonnegative()}).parse(request.body);
    return domain.setUserMode(actor(request),b);
  });
  app.post('/me/developer-access',async(request)=>{
    const current=actor(request),b=z.strictObject({accessKey:z.string().trim().min(1).max(256),expectedRevision:z.number().int().nonnegative()}).parse(request.body);
    await auth.limit('developer-key-user',current.id,settings.loginLimit,900000);
    await auth.limit('developer-key-ip',request.ip,settings.loginLimit*3,900000);
    return auth.grantDeveloperAccess(current,b.accessKey,b.expectedRevision,request.id);
  });
  app.get('/me/theme',async(request)=>domain.userTheme(actor(request)));
  app.post('/me/theme',async(request)=>{
    const b=z.strictObject({themeId:z.string().max(80),expectedRevision:z.number().int().nonnegative()}).parse(request.body);
    return domain.setUserTheme(actor(request),b,key(request.headers));
  });
  app.get('/campaigns/:campaignId/theme',async(request)=>{
    const p=z.strictObject({campaignId:id}).parse(request.params);
    return domain.campaignTheme(actor(request),p.campaignId);
  });
  app.post('/campaigns/:campaignId/theme',async(request)=>{
    const p=z.strictObject({campaignId:id}).parse(request.params);
    const b=z.strictObject({recommendedThemeId:z.string().max(80),allowedThemes:z.array(z.string().max(80)).min(1).max(20),expectedRevision:z.number().int().nonnegative(),reason:z.string().trim().max(500).optional()}).parse(request.body);
    return domain.setCampaignTheme(actor(request),p.campaignId,b,key(request.headers));
  });  app.get('/continue',async(request)=>{
    const user=actor(request);
    return (await store.get("SELECT c.id AS campaign_id,c.name,c.starting_at,c.timezone,m.role,t.id AS timeline_id,t.name AS timeline_name,t.revision,t.clock,(SELECT ge.id FROM game_entities ge WHERE ge.timeline_id=t.id AND ge.kind='character' AND ge.archived_at IS NULL AND json_extract(ge.data_json,'$.playable')=1 AND json_extract(ge.data_json,'$.controllerUserId')=? ORDER BY ge.updated_at DESC,ge.id LIMIT 1) AS character_id,(SELECT ge.name FROM game_entities ge WHERE ge.timeline_id=t.id AND ge.kind='character' AND ge.archived_at IS NULL AND json_extract(ge.data_json,'$.playable')=1 AND json_extract(ge.data_json,'$.controllerUserId')=? ORDER BY ge.updated_at DESC,ge.id LIMIT 1) AS character_name FROM campaigns c JOIN memberships m ON m.campaign_id=c.id LEFT JOIN timelines t ON t.campaign_id=c.id AND t.archived_at IS NULL WHERE m.user_id=? AND c.archived_at IS NULL AND t.id IS NOT NULL ORDER BY COALESCE((SELECT MAX(created_at) FROM game_events ev WHERE ev.timeline_id=t.id),t.created_at,c.updated_at) DESC,t.id LIMIT 1",user.id,user.id,user.id))??null;
  });  app.get('/campaigns',async(request)=>{
    const after=cursor(request.query);
    return {items:(await store.all('SELECT c.id,c.name,c.source_world_id AS sourceWorldId,c.starting_at,c.timezone,c.revision,m.role FROM campaigns c JOIN memberships m ON m.campaign_id=c.id WHERE m.user_id=? AND c.archived_at IS NULL AND c.id>? ORDER BY c.id LIMIT 100',actor(request).id,after))};
  });
  app.get('/campaigns/:campaignId/config',async(request)=>{
    const p=z.strictObject({campaignId:id}).parse(request.params);
    return await domain.campaignConfig(actor(request),p.campaignId);
  });
  app.post('/campaigns/:campaignId/config',async(request)=>{
    const p=z.strictObject({campaignId:id}).parse(request.params);
    const b=z.strictObject({expectedRevision:z.number().int().positive(),overrides:z.unknown(),reason:z.string().trim().max(500).optional()}).parse(request.body);
    return await domain.setCampaignConfig(actor(request),p.campaignId,b,key(request.headers));
  });
  app.get('/worlds/:worldId/canon/records',async(request)=>{
    const p=z.strictObject({worldId:id}).parse(request.params);
    return await domain.canonRecords(actor(request),p.worldId);
  });
  app.post('/worlds/:worldId/canon/records',async(request)=>{
    const p=z.strictObject({worldId:id}).parse(request.params);
    const b=z.strictObject({recordId:id,slug:z.string().trim().min(1).max(80).regex(/^[a-z0-9][a-z0-9._-]*$/),aliases:z.array(z.string().trim().min(1).max(160)).max(100),sourceStatus:z.enum(['draft','published','archived']),validFrom:z.iso.datetime().nullable(),validUntil:z.iso.datetime().nullable(),expectedRevision:z.number().int().nonnegative().optional(),links:z.array(z.strictObject({targetRecordId:id,relation:z.string().trim().min(1).max(80)})).max(100).optional()}).parse(request.body);
    return await domain.setCanonRecord(actor(request),p.worldId,b,key(request.headers));
  });
  app.get('/worlds/:worldId/canon/revisions',async(request)=>{
    const p=z.strictObject({worldId:id}).parse(request.params);
    return await domain.canonRevisions(actor(request),p.worldId);
  });
  app.post('/worlds/:worldId/canon/revisions',async(request)=>{
    const p=z.strictObject({worldId:id}).parse(request.params);
    const b=z.strictObject({recordIds:z.array(id).max(10000).default([]),note:z.string().trim().max(1000).default('')}).parse(request.body);
    return await domain.createCanonRevision(actor(request),p.worldId,b,key(request.headers));
  });
  app.post('/worlds/:worldId/canon/revisions/:revisionId/status',async(request)=>{
    const p=z.strictObject({worldId:id,revisionId:id}).parse(request.params);
    const b=z.strictObject({status:z.enum(['draft','published','archived'])}).parse(request.body);
    return await domain.setCanonRevisionStatus(actor(request),p.worldId,p.revisionId,b.status,key(request.headers));
  });
  app.get('/campaigns/:campaignId/canon',async(request)=>{
    const p=z.strictObject({campaignId:id}).parse(request.params);
    await domain.access(actor(request),{type:'campaign',id:p.campaignId});
    return (await store.get('SELECT canon_revision_id AS canonRevisionId,bound_at AS boundAt,bound_by AS boundBy FROM campaign_canon_bindings WHERE campaign_id=?',p.campaignId))??{canonRevisionId:null};
  });
  app.post('/campaigns/:campaignId/canon',async(request)=>{
    const p=z.strictObject({campaignId:id}).parse(request.params);
    const b=z.strictObject({canonRevisionId:id.nullable()}).parse(request.body);
    return await domain.bindCampaignCanon(actor(request),p.campaignId,b.canonRevisionId,key(request.headers));
  });
  app.post('/campaigns/:campaignId/members',async(request)=>{
    const params=z.strictObject({campaignId:id}).parse(request.params);
    const input=z.strictObject({userId:id,role:z.enum(['admin','creator','player','observer']).nullable(),expectedRevision:z.number().int().positive()}).parse(request.body);
    return (await domain.setMember(actor(request),params.campaignId,input,key(request.headers)));
  });
  app.post('/commands',async(request)=>{
    const input=envelopeSchema.parse(request.body);
    return (await domain.execute(actor(request),input.scope,input.command,key(request.headers),input.audit));
  });
  app.post('/foundation/commands',async request=>foundation.execute(actor(request),request.body));
  app.get('/scopes/:type/:scopeId/records',async(request)=>(await domain.list(actor(request),getScope(request.params),cursor(request.query))));
  app.get('/scopes/:type/:scopeId/records/:recordId',async(request)=>{
    const p=z.strictObject({type:z.enum(['world','campaign']),scopeId:id,recordId:id}).parse(request.params);
    return (await domain.read(actor(request),{type:p.type,id:p.scopeId},p.recordId));
  });
  app.post('/scopes/:type/:scopeId/records/:recordId/deletion-report',async request=>{
    const p=z.strictObject({type:z.enum(['world','campaign']),scopeId:id,recordId:id}).parse(request.params);
    const body=z.strictObject({note:z.string().trim().max(1000).optional()}).parse(request.body??{});
    return domain.deletionReport(actor(request),{type:p.type,id:p.scopeId},p.recordId,body.note);
  });
  app.delete('/scopes/:type/:scopeId/records/:recordId',async request=>{
    const p=z.strictObject({type:z.enum(['world','campaign']),scopeId:id,recordId:id}).parse(request.params);
    const body=z.strictObject({reportId:id,confirmation:z.string().max(200),note:z.string().trim().max(1000).optional()}).parse(request.body);
    return domain.hardDeleteRecord(actor(request),{type:p.type,id:p.scopeId},p.recordId,body.reportId,body.confirmation,body.note);
  });
  app.get('/scopes/:type/:scopeId/events',async(request)=>(await domain.history(actor(request),getScope(request.params),cursor(request.query))));
  app.get('/scopes/:type/:scopeId/audits',async(request)=>(await domain.audits(actor(request),getScope(request.params),cursor(request.query))));
  gameRoutes(app,new Game(store,{exportBytes:settings.exportBytes,importBytes:settings.importBytes}),actor,key);
  staticRoutes(app);
  return app;
}
