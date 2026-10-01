import {randomUUID} from 'node:crypto';
import {ensure} from '../contracts.ts';
import type {Actor} from '../contracts.ts';
import type {Game} from './engine.ts';
type Source={timeline_id:string;owner_id:string;campaign_id:string;source_world_id:string;name:string;revision:number;timezone:string};
export class SharedWorld {
 readonly game:Game;
 constructor(game:Game){this.game=game;}
 get store(){return this.game.store;}
 async source(){return this.store.get<Source>('SELECT w.timeline_id,w.owner_id,t.campaign_id,t.revision,c.source_world_id,c.name,c.timezone FROM shared_world w JOIN timelines t ON t.id=w.timeline_id JOIN campaigns c ON c.id=t.campaign_id JOIN users u ON u.id=w.owner_id WHERE w.id=1 AND t.archived_at IS NULL AND c.archived_at IS NULL AND u.archived_at IS NULL');}
 async describe(actor:Actor){
  await this.game.domain.active(actor);const source=await this.source();
  const editor=source?.owner_id===actor.id;
  return {ready:!!source,name:source?.name??'Valor',...(editor?{editor:{campaignId:source.campaign_id,timelineId:source.timeline_id}}:{})};
 }
 async setup(actor:Actor,timelineId?:string){return this.store.transaction(async()=>{
  const user=await this.game.domain.active(actor);ensure(['creator','admin'].includes(user.role),403,'forbidden');
  const existing=await this.source();
  if(existing){ensure(existing.owner_id===actor.id,403,'world_owner_only');ensure(!timelineId||timelineId===existing.timeline_id,409,'shared_world_already_selected');return this.describe(actor);}
  ensure(!await this.store.get('SELECT id FROM shared_world WHERE id=1'),409,'shared_world_source_unavailable');
  if(!timelineId){
   const world=await this.game.domain.createWorld(actor,'Valor',randomUUID());
   const campaign=await this.game.domain.createCampaign(actor,{worldId:world.id,name:'Valor',startingAt:'2012-01-01T16:00:00.000Z',timezone:'America/Los_Angeles'},randomUUID());
   timelineId=(await this.game.initialize(actor,campaign.id)).id;
   await this.game.installCatalog(actor,timelineId,1,randomUUID());
   await this.game.createStartPackage(actor,timelineId,{name:'A new life in Valor',slug:'new-life',kind:'guided',visibility:'campaign',status:'published',description:'Create your character and begin your own life in the city.',definition:{character:{name:'New arrival',data:{}}}},randomUUID());
  }
  const {t,access}=await this.game.access(actor,timelineId,true);ensure(access.owner_id===actor.id,403,'world_owner_only');
  const state=await this.game.load(timelineId);
  ensure(!state.entities.some(e=>e.kind==='character'&&(e.data.playable||e.data.controllerUserId)),409,'world_source_contains_player_lives');
  await this.store.run('INSERT INTO shared_world VALUES (1,?,?,?)',timelineId,actor.id,new Date().toISOString());
  await this.audit(actor,t.campaign_id,'shared-world.selected',timelineId);
  return this.describe(actor);
 });}
 private async audit(actor:Actor,campaignId:string,action:string,target:string){await this.store.run('INSERT INTO audit_log(id,actor_id,campaign_id,action,target_id,created_at,request_id,reason) VALUES (?,?,?,?,?,?,?,?)',randomUUID(),actor.id,campaignId,action,target,new Date().toISOString(),actor.requestId??null,action);}
 async enter(actor:Actor,requestKey:string){return this.store.transaction(async()=>{
  await this.game.domain.active(actor);ensure(/^[A-Za-z0-9_-]{16,128}$/.test(requestKey),400,'invalid_idempotency_key');
  const response=async(campaignId:string,timelineId:string)=>{await this.game.access(actor,timelineId);return {campaign:await this.store.get<{id:string;name:string;timezone:string;sourceWorldId:string;role:string}>('SELECT c.id,c.name,c.timezone,c.source_world_id AS sourceWorldId,m.role FROM campaigns c JOIN memberships m ON m.campaign_id=c.id WHERE c.id=? AND m.user_id=? AND c.archived_at IS NULL',campaignId,actor.id),timeline:await this.store.get<{id:string;name:string;revision:number;clock:string}>('SELECT id,name,revision,clock FROM timelines WHERE id=? AND archived_at IS NULL',timelineId)};};
  const receipt=await this.store.get<{campaign_id:string;timeline_id:string}>('SELECT campaign_id,timeline_id FROM life_entry_receipts WHERE user_id=? AND request_key=?',actor.id,requestKey);
  if(receipt)return response(receipt.campaign_id,receipt.timeline_id);
  const source=await this.source();ensure(source,409,'shared_world_not_ready');
  // Reuse an unfinished, current-version creation screen. Never overwrite a life.
  const draft=await this.store.get<{campaign_id:string;id:string}>('SELECT p.campaign_id,t.id FROM player_lives p JOIN campaigns c ON c.id=p.campaign_id JOIN timelines t ON t.campaign_id=c.id WHERE p.user_id=? AND p.source_timeline_id=? AND p.source_revision=? AND c.archived_at IS NULL AND t.archived_at IS NULL AND NOT EXISTS (SELECT 1 FROM campaign_start_packages sp WHERE sp.campaign_id=? AND sp.updated_at>p.created_at) AND NOT EXISTS (SELECT 1 FROM campaign_theme_settings ts WHERE ts.campaign_id=? AND ts.updated_at>p.created_at) AND NOT EXISTS (SELECT 1 FROM game_entities e WHERE e.timeline_id=t.id AND e.kind=\'character\' AND json_extract(e.data_json,\'$.playable\')=1) ORDER BY p.created_at DESC LIMIT 1',actor.id,source.timeline_id,source.revision,source.campaign_id,source.campaign_id);
  if(draft){await this.store.run('INSERT INTO life_entry_receipts VALUES (?,?,?,?)',actor.id,requestKey,draft.campaign_id,draft.id);return response(draft.campaign_id,draft.id);}
  const count=await this.store.get<{n:number}>('SELECT count(*) n FROM player_lives WHERE user_id=?',actor.id);ensure((count?.n??0)<100,409,'life_limit_reached');
  const state=await this.game.load(source.timeline_id);
  ensure(!state.entities.some(e=>e.kind==='character'&&(e.data.playable||e.data.controllerUserId)),409,'world_source_contains_player_lives');
  const packages=await this.store.all<{slug:string;name:string;description:string;kind:string;definition_json:string;schema_version:number;revision:number}>("SELECT * FROM campaign_start_packages WHERE campaign_id=? AND status='published' AND visibility='campaign' AND archived_at IS NULL",source.campaign_id);
  ensure(packages.length>0,409,'shared_world_needs_start');
  const cid=randomUUID(),tid=randomUUID(),at=new Date().toISOString(),name=source.name+' · Life '+((count?.n??0)+1);
  // The player receives a player membership only; never Creator or source-world access.
  await this.store.run('INSERT INTO campaigns(id,owner_id,source_world_id,name,starting_at,timezone,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)',cid,source.owner_id,source.source_world_id,name,state.clock,state.settings.timezone,at,at);
  await this.store.run('INSERT INTO memberships(campaign_id,user_id,role,created_at,updated_at) VALUES (?,?,?,?,?)',cid,actor.id,'player',at,at);
  await this.store.run('INSERT INTO campaign_configurations(campaign_id,defaults_json,overrides_json,created_at,updated_at,updated_by) SELECT ?,defaults_json,overrides_json,?,?,? FROM campaign_configurations WHERE campaign_id=?',cid,at,at,actor.id,source.campaign_id);
  await this.store.run('INSERT INTO campaign_theme_settings(campaign_id,recommended_theme_id,allowed_themes_json,created_at,updated_at,updated_by) SELECT ?,recommended_theme_id,allowed_themes_json,?,?,? FROM campaign_theme_settings WHERE campaign_id=?',cid,at,at,actor.id,source.campaign_id);
  await this.store.run('INSERT INTO timelines(id,campaign_id,name,clock,settings_json,created_at) VALUES (?,?,?,?,?,?)',tid,cid,'My life',state.clock,JSON.stringify(state.settings),at);
  await this.store.run('INSERT INTO timeline_canon_sources VALUES (?,?)',tid,JSON.stringify(state.canon??null));
  const history=await this.game.worldHistory(source.timeline_id);
  await this.store.run('INSERT INTO timeline_world_history VALUES (?,?)',tid,JSON.stringify(history));
  await this.game.persist(tid,state);
  for(const p of packages)await this.store.run("INSERT INTO campaign_start_packages(id,campaign_id,slug,name,description,kind,visibility,status,definition_json,schema_version,revision,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,'campaign','published',?,?,?,?,?,?)",randomUUID(),cid,p.slug,p.name,p.description,p.kind,p.definition_json,p.schema_version,p.revision,source.owner_id,at,at);
  await this.store.run('INSERT INTO player_lives VALUES (?,?,?,?,?)',cid,actor.id,source.timeline_id,source.revision,at);
  await this.store.run('INSERT INTO life_entry_receipts VALUES (?,?,?,?)',actor.id,requestKey,cid,tid);
  await this.audit(actor,cid,'player-life.created',tid);
  return response(cid,tid);
 });}
}
