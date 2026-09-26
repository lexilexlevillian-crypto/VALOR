import { z } from 'zod';
import { isAbsolute } from 'node:path';
import { randomBytes } from 'node:crypto';
export type Config = {
  production:boolean; host:string; port:number; origin:string; databasePath:string;
  rateLimitSecret:string; sessionHours:number; requestLimit:number; loginLimit:number;
};
export function config(env:NodeJS.ProcessEnv=process.env):Config {
  const production=env.NODE_ENV==='production';
  const origin=z.url().parse(env.APP_ORIGIN??'http://localhost:3000');
  const url=new URL(origin);
  if(url.origin!==origin || url.username || url.password) throw new Error('APP_ORIGIN must be an origin without a path or credentials');
  const databasePath=env.DATABASE_PATH??'./data/valor.sqlite';
  const rateLimitSecret=env.RATE_LIMIT_SECRET??(production?'':randomBytes(32).toString('hex'));
  if(production && (url.protocol!=='https:' || !isAbsolute(databasePath) || databasePath===':memory:' || rateLimitSecret.length<32)) {
    throw new Error('Production requires HTTPS APP_ORIGIN, absolute persistent DATABASE_PATH, and RATE_LIMIT_SECRET of at least 32 characters');
  }
  return {production,origin,databasePath,rateLimitSecret,host:env.HOST??(production?'0.0.0.0':'127.0.0.1'),
    port:z.coerce.number().int().min(0).max(65535).parse(env.PORT??3000),
    sessionHours:12,requestLimit:120,loginLimit:10};
}
