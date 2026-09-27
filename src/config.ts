import { z } from 'zod';
import { randomBytes } from 'node:crypto';
export type Config = {
  production:boolean; host:string; port:number; origin:string; databasePath:string;
  tursoDatabaseUrl?:string; tursoAuthToken?:string;
  rateLimitSecret:string; sessionHours:number; requestLimit:number; loginLimit:number;
  mutationLimit:number; aiCallLimit:number; exportLimit:number; exportBytes:number; importBytes:number;
};
export function config(env:NodeJS.ProcessEnv=process.env):Config {
  const production=env.NODE_ENV==='production';
  const origin=z.url().parse(env.APP_ORIGIN??env.RENDER_EXTERNAL_URL??'http://localhost:3000');
  const url=new URL(origin);
  if(url.origin!==origin || url.username || url.password) throw new Error('APP_ORIGIN must be an origin without a path or credentials');
  const databasePath=env.DATABASE_PATH??'./data/valor.sqlite';
  const rateLimitSecret=env.RATE_LIMIT_SECRET??(production?'':randomBytes(32).toString('hex'));
  const tursoDatabaseUrl=env.TURSO_DATABASE_URL?.trim(),tursoAuthToken=env.TURSO_AUTH_TOKEN?.trim();
  if(production && (url.protocol!=='https:' || !tursoDatabaseUrl || !tursoAuthToken || rateLimitSecret.length<32)) {
    throw new Error('Production requires HTTPS APP_ORIGIN, TURSO_DATABASE_URL, TURSO_AUTH_TOKEN, and RATE_LIMIT_SECRET of at least 32 characters');
  }
  if(!!tursoDatabaseUrl!==!!tursoAuthToken)throw new Error('Set both TURSO_DATABASE_URL and TURSO_AUTH_TOKEN');
  if(tursoDatabaseUrl){
    let valid=false;
    try{const remote=new URL(tursoDatabaseUrl);valid=['libsql:','https:'].includes(remote.protocol)&&!!remote.hostname&&!remote.username&&!remote.password&&!remote.search&&!remote.hash&&['','/'].includes(remote.pathname);}catch{}
    if(!valid)throw new Error('TURSO_DATABASE_URL must be a secure libsql:// or https:// database URL without credentials, query, or path');
  }
  const gatewayUrl=env.AI_GATEWAY_URL?.trim(),gatewaySecret=env.AI_GATEWAY_SECRET?.trim();
  if(!!gatewayUrl!==!!gatewaySecret)throw new Error('Set both AI_GATEWAY_URL and AI_GATEWAY_SECRET');
  if(gatewaySecret&&gatewaySecret.length<32)throw new Error('AI_GATEWAY_SECRET must be at least 32 characters');
  const bounded=(value:string|undefined,fallback:number,min:number,max:number)=>z.coerce.number().int().min(min).max(max).parse(value??fallback);
  return {production,origin,databasePath,tursoDatabaseUrl,tursoAuthToken,rateLimitSecret,host:env.HOST??(production?'0.0.0.0':'127.0.0.1'),
    port:z.coerce.number().int().min(0).max(65535).parse(env.PORT??3000),
    sessionHours:bounded(env.SESSION_HOURS,12,1,168),
    requestLimit:bounded(env.REQUEST_LIMIT,120,10,10000),
    loginLimit:bounded(env.LOGIN_LIMIT,10,1,100),
    mutationLimit:bounded(env.MUTATION_LIMIT,60,1,1000),
    aiCallLimit:bounded(env.AI_CALL_LIMIT,10,1,100),
    exportLimit:bounded(env.EXPORT_LIMIT,10,1,100),
    exportBytes:bounded(env.EXPORT_MAX_BYTES,8*1024*1024,1024,64*1024*1024),
    importBytes:bounded(env.IMPORT_MAX_BYTES,8*1024*1024,1024,64*1024*1024)};
}
