import { createHash, createHmac, randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { Store } from './db.ts';
import { Fault, ensure } from './contracts.ts';
import type { Actor } from './contracts.ts';
import type { Config } from './config.ts';
export const credentials=z.strictObject({email:z.email().max(254).transform(v=>v.toLowerCase()),password:z.string().min(12).max(128)});
export const recoveryCredentials=z.strictObject({email:z.email().max(254).transform(v=>v.toLowerCase()),recoveryKey:z.string().trim().min(1).max(256),newPassword:z.string().min(12).max(128)});
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
  async signup(email:string,password:string) {
    const input=credentials.parse({email,password});
    const existing=await this.store.get<{id:string}>('SELECT id FROM users WHERE email=?',input.email);
    ensure(!existing,409,'account_exists');
    const encoded=await passwordHash(input.password), id=randomUUID(), now=new Date().toISOString();
    const token=randomBytes(32).toString('hex');
    try {
      await this.store.transaction(async ()=>{
        (await this.store.run('INSERT INTO users(id,email,password_hash,role,created_at,updated_at) VALUES (?,?,?,?,?,?)',id,input.email,encoded,'player',now,now));
        (await this.store.run('INSERT INTO sessions VALUES (?,?,?,?)',hash(token),id,now,new Date(Date.now()+this.settings.sessionHours*3600000).toISOString()));
        (await this.store.run('INSERT INTO audit_log(id,actor_id,action,target_id,created_at) VALUES (?,NULL,?,?,?)',randomUUID(),'account.signup',id,now));
        (await this.store.run('INSERT INTO audit_log(id,actor_id,action,target_id,created_at) VALUES (?,?,?,?,?)',randomUUID(),id,'auth.login',id,now));
      });
    } catch(error) {
      if(error instanceof Error && /unique/i.test(error.message))throw new Fault(409,'account_exists');
      throw error;
    }
    return {token,csrfToken:csrfFor(token),user:{id,role:'player' as const}};
  }
  async recoverPassword(email:string,recoveryKey:string,newPassword:string,requestId?:string) {
    const configured=this.settings.passwordRecoveryKey;
    const supplied=Buffer.from(hash(recoveryKey),'hex'),expected=Buffer.from(hash(configured??'valor-unconfigured-password-recovery-key'),'hex');
    const accepted=Boolean(configured)&&timingSafeEqual(supplied,expected);
    const user=accepted?await this.store.get<{id:string;password_hash:string}>('SELECT id,password_hash FROM users WHERE email=? AND archived_at IS NULL',email):undefined;
    if(!accepted||!user){
      await this.store.run('INSERT INTO audit_log(id,action,target_id,created_at,request_id,reason) VALUES (?,?,?,?,?,?)',randomUUID(),'auth.password_recovery.denied','password-recovery',new Date().toISOString(),requestId??null,'invalid-recovery-credentials');
      ensure(false,403,'invalid_recovery_credentials');
    }
    const encoded=await passwordHash(newPassword),now=new Date().toISOString();
    return this.store.transaction(async()=>{
      const current=await this.store.get<{id:string;password_hash:string}>('SELECT id,password_hash FROM users WHERE id=? AND archived_at IS NULL',user.id);
      ensure(current&&current.password_hash===user.password_hash,409,'account_changed_retry');
      await this.store.run('UPDATE users SET password_hash=?,revision=revision+1,updated_at=? WHERE id=?',encoded,now,user.id);
      await this.store.run('DELETE FROM sessions WHERE user_id=?',user.id);
      await this.store.run('INSERT INTO audit_log(id,actor_id,action,target_id,created_at,request_id,reason,before_json,after_json) VALUES (?,?,?,?,?,?,?,?,?)',randomUUID(),user.id,'auth.password.recovered',user.id,now,requestId??null,'recovery-key',JSON.stringify({sessionsRevoked:true}),JSON.stringify({passwordChanged:true}));
      return {ok:true};
    });
  }
  async grantDeveloperAccess(actor:Actor,accessKey:string,expectedRevision:number,requestId?:string) {
    const configured=this.settings.developerAccessKey;
    const supplied=Buffer.from(hash(accessKey),'hex'),expected=Buffer.from(hash(configured??'valor-unconfigured-developer-access-key'),'hex');
    const accepted=Boolean(configured)&&timingSafeEqual(supplied,expected);
    if(!accepted){
      await this.store.run('INSERT INTO audit_log(id,actor_id,action,target_id,created_at,request_id,reason) VALUES (?,?,?,?,?,?,?)',randomUUID(),actor.id,'developer.access.denied',actor.id,new Date().toISOString(),requestId??null,'invalid-access-key');
      ensure(false,403,'invalid_developer_access_key');
    }
    return this.store.transaction(async()=>{
      const user=await this.store.get<{id:string;role:Actor['role'];revision:number}>('SELECT id,role,revision FROM users WHERE id=? AND archived_at IS NULL',actor.id);ensure(user,401,'unauthenticated');
      const preference=await this.store.get<{mode:string;revision:number}>('SELECT mode,revision FROM user_mode_preferences WHERE user_id=?',actor.id),currentRevision=preference?.revision??0;
      ensure(currentRevision===expectedRevision,409,'revision_conflict');
      const memberships=await this.store.all<{campaign_id:string;role:string}>('SELECT campaign_id,role FROM memberships WHERE user_id=? ORDER BY campaign_id',actor.id);
      const now=new Date().toISOString(),role:Actor['role']=user.role==='player'?'creator':user.role,revision=currentRevision+1;
      if(user.role==='player')await this.store.run('UPDATE users SET role=?,revision=revision+1,updated_at=? WHERE id=? AND revision=?',role,now,actor.id,user.revision);
      for(const membership of memberships){
        if(membership.role==='admin'||membership.role==='creator')continue;
        await this.store.run('UPDATE memberships SET role=?,revision=revision+1,updated_at=? WHERE campaign_id=? AND user_id=?','creator',now,membership.campaign_id,actor.id);
        await this.store.run('INSERT INTO audit_log(id,actor_id,campaign_id,action,target_id,created_at,request_id,reason,before_json,after_json,note) VALUES (?,?,?,?,?,?,?,?,?,?,?)',randomUUID(),actor.id,membership.campaign_id,'membership.developer_access.granted',actor.id,now,requestId??null,'developer-access-key',JSON.stringify({role:membership.role}),JSON.stringify({role:'creator'}),null);
      }
      await this.store.run('INSERT INTO user_mode_preferences(user_id,mode,revision,created_at,updated_at) VALUES (?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET mode=excluded.mode,revision=excluded.revision,updated_at=excluded.updated_at',actor.id,'developer',revision,now,now);
      const campaignRoles=memberships.map(row=>({campaignId:row.campaign_id,role:row.role==='admin'||row.role==='creator'?row.role:'creator'}));
      await this.store.run('INSERT INTO audit_log(id,actor_id,action,target_id,created_at,request_id,reason,before_json,after_json,note) VALUES (?,?,?,?,?,?,?,?,?,?)',randomUUID(),actor.id,'developer.access.granted',actor.id,now,requestId??null,'developer-access-key',JSON.stringify({role:user.role,mode:preference?.mode??'player',campaignRoles:memberships}),JSON.stringify({role,mode:'developer',campaignRoles}),null);
      return {user:{id:actor.id,role},mode:'developer' as const,revision,developerAllowed:true,campaignRoles};
    });
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
