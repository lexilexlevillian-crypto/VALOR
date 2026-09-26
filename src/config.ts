import { z } from 'zod';
import { randomBytes } from 'node:crypto';
export type Config = {
  production:boolean; host:string; port:number; origin:string; databasePath:string;
  tursoDatabaseUrl?:string; tursoAuthToken?:string;
  rateLimitSecret:string; sessionHours:number; requestLimit:number; loginLimit:number;
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
  return {production,origin,databasePath,tursoDatabaseUrl,tursoAuthToken,rateLimitSecret,host:env.HOST??(production?'0.0.0.0':'127.0.0.1'),
    port:z.coerce.number().int().min(0).max(65535).parse(env.PORT??3000),
    sessionHours:12,requestLimit:120,loginLimit:10};
}
