import { createHash, createHmac, randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { Store } from './db.ts';
import { ensure } from './contracts.ts';
import type { Actor } from './contracts.ts';
import type { Config } from './config.ts';
export const credentials=z.strictObject({email:z.email().max(254).transform(v=>v.toLowerCase()),password:z.string().min(12).max(128)});
export const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
export const csrfFor=(token:string)=>hash('valor-csrf-v1:'+token);
async function passwordHash(password:string,salt=randomBytes(16).toString('hex')) {
  const key=await new Promise<Buffer>((resolve,reject)=>scrypt(password,salt,64,
    {N:65536,r:8,p:1,maxmem:128*1024*1024},
    (error,result)=>error?reject(error):resolve(result)));
  return 'scrypt-v1:'+salt+':'+key.toString('hex');
}
async function verify(password:string,encoded:string) {
  const [,salt,expected]=encoded.split(':');
  if(!salt || !expected)return false;
  const computed=await passwordHash(password,salt);
  return timingSafeEqual(Buffer.from(computed),Buffer.from(encoded));
}
export async function provisionUser(store:Store,input:{email:string;password:string;role:Actor['role']}) {
  const {email,password}=credentials.parse(input && {email:input.email,password:input.password});
  const role=z.enum(['admin','creator','player']).parse(input.role);
  const encoded=await passwordHash(password), id=randomUUID(), now=new Date().toISOString();
  (await store.transaction(async ()=>{
    (await store.run('INSERT INTO users(id,email,password_hash,role,created_at,updated_at) VALUES (?,?,?,?,?,?)',id,email,encoded,role,now,now));
    (await store.run('INSERT INTO audit_log(id,actor_id,action,target_id,created_at) VALUES (?,NULL,?,?,?)',randomUUID(),'account.provisioned',id,now));
  }));
  return {id,role};
}
export class Auth {
  store:Store; settings:Config;
  constructor(store:Store,settings:Config){this.store=store;this.settings=settings;}
  async limit(category:string,identifier:string,maximum:number,windowMs:number) {
    const bucket=createHmac('sha256',this.settings.rateLimitSecret).update(category+':'+identifier).digest('hex'), now=Date.now();
    const count=(await this.store.transaction(async ()=>{
      (await this.store.run('DELETE FROM rate_limits WHERE window_start<?',now-86400000));
      (await this.store.run('INSERT INTO rate_limits VALUES (?,?,1) ON CONFLICT(bucket) DO UPDATE SET hits=CASE WHEN rate_limits.window_start<=? THEN 1 ELSE rate_limits.hits+1 END,window_start=CASE WHEN rate_limits.window_start<=? THEN excluded.window_start ELSE rate_limits.window_start END',bucket,now,now-windowMs,now-windowMs));
      return (await this.store.get<{hits:number}>('SELECT hits FROM rate_limits WHERE bucket=?',bucket))!.hits;
    }));
    ensure(count<=maximum,429,'rate_limited');
  }
  async login(email:string,password:string) {
    const row=(await this.store.get<{id:string;role:Actor['role'];password_hash:string}>('SELECT id,role,password_hash FROM users WHERE email=? AND archived_at IS NULL',email));
    // Unknown users run the same expensive KDF and produce the same public error.
    const valid=await verify(password,row?.password_hash??('scrypt-v1:'+'0'.repeat(32)+':'+'0'.repeat(128)));
    if(!row || !valid) {
      (await this.store.run('INSERT INTO audit_log(id,action,target_id,created_at) VALUES (?,?,?,?)',randomUUID(),'auth.denied','login',new Date().toISOString()));
      ensure(false,401,'invalid_credentials');
    }
    const token=randomBytes(32).toString('hex'), now=new Date().toISOString();
    (await this.store.transaction(async ()=>{
      // Recheck after the asynchronous password operation.
      ensure((await this.store.get('SELECT id FROM users WHERE id=? AND archived_at IS NULL AND password_hash=?',row.id,row.password_hash)),401,'invalid_credentials');
      (await this.store.run('DELETE FROM sessions WHERE expires_at<=?',now));
      (await this.store.run('INSERT INTO sessions VALUES (?,?,?,?)',hash(token),row.id,now,new Date(Date.now()+this.settings.sessionHours*3600000).toISOString()));
      (await this.store.run('INSERT INTO audit_log(id,actor_id,action,target_id,created_at) VALUES (?,?,?,?,?)',randomUUID(),row.id,'auth.login',row.id,now));
    }));
    return {token,csrfToken:csrfFor(token),user:{id:row.id,role:row.role}};
  }
  async authenticate(token:string|undefined):Promise<Actor> {
    ensure(token && /^[a-f0-9]{64}$/.test(token),401,'unauthenticated');
    const actor=(await this.store.get<Actor>('SELECT u.id,u.role FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>? AND u.archived_at IS NULL',hash(token),new Date().toISOString()));
    ensure(actor,401,'unauthenticated'); return actor;
  }
  csrf(token:string,header:unknown) {
    ensure(typeof header==='string' && /^[a-f0-9]{64}$/.test(header) && timingSafeEqual(Buffer.from(csrfFor(token)),Buffer.from(header)),403,'csrf_failed');
  }
  async logout(token:string,actor:Actor) {
    (await this.store.transaction(async ()=>{
      (await this.store.run('DELETE FROM sessions WHERE token_hash=?',hash(token)));
      (await this.store.run('INSERT INTO audit_log(id,actor_id,action,target_id,created_at) VALUES (?,?,?,?,?)',randomUUID(),actor.id,'auth.logout',actor.id,new Date().toISOString()));
    }));
  }
}
