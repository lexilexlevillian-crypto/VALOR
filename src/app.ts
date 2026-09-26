import Fastify, { LogController } from 'fastify';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { Store } from './db.ts';
import { Domain } from './domain.ts';
import { Auth, credentials, csrfFor } from './auth.ts';
import { Fault, ensure, envelopeSchema, id, name, scopeSchema } from './contracts.ts';
import type { Actor, Scope } from './contracts.ts';
import type { Config } from './config.ts';
import { Game } from './game/engine.ts';
import { gameRoutes } from './game/routes.ts';
import { publicAssets, shell, shellPolicy, staticRoutes } from './static.ts';

export function buildApp(store:Store,settings:Config,logging:boolean|{write(chunk:string):void}=true) {
  const domain=new Domain(store),auth=new Auth(store,settings);
  const app=Fastify({
    bodyLimit:32768,requestTimeout:15000,connectionTimeout:10000,
    trustProxy:false,requestIdHeader:false,genReqId:()=>randomUUID(),logController:new LogController({disableRequestLogging:true}),
    logger:logging?{level:'info',...(typeof logging==='object'?{stream:logging}:{}),redact:{paths:['password','token','csrfToken','req.headers.cookie','req.headers.authorization','req.headers.x-csrf-token','req.body'],censor:'[REDACTED]'}}:false
  });
  const cookieName=settings.production?'__Host-valor_session':'valor_session';
  const cookie=(token:string,maxAge:number)=>cookieName+'='+token+'; Path=/; HttpOnly; SameSite=Strict; Max-Age='+maxAge+(settings.production?'; Secure':'');
  const tokenFrom=(header:string|undefined)=>header?.split(';').map(s=>s.trim()).find(s=>s.startsWith(cookieName+'='))?.slice(cookieName.length+1);
  const actors=new WeakMap<object,Actor>();
  app.addHook('onRequest',async(request,reply)=>{
    reply.header('Cache-Control','no-store');
    reply.header('X-Content-Type-Options','nosniff');
    reply.header('Referrer-Policy','no-referrer');
    reply.header('Content-Security-Policy',"default-src 'none'; frame-ancestors 'none'; base-uri 'none'");
    reply.header('X-Request-Id',request.id);
    if(settings.production)reply.header('Strict-Transport-Security','max-age=31536000');
    // Never trust X-Forwarded-For supplied by a client. Proxy policy remains deployment-specific.
    auth.limit('request',request.ip,settings.requestLimit,60000);
    const path=request.url.split('?')[0];
    const unsafe=!['GET','HEAD','OPTIONS'].includes(request.method);
    if(unsafe)ensure(request.headers.origin===settings.origin,403,'origin_rejected');
    if((path==='/healthz' || path==='/' || publicAssets.has(path??'')) && (request.method==='GET' || request.method==='HEAD'))return;
    if(path==='/auth/login' && request.method==='POST') {
      auth.limit('login-ip',request.ip,settings.loginLimit*3,900000);
      return;
    }
    const token=tokenFrom(request.headers.cookie);
    const actor=auth.authenticate(token); actors.set(request,actor);
    if(unsafe)auth.csrf(token!,request.headers['x-csrf-token']);
  });
  app.addHook('onResponse',async(request,reply)=>{
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
  app.get('/healthz',async()=>{store.get('SELECT 1');return {status:'ok'};});
  app.post('/auth/login',async(request,reply)=>{
    const input=credentials.parse(request.body);
    auth.limit('login-account',input.email,settings.loginLimit,900000);
    const result=await auth.login(input.email,input.password);
    reply.header('Set-Cookie',cookie(result.token,settings.sessionHours*3600));
    return {user:result.user,csrfToken:result.csrfToken};
  });
  app.get('/auth/session',async(request)=>({user:actor(request),csrfToken:csrfFor(tokenFrom(request.headers.cookie)!)}));
  app.post('/auth/logout',async(request,reply)=>{
    auth.logout(tokenFrom(request.headers.cookie)!,actor(request));
    reply.header('Set-Cookie',cookie('',0));return {ok:true};
  });
  app.post('/worlds',async(request,reply)=>{
    const input=z.strictObject({name}).parse(request.body);
    reply.code(201);return domain.createWorld(actor(request),input.name,key(request.headers));
  });
  app.get('/worlds',async(request)=>{
    const after=cursor(request.query);
    return {items:store.all('SELECT id,name,revision FROM worlds WHERE owner_id=? AND archived_at IS NULL AND id>? ORDER BY id LIMIT 100',actor(request).id,after)};
  });
  const campaignInput=z.strictObject({
    worldId:id,name,startingAt:z.iso.datetime(),
    timezone:z.string().max(100).refine(value=>{try{new Intl.DateTimeFormat('en-US',{timeZone:value});return true;}catch{return false;}},'Invalid timezone')
  });
  app.post('/campaigns',async(request,reply)=>{
    reply.code(201);return domain.createCampaign(actor(request),campaignInput.parse(request.body),key(request.headers));
  });
  app.get('/campaigns',async(request)=>{
    const after=cursor(request.query);
    return {items:store.all('SELECT c.id,c.name,c.starting_at,c.timezone,c.revision,m.role FROM campaigns c JOIN memberships m ON m.campaign_id=c.id WHERE m.user_id=? AND c.archived_at IS NULL AND c.id>? ORDER BY c.id LIMIT 100',actor(request).id,after)};
  });
  app.post('/campaigns/:campaignId/members',async(request)=>{
    const params=z.strictObject({campaignId:id}).parse(request.params);
    const input=z.strictObject({userId:id,role:z.enum(['admin','creator','player','observer']).nullable(),expectedRevision:z.number().int().positive()}).parse(request.body);
    return domain.setMember(actor(request),params.campaignId,input,key(request.headers));
  });
  app.post('/commands',async(request)=>{
    const input=envelopeSchema.parse(request.body);
    return domain.execute(actor(request),input.scope,input.command,key(request.headers));
  });
  app.get('/scopes/:type/:scopeId/records',async(request)=>domain.list(actor(request),getScope(request.params),cursor(request.query)));
  app.get('/scopes/:type/:scopeId/records/:recordId',async(request)=>{
    const p=z.strictObject({type:z.enum(['world','campaign']),scopeId:id,recordId:id}).parse(request.params);
    return domain.read(actor(request),{type:p.type,id:p.scopeId},p.recordId);
  });
  app.get('/scopes/:type/:scopeId/events',async(request)=>domain.history(actor(request),getScope(request.params),cursor(request.query)));
  app.get('/scopes/:type/:scopeId/audits',async(request)=>domain.audits(actor(request),getScope(request.params),cursor(request.query)));
  gameRoutes(app,new Game(store),actor,key);
  staticRoutes(app);
  return app;
}
