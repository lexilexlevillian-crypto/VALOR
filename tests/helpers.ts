import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Store } from '../src/db.ts';
import { Domain } from '../src/domain.ts';
import { config } from '../src/config.ts';
import { provisionUser } from '../src/auth.ts';
import { buildApp } from '../src/app.ts';
import type { Command, Scope } from '../src/contracts.ts';
export const password='Test-only passphrase 123!';
export const key=()=>randomUUID();
export async function fixture() {
  const dir=mkdtempSync(join(tmpdir(),'valor-test-'));
  const store=new Store(join(dir,'test.sqlite'));store.migrate();
  const creator=await provisionUser(store,{email:'creator@example.test',password,role:'creator'});
  const other=await provisionUser(store,{email:'other@example.test',password,role:'admin'});
  const player=await provisionUser(store,{email:'player@example.test',password,role:'player'});
  const observer=await provisionUser(store,{email:'observer@example.test',password,role:'player'});
  const domain=new Domain(store);
  const world=domain.createWorld(creator,'Test authored world',key());
  const campaign=domain.createCampaign(creator,{worldId:world.id,name:'Test instance',startingAt:'2012-06-01T12:00:00Z',timezone:'America/New_York'},key());
  domain.setMember(creator,campaign.id,{userId:player.id,role:'player',expectedRevision:1},key());
  domain.setMember(creator,campaign.id,{userId:observer.id,role:'observer',expectedRevision:2},key());
  const scope:Scope={type:'campaign',id:campaign.id};
  const settings={...config({}),databasePath:store.path,requestLimit:1000};
  const app=buildApp(store,settings,false);
  const execute=(command:Command,cmdKey=key())=>domain.execute(creator,scope,command,cmdKey);
  return {dir,store,domain,creator,other,player,observer,world,campaign,scope,settings,app,execute,
    async close(){await app.close();store.close();rmSync(dir,{recursive:true,force:true});}};
}
export async function login(f:Awaited<ReturnType<typeof fixture>>,email='creator@example.test') {
  const response=await f.app.inject({method:'POST',url:'/auth/login',headers:{origin:f.settings.origin},payload:{email,password}});
  if(response.statusCode!==200)throw new Error(response.body);
  return {cookie:String(response.headers['set-cookie']).split(';')[0]!,csrf:response.json().csrfToken as string};
}
