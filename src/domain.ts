import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Store } from './db.ts';
import { ensure, eventSchema, commandSchema } from './contracts.ts';
import type { Actor, Command, DomainEvent, Scope } from './contracts.ts';
import {campaignConfigOverridesSchema,defaultCampaignConfig,parseStoredCampaignConfig,resolveCampaignConfig} from './campaign-config.ts';
import {defaultThemeId,themeIdSchema,themeIds} from './theme.ts';
import {auditJson} from './security.ts';

type RecordRow = {id:string; world_id:string|null; campaign_id:string|null; owner_id:string; kind:string; name:string; visibility:string; revision:number; archived_at:string|null};
type SectionRow = {id:string; record_id:string; parent_id:string|null; name:string; position:number; visibility:string; archived_at:string|null};
type FieldRow = {id:string; record_id:string; section_id:string; name:string; position:number; visibility:string; value_type:string; archived_at:string|null};
type ScopeAccess = {role:string; owner_id:string; revision:number};
type Receipt = {request_hash:string; response_json:string};
type AuditContext = {reason?:string;note?:string;before?:unknown;after?:unknown};
export type CommandResult = {id:string; revision:number; eventId:string; sectionId?:string; fieldId?:string};
const clock = () => new Date().toISOString();
function canonical(value:unknown):string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>JSON.stringify(k)+':'+canonical(v)).join(',') + '}';
  return JSON.stringify(value);
}
function digest(value:unknown) { return createHash('sha256').update(canonical(value)).digest('hex'); }
const column = (scope:Scope) => scope.type === 'world' ? 'world_id' : 'campaign_id';
const privileged = (role:string) => role === 'admin' || role === 'creator';

export class Domain {
  store:Store;
  constructor(store:Store) { this.store=store; }
  async active(actor:Actor) {
    const user = (await this.store.get<Actor>('SELECT id,role FROM users WHERE id=? AND archived_at IS NULL', actor.id));
    ensure(user,401,'unauthenticated');
    return user;
  }
  async access(actor:Actor, scope:Scope, write=false):Promise<ScopeAccess> {
    (await this.active(actor));
    let result:ScopeAccess|undefined;
    if(scope.type === 'world') {
      result=(await this.store.get('SELECT owner_id,revision FROM worlds WHERE id=? AND owner_id=? AND archived_at IS NULL',scope.id,actor.id));
      if(result) result.role='creator';
    } else {
      result=(await this.store.get('SELECT c.owner_id,c.revision,m.role FROM campaigns c JOIN memberships m ON m.campaign_id=c.id WHERE c.id=? AND m.user_id=? AND c.archived_at IS NULL',scope.id,actor.id));
    }
    ensure(result,404,'not_found');
    if(write) ensure(privileged(result.role),403,'forbidden');
    return result;
  }
  private async replay(scopeId:string, actor:Actor, key:string, body:unknown):Promise<CommandResult|undefined> {
    ensure(/^[A-Za-z0-9_-]{16,128}$/.test(key),400,'invalid_idempotency_key');
    const row=(await this.store.get<Receipt>('SELECT request_hash,response_json FROM command_receipts WHERE scope_id=? AND actor_id=? AND key=?',scopeId,actor.id,key));
    if(!row) return;
    ensure(row.request_hash===digest(body),409,'idempotency_conflict');
    return JSON.parse(row.response_json);
  }
  private async finish(scope:Scope, actor:Actor, key:string, body:unknown, result:Omit<CommandResult,'eventId'>, type:string, payload:Record<string,unknown>, receiptScope=scope.id, audit:AuditContext={before:undefined,after:payload,reason:type}):Promise<CommandResult> {
    const now=clock();
    const event=eventSchema.parse({
      id:randomUUID(),schemaVersion:1,actorId:actor.id,aggregateId:result.id,aggregateRevision:result.revision,
      type,payload,seed:randomBytes(32).toString('hex'),rngVersion:'hmac-sha256-v1',createdAt:now
    });
    const world=scope.type==='world'?scope.id:null, campaign=scope.type==='campaign'?scope.id:null;
    (await this.store.run('INSERT INTO domain_events VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',event.id,1,world,campaign,actor.id,result.id,result.revision,type,JSON.stringify(event.payload),event.seed,event.rngVersion,now));
    const auditContext=(await this.store.get<{name:string}>("SELECT name FROM pragma_table_info('audit_log') WHERE name='request_id'"));
    const auditNote=(await this.store.get<{name:string}>("SELECT name FROM pragma_table_info('audit_log') WHERE name='note'"));
    if(auditContext&&auditNote) (await this.store.run('INSERT INTO audit_log(id,actor_id,world_id,campaign_id,action,target_id,event_id,created_at,request_id,reason,before_json,after_json,note) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',randomUUID(),actor.id,world,campaign,type,result.id,event.id,now,actor.requestId??null,audit.reason??null,auditJson(audit.before),auditJson(audit.after),audit.note??null));
    else if(auditContext) (await this.store.run('INSERT INTO audit_log(id,actor_id,world_id,campaign_id,action,target_id,event_id,created_at,request_id,reason,before_json,after_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',randomUUID(),actor.id,world,campaign,type,result.id,event.id,now,actor.requestId??null,audit.reason??null,auditJson(audit.before),auditJson(audit.after)));
    else (await this.store.run('INSERT INTO audit_log(id,actor_id,world_id,campaign_id,action,target_id,event_id,created_at) VALUES (?,?,?,?,?,?,?,?)',randomUUID(),actor.id,world,campaign,type,result.id,event.id,now));
    (await this.store.run('INSERT INTO outbox(event_id,created_at) VALUES (?,?)',event.id,now));
    const response={...result,eventId:event.id};
    (await this.store.run('INSERT INTO command_receipts VALUES (?,?,?,?,?,?,?)',receiptScope,actor.id,key,digest(body),JSON.stringify(response),event.id,now));
    return response;
  }
  async createWorld(actor:Actor, name:string, key:string) {
    return (await this.store.transaction(async ()=>{
      const user=(await this.active(actor));
      ensure(privileged(user.role),403,'forbidden');
      const body={name};
      const replay=(await this.replay('world.create',actor,key,body)); if(replay) return replay;
      const id=randomUUID(), now=clock();
      (await this.store.run('INSERT INTO worlds(id,owner_id,name,created_at,updated_at) VALUES (?,?,?,?,?)',id,actor.id,name,now,now));
      return (await this.finish({type:'world',id},actor,key,body,{id,revision:1},'world.created',{name},'world.create'));
    }));
  }
  async createCampaign(actor:Actor, input:{worldId:string;name:string;startingAt:string;timezone:string;configuration?:{overrides?:unknown}},key:string) {
    return (await this.store.transaction(async ()=>{
      (await this.access(actor,{type:'world',id:input.worldId},true));
      const replay=(await this.replay('campaign.create',actor,key,input)); if(replay) return replay;
      const id=randomUUID(), now=clock(), defaults=defaultCampaignConfig(input.startingAt,input.timezone), overrides=campaignConfigOverridesSchema.parse(input.configuration?.overrides??{});
      resolveCampaignConfig(defaults,overrides);
      (await this.store.run('INSERT INTO campaigns(id,owner_id,source_world_id,name,starting_at,timezone,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)',id,actor.id,input.worldId,input.name,input.startingAt,input.timezone,now,now));
      (await this.store.run('INSERT INTO campaign_configurations(campaign_id,defaults_json,overrides_json,created_at,updated_at,updated_by) VALUES (?,?,?,?,?,?)',id,JSON.stringify(defaults),JSON.stringify(overrides),now,now,actor.id));
      (await this.store.run('INSERT INTO campaign_theme_settings(campaign_id,recommended_theme_id,allowed_themes_json,created_at,updated_at,updated_by) VALUES (?,?,?,?,?,?)',id,defaultThemeId,JSON.stringify([...themeIds]),now,now,actor.id));
      (await this.store.run('INSERT INTO memberships(campaign_id,user_id,role,created_at,updated_at) VALUES (?,?,?,?,?)',id,actor.id,'creator',now,now));
      return (await this.finish({type:'campaign',id},actor,key,input,{id,revision:1},'campaign.created',input,'campaign.create'));
    }));
  }
  async campaignConfig(actor:Actor,campaignId:string){
    (await this.access(actor,{type:'campaign',id:campaignId}));
    const row=await this.store.get<{defaults_json:string;overrides_json:string;revision:number;schema_version:number}>('SELECT defaults_json,overrides_json,revision,schema_version FROM campaign_configurations WHERE campaign_id=?',campaignId);
    ensure(row,404,'campaign_config_unavailable');
    const stored=parseStoredCampaignConfig(row);
    return {...stored,resolved:resolveCampaignConfig(stored.defaults,stored.overrides)};
  }
  async setCampaignConfig(actor:Actor,campaignId:string,input:{expectedRevision:number;overrides:unknown;reason?:string},key:string){
    const scope:Scope={type:'campaign',id:campaignId};
    return await this.store.transaction(async()=>{
      const access=await this.access(actor,scope,true),body={type:'campaign.configuration',...input};
      const replay=await this.replay(campaignId,actor,key,body);if(replay)return replay;
      const row=await this.store.get<{defaults_json:string;overrides_json:string;revision:number;schema_version:number}>('SELECT defaults_json,overrides_json,revision,schema_version FROM campaign_configurations WHERE campaign_id=?',campaignId);
      ensure(row,404,'campaign_config_unavailable');ensure(row.revision===input.expectedRevision,409,'revision_conflict');
      const stored=parseStoredCampaignConfig(row),overrides=campaignConfigOverridesSchema.parse(input.overrides),resolved=resolveCampaignConfig(stored.defaults,overrides),before={defaults:stored.defaults,overrides:stored.overrides,resolved:resolveCampaignConfig(stored.defaults,stored.overrides)};
      const now=clock(),configRevision=row.revision+1,campaignRevision=access.revision+1;
      await this.store.run('UPDATE campaign_configurations SET overrides_json=?,revision=?,updated_at=?,updated_by=? WHERE campaign_id=?',JSON.stringify(overrides),configRevision,now,actor.id,campaignId);
      await this.store.run('UPDATE campaigns SET revision=revision+1,updated_at=? WHERE id=?',now,campaignId);
      const timelines=await this.store.all<{id:string;settings_json:string}>('SELECT id,settings_json FROM timelines WHERE campaign_id=? AND archived_at IS NULL',campaignId);
      for(const timeline of timelines){const settings=JSON.parse(timeline.settings_json);settings.campaign=resolved;settings.timezone=resolved.timezone;settings.needs=resolved.needsIntensity!=='off';settings.intensity=resolved.injuryIntensity==='restrained'?'restrained':'grounded';if(resolved.matureContent==='off'||resolved.contentRating==='general')settings.intimacy='off';await this.store.run('UPDATE timelines SET settings_json=?,revision=revision+1 WHERE id=?',JSON.stringify(settings),timeline.id);}
      const result=await this.finish(scope,actor,key,body,{id:campaignId,revision:campaignRevision},'campaign.configuration.updated',{configRevision,resolved},campaignId,{before,after:{overrides,resolved},reason:input.reason??'campaign.configuration'});
      return {...result,configRevision};
    });
  }
  private async canonSnapshot(recordId:string){
    return {
      record:await this.store.get('SELECT * FROM records WHERE id=?',recordId),
      canon:await this.store.get('SELECT * FROM canon_records WHERE record_id=?',recordId),
      sections:await this.store.all('SELECT * FROM sections WHERE record_id=? ORDER BY id',recordId),
      fields:await this.store.all('SELECT f.*,v.value_json,v.revision AS value_revision FROM fields f LEFT JOIN field_values v ON f.id=v.field_id WHERE f.record_id=? ORDER BY f.id',recordId),
      links:await this.store.all('SELECT * FROM canon_record_links WHERE source_record_id=? OR target_record_id=? ORDER BY source_record_id,target_record_id,relation',recordId,recordId)
    };
  }
  async canonRecords(actor:Actor,worldId:string){
    await this.access(actor,{type:'world',id:worldId});
    const rows=await this.store.all<{record_id:string;name:string;kind:string;slug:string;aliases_json:string;source_status:string;valid_from:string|null;valid_until:string|null;revision:number;updated_at:string}>('SELECT c.record_id,r.name,r.kind,c.slug,c.aliases_json,c.source_status,c.valid_from,c.valid_until,c.revision,c.updated_at FROM canon_records c JOIN records r ON r.id=c.record_id WHERE c.world_id=? AND c.archived_at IS NULL AND r.archived_at IS NULL ORDER BY c.slug,c.record_id',worldId);
    return {items:rows.map(row=>({...row,aliases:JSON.parse(row.aliases_json)}))};
  }
  async setCanonRecord(actor:Actor,worldId:string,input:{recordId:string;slug:string;aliases:string[];sourceStatus:'draft'|'published'|'archived';validFrom:string|null;validUntil:string|null;expectedRevision?:number;links?:{targetRecordId:string;relation:string}[]},key:string){
    const scope:Scope={type:'world',id:worldId};
    return await this.store.transaction(async()=>{
      await this.access(actor,scope,true);
      const body={type:'canon.record.set',...input},replay=await this.replay(worldId,actor,key,body);if(replay)return replay;
      const record=await this.store.get<{id:string;revision:number}>('SELECT id,revision FROM records WHERE id=? AND world_id=?',input.recordId,worldId);ensure(record,404,'not_found');
      const current=await this.store.get<{revision:number;slug:string}>('SELECT revision,slug FROM canon_records WHERE record_id=? AND world_id=?',input.recordId,worldId);
      ensure(!input.validFrom||!input.validUntil||Date.parse(input.validFrom)<Date.parse(input.validUntil),400,'invalid_canon_validity');
      if(current)ensure(current.slug===input.slug,409,'canon_slug_immutable');
      if(current)ensure(current.revision===input.expectedRevision,409,'revision_conflict');else ensure(input.expectedRevision===undefined||input.expectedRevision===0,409,'revision_conflict');
      const aliases=JSON.stringify([...new Set(input.aliases.map(value=>value.trim()).filter(Boolean))]),now=clock(),revision=(current?.revision??0)+1;
      const before=current?await this.canonSnapshot(input.recordId):undefined;
      if(current) await this.store.run('UPDATE canon_records SET slug=?,aliases_json=?,source_status=?,valid_from=?,valid_until=?,revision=?,updated_at=?,updated_by=?,archived_at=? WHERE record_id=?',input.slug,aliases,input.sourceStatus,input.validFrom,input.validUntil,revision,now,actor.id,input.sourceStatus==='archived'?now:null,input.recordId);
      else await this.store.run('INSERT INTO canon_records(record_id,world_id,slug,aliases_json,source_status,valid_from,valid_until,revision,created_at,updated_at,created_by,updated_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',input.recordId,worldId,input.slug,aliases,input.sourceStatus,input.validFrom,input.validUntil,revision,now,now,actor.id,actor.id);
      if(input.sourceStatus==='archived')await this.store.run('UPDATE canon_records SET archived_at=? WHERE record_id=?',now,input.recordId);
      if(input.links!==undefined)await this.store.run('DELETE FROM canon_record_links WHERE source_record_id=?',input.recordId);
      for(const link of input.links??[]){ensure(link.targetRecordId!==input.recordId,400,'canon_self_link');ensure(await this.store.get('SELECT id FROM records WHERE id=? AND world_id=?',link.targetRecordId,worldId),404,'not_found');await this.store.run('INSERT INTO canon_record_links VALUES (?,?,?,?)',input.recordId,link.targetRecordId,link.relation,now);}
      const after=await this.canonSnapshot(input.recordId),eventAggregate=randomUUID();
      const result=await this.finish(scope,actor,key,body,{id:eventAggregate,revision},'canon.record.updated',{recordId:input.recordId,revision},worldId,{before,after,reason:'canon.record.edit'});
      return {...result,recordId:input.recordId};
    });
  }
  async canonRevisions(actor:Actor,worldId:string){
    await this.access(actor,{type:'world',id:worldId});
    return {items:await this.store.all('SELECT id,revision,status,note,created_by,created_at,published_at,archived_at FROM canon_revisions WHERE world_id=? ORDER BY revision DESC',worldId)};
  }
  async createCanonRevision(actor:Actor,worldId:string,input:{recordIds:string[];note:string},key:string){
    const scope:Scope={type:'world',id:worldId};
    return await this.store.transaction(async()=>{
      await this.access(actor,scope,true);const body={type:'canon.revision.create',...input},replay=await this.replay(worldId,actor,key,body);if(replay)return replay;
      const ids=input.recordIds.length?input.recordIds:(await this.store.all<{record_id:string}>('SELECT record_id FROM canon_records WHERE world_id=? AND source_status<>? AND archived_at IS NULL ORDER BY record_id',worldId,'archived')).map(row=>row.record_id);
      const records=[] as {id:string;revision:number;slug:string;status:string}[];
      for(const recordId of ids){const row=await this.store.get<{id:string;revision:number;name:string}>('SELECT id,revision,name FROM records WHERE id=? AND world_id=? AND archived_at IS NULL',recordId,worldId);ensure(row,404,'not_found');const meta=await this.store.get<{slug:string;source_status:string}>('SELECT slug,source_status FROM canon_records WHERE record_id=? AND world_id=?',recordId,worldId);ensure(meta,400,'canon_metadata_required');records.push({id:row.id,revision:row.revision,slug:meta.slug,status:meta.source_status});}
      const prior=await this.store.get<{revision:number}>('SELECT COALESCE(MAX(revision),0) AS revision FROM canon_revisions WHERE world_id=?',worldId),revision=(prior?.revision??0)+1,id=randomUUID(),now=clock(),manifest={revision,records};
      await this.store.run('INSERT INTO canon_revisions(id,world_id,revision,status,note,manifest_json,created_by,created_at) VALUES (?,?,?,?,?,?,?,?)',id,worldId,revision,'draft',input.note,JSON.stringify(manifest),actor.id,now);
      for(const record of records)await this.store.run('INSERT INTO canon_revision_records VALUES (?,?,?,?)',id,record.id,record.revision,JSON.stringify(await this.canonSnapshot(record.id)));
      const result=await this.finish(scope,actor,key,body,{id,revision},'canon.revision.created',manifest,worldId,{after:manifest,reason:'canon.revision.create'});
      return {...result,canonRevisionId:id};
    });
  }
  async setCanonRevisionStatus(actor:Actor,worldId:string,revisionId:string,status:'draft'|'published'|'archived',key:string){
    const scope:Scope={type:'world',id:worldId};
    return await this.store.transaction(async()=>{
      await this.access(actor,scope,true);const row=await this.store.get<{id:string;revision:number;status:string;published_at:string|null;archived_at:string|null}>('SELECT id,revision,status,published_at,archived_at FROM canon_revisions WHERE id=? AND world_id=?',revisionId,worldId);ensure(row,404,'not_found');
      const body={type:'canon.revision.status',revisionId,status},replay=await this.replay(worldId,actor,key,body);if(replay)return replay;
      const allowed:Record<string,string[]>={draft:['published','archived'],published:['archived'],archived:[]};ensure(status===row.status||allowed[row.status]?.includes(status),409,'invalid_canon_revision_transition');
      if(status==='published'){const unpublished=await this.store.get<{n:number}>("SELECT count(*) n FROM canon_revision_records WHERE revision_id=? AND json_extract(snapshot_json,'$.canon.source_status')<>'published'",revisionId);ensure((unpublished?.n??0)===0,409,'canon_revision_contains_unpublished_records');}
      const now=clock(),before={status:row.status},publishedAt=status==='published'?(row.published_at??now):row.published_at,archivedAt=status==='archived'?(row.archived_at??now):null;
      await this.store.run('UPDATE canon_revisions SET status=?,published_at=?,archived_at=? WHERE id=?',status,publishedAt,archivedAt,revisionId);
      const result=await this.finish(scope,actor,key,body,{id:randomUUID(),revision:row.revision},'canon.revision.status.updated',{revisionId,status},worldId,{before,after:{status},reason:'canon.revision.status'});
      return {...result,canonRevisionId:revisionId};
    });
  }
  async bindCampaignCanon(actor:Actor,campaignId:string,canonRevisionId:string|null,key:string){
    const scope:Scope={type:'campaign',id:campaignId};
    return await this.store.transaction(async()=>{
      const access=await this.access(actor,scope,true),campaign=await this.store.get<{source_world_id:string}>('SELECT source_world_id FROM campaigns WHERE id=?',campaignId);ensure(campaign,404,'not_found');
      if(canonRevisionId){const revision=await this.store.get<{id:string;status:string}>('SELECT id,status FROM canon_revisions WHERE id=? AND world_id=?',canonRevisionId,campaign.source_world_id);ensure(revision,404,'not_found');ensure(revision.status==='published',409,'canon_revision_not_published');}
      const body={type:'campaign.canon.bind',canonRevisionId},replay=await this.replay(campaignId,actor,key,body);if(replay)return replay;
      const before=await this.store.get('SELECT * FROM campaign_canon_bindings WHERE campaign_id=?',campaignId),now=clock();
      if(canonRevisionId)await this.store.run('INSERT INTO campaign_canon_bindings VALUES (?,?,?,?) ON CONFLICT(campaign_id) DO UPDATE SET canon_revision_id=excluded.canon_revision_id,bound_at=excluded.bound_at,bound_by=excluded.bound_by',campaignId,canonRevisionId,now,actor.id);
      else await this.store.run('DELETE FROM campaign_canon_bindings WHERE campaign_id=?',campaignId);
      await this.store.run('UPDATE campaigns SET revision=revision+1,updated_at=? WHERE id=?',now,campaignId);
      const result=await this.finish(scope,actor,key,body,{id:campaignId,revision:access.revision+1},'campaign.canon.bound',{canonRevisionId},campaignId,{before,after:{canonRevisionId},reason:'campaign.canon.bind'});
      return {...result,canonRevisionId};
    });
  }
  async userMode(actor:Actor){
    const user=await this.active(actor),row=await this.store.get<{mode:string;revision:number}>('SELECT mode,revision FROM user_mode_preferences WHERE user_id=?',actor.id);
    const developerAllowed=privileged(user.role),stored=row?.mode==='developer'&&developerAllowed?'developer':'player';
    return {mode:stored,revision:row?.revision??0,developerAllowed};
  }
  async setUserMode(actor:Actor,input:{mode:'player'|'developer';expectedRevision:number}){
    const user=await this.active(actor);
    ensure(input.mode==='player'||input.mode==='developer',400,'invalid_mode');
    ensure(input.mode!=='developer'||privileged(user.role),403,'developer_mode_forbidden');
    return await this.store.transaction(async()=>{
      const row=await this.store.get<{mode:string;revision:number}>('SELECT mode,revision FROM user_mode_preferences WHERE user_id=?',actor.id);
      const currentRevision=row?.revision??0;ensure(currentRevision===input.expectedRevision,409,'revision_conflict');
      const now=clock(),revision=currentRevision+1,before={mode:row?.mode??'player',revision:currentRevision};
      await this.store.run('INSERT INTO user_mode_preferences(user_id,mode,revision,created_at,updated_at) VALUES (?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET mode=excluded.mode,revision=excluded.revision,updated_at=excluded.updated_at',actor.id,input.mode,revision,now,now);
      await this.store.run('INSERT INTO audit_log(id,actor_id,action,target_id,created_at,request_id,reason,before_json,after_json) VALUES (?,?,?,?,?,?,?,?,?)',randomUUID(),actor.id,'user.mode.updated',actor.id,now,actor.requestId??null,'mode.switch',auditJson(before),auditJson({mode:input.mode,revision}));
      return {mode:input.mode,revision,developerAllowed:privileged(user.role)};
    });
  }
  async userTheme(actor:Actor){
    await this.active(actor);
    const row=await this.store.get<{theme_id:string;revision:number}>('SELECT theme_id,revision FROM user_theme_preferences WHERE user_id=?',actor.id);
    return {themeId:row?.theme_id??defaultThemeId,revision:row?.revision??0};
  }
  async setUserTheme(actor:Actor,input:{themeId:string;expectedRevision:number},key:string){
    const themeId=themeIdSchema.parse(input.themeId);
    return await this.store.transaction(async()=>{
      await this.active(actor);
      const row=await this.store.get<{theme_id:string;revision:number}>('SELECT theme_id,revision FROM user_theme_preferences WHERE user_id=?',actor.id);
      const currentRevision=row?.revision??0;ensure(currentRevision===input.expectedRevision,409,'revision_conflict');
      const now=clock(),revision=currentRevision+1,before={themeId:row?.theme_id??defaultThemeId,revision:currentRevision};
      await this.store.run('INSERT INTO user_theme_preferences(user_id,theme_id,revision,created_at,updated_at) VALUES (?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET theme_id=excluded.theme_id,revision=excluded.revision,updated_at=excluded.updated_at',actor.id,themeId,revision,now,now);
      await this.store.run('INSERT INTO audit_log(id,actor_id,action,target_id,created_at,request_id,reason,before_json,after_json) VALUES (?,?,?,?,?,?,?,?,?)',randomUUID(),actor.id,'user.theme.updated',actor.id,now,actor.requestId??null,'theme.preference',auditJson({...before}),auditJson({themeId,revision}));
      return {themeId,revision};
    });
  }
  async campaignTheme(actor:Actor,campaignId:string){
    await this.access(actor,{type:'campaign',id:campaignId});
    const row=await this.store.get<{recommended_theme_id:string;allowed_themes_json:string;revision:number}>('SELECT recommended_theme_id,allowed_themes_json,revision FROM campaign_theme_settings WHERE campaign_id=?',campaignId);
    const allowed=row?JSON.parse(row.allowed_themes_json):[...themeIds];
    return {recommendedThemeId:row?.recommended_theme_id??defaultThemeId,allowedThemes:allowed,revision:row?.revision??0};
  }
  async setCampaignTheme(actor:Actor,campaignId:string,input:{recommendedThemeId:string;allowedThemes:string[];expectedRevision:number;reason?:string},key:string){
    const scope:Scope={type:'campaign',id:campaignId};
    return await this.store.transaction(async()=>{
      const access=await this.access(actor,scope,true),recommended=themeIdSchema.parse(input.recommendedThemeId),allowed=[...new Set(input.allowedThemes.map(value=>themeIdSchema.parse(value)))];
      ensure(allowed.length>0&&allowed.includes(recommended),400,'theme_recommendation_not_allowed');
      const current=await this.store.get<{recommended_theme_id:string;allowed_themes_json:string;revision:number}>('SELECT recommended_theme_id,allowed_themes_json,revision FROM campaign_theme_settings WHERE campaign_id=?',campaignId);
      const currentRevision=current?.revision??0;ensure(currentRevision===input.expectedRevision,409,'revision_conflict');
      const body={type:'campaign.theme.set',recommendedThemeId:recommended,allowedThemes:allowed,reason:input.reason};
      const replay=await this.replay(campaignId,actor,key,body);if(replay)return replay;
      const now=clock(),revision=currentRevision+1,campaignRevision=access.revision+1,before=current?{recommendedThemeId:current.recommended_theme_id,allowedThemes:JSON.parse(current.allowed_themes_json),revision:current.revision}:undefined;
      await this.store.run('INSERT INTO campaign_theme_settings(campaign_id,recommended_theme_id,allowed_themes_json,revision,created_at,updated_at,updated_by) VALUES (?,?,?,?,?,?,?) ON CONFLICT(campaign_id) DO UPDATE SET recommended_theme_id=excluded.recommended_theme_id,allowed_themes_json=excluded.allowed_themes_json,revision=excluded.revision,updated_at=excluded.updated_at,updated_by=excluded.updated_by',campaignId,recommended,JSON.stringify(allowed),revision,now,now,actor.id);
      await this.store.run('UPDATE campaigns SET revision=revision+1,updated_at=? WHERE id=?',now,campaignId);
      const result=await this.finish(scope,actor,key,body,{id:campaignId,revision:campaignRevision},'campaign.theme.updated',{recommendedThemeId:recommended,allowedThemes:allowed},campaignId,{before,after:{recommendedThemeId:recommended,allowedThemes:allowed,revision},reason:input.reason??'campaign.theme'});
      return {...result,recommendedThemeId:recommended,allowedThemes:allowed,themeRevision:revision};
    });
  }  async setMember(actor:Actor,campaignId:string,input:{userId:string;role:'admin'|'creator'|'player'|'observer'|null;expectedRevision:number},key:string) {
    const scope:Scope={type:'campaign',id:campaignId};
    return (await this.store.transaction(async ()=>{
      const access=(await this.access(actor,scope,true));
      ensure(access.owner_id===actor.id,403,'owner_required');
      ensure(input.userId!==actor.id,409,'owner_membership_protected');
      ensure((await this.store.get('SELECT id FROM users WHERE id=? AND archived_at IS NULL',input.userId)),404,'not_found');
      const replay=(await this.replay(campaignId,actor,key,{type:'member.set',...input})); if(replay)return replay;
      ensure(access.revision===input.expectedRevision,409,'revision_conflict');
      const before=await this.store.get('SELECT campaign_id,user_id,role,revision FROM memberships WHERE campaign_id=? AND user_id=?',campaignId,input.userId);
      const now=clock();
      if(input.role) (await this.store.run('INSERT INTO memberships(campaign_id,user_id,role,created_at,updated_at) VALUES (?,?,?,?,?) ON CONFLICT(campaign_id,user_id) DO UPDATE SET role=excluded.role,updated_at=excluded.updated_at,revision=memberships.revision+1',campaignId,input.userId,input.role,now,now));
      else {
        (await this.store.run('DELETE FROM visibility_grants WHERE user_id=? AND record_id IN (SELECT id FROM records WHERE campaign_id=?)',input.userId,campaignId));
        (await this.store.run('DELETE FROM memberships WHERE campaign_id=? AND user_id=?',campaignId,input.userId));
      }
      (await this.store.run('UPDATE campaigns SET revision=revision+1,updated_at=? WHERE id=?',now,campaignId));
      return (await this.finish(scope,actor,key,{type:'member.set',...input},{id:campaignId,revision:access.revision+1},'member.set',input,scope.id,{before,after:{membership:input,campaignRevision:access.revision+1},reason:'membership.edit'}));
    }));
  }
  private async record(scope:Scope,id:string, includeArchived=false) {
    const row=(await this.store.get<RecordRow>('SELECT * FROM records WHERE id=? AND '+column(scope)+'=?'+(includeArchived?'':' AND archived_at IS NULL'),id,scope.id));
    ensure(row,404,'not_found'); return row;
  }
  private async section(recordId:string,id:string) {
    const row=(await this.store.get<SectionRow>('SELECT * FROM sections WHERE id=? AND record_id=? AND archived_at IS NULL',id,recordId));
    ensure(row,404,'not_found');
    if(row.parent_id) (await this.section(recordId,row.parent_id));
    return row;
  }
  private async field(recordId:string,id:string) {
    const row=(await this.store.get<FieldRow>('SELECT * FROM fields WHERE id=? AND record_id=? AND archived_at IS NULL',id,recordId));
    ensure(row,404,'not_found'); (await this.section(recordId,row.section_id)); return row;
  }
  private async snapshot(recordId:string) {
    return {
      record:(await this.store.get('SELECT * FROM records WHERE id=?',recordId)),
      sections:(await this.store.all('SELECT * FROM sections WHERE record_id=? ORDER BY id',recordId)),
      fields:(await this.store.all('SELECT f.*,v.value_json,v.revision AS value_revision FROM fields f LEFT JOIN field_values v ON f.id=v.field_id WHERE f.record_id=? ORDER BY f.id',recordId)),
      grants:(await this.store.all('SELECT * FROM visibility_grants WHERE record_id=? ORDER BY user_id',recordId))
    };
  }
  async execute(actor:Actor,scope:Scope,raw:Command,key:string,auditMeta:{reason?:string;note?:string}={}) {
    const command=commandSchema.parse(raw);
    return (await this.store.transaction(async ()=>{
      (await this.access(actor,scope,true));
      const replay=(await this.replay(scope.id,actor,key,command)); if(replay) return replay;
      const now=clock();
      if(command.type==='record.create' || command.type==='record.instantiate') {
        const id=randomUUID();
        let kind:string, name:string, source:RecordRow|undefined;
        if(command.type==='record.instantiate') {
          ensure(scope.type==='campaign',400,'campaign_required');
          const campaign=(await this.store.get<{source_world_id:string}>('SELECT source_world_id FROM campaigns WHERE id=?',scope.id))!;
          const sourceScope:Scope={type:'world',id:campaign.source_world_id};
          (await this.access(actor,sourceScope));
          source=(await this.record(sourceScope,command.sourceRecordId));
          ensure(source.revision===command.sourceRevision,409,'revision_conflict');
          kind=source.kind; name=source.name;
        } else { kind=command.kind; name=command.name; }
        (await this.store.run('INSERT INTO records(id,world_id,campaign_id,source_record_id,source_revision,owner_id,kind,name,visibility,created_at,updated_at,created_by,updated_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
          id,scope.type==='world'?scope.id:null,scope.type==='campaign'?scope.id:null,source?.id??null,source?.revision??null,actor.id,kind,name,command.visibility,now,now,actor.id,actor.id));
        if(source) (await this.copyStructure(source.id,id,actor,now));
        const after=await this.snapshot(id);
        return (await this.finish(scope,actor,key,command,{id,revision:1},command.type,after,scope.id,{after,reason:auditMeta.reason??command.type,note:auditMeta.note}));
      }
      const record=(await this.record(scope,command.recordId));
      ensure(record.revision===command.expectedRevision,409,'revision_conflict');
      const before=await this.snapshot(record.id);
      const result:Omit<CommandResult,'eventId'>={id:record.id,revision:record.revision+1};
      switch(command.type) {
        case 'record.update':
          (await this.store.run('UPDATE records SET name=?,visibility=? WHERE id=?',command.name,command.visibility,record.id)); break;
        case 'record.archive':
          (await this.store.run('UPDATE records SET archived_at=? WHERE id=?',now,record.id)); break;
        case 'section.add': {
          if(command.parentId) (await this.section(record.id,command.parentId));
          result.sectionId=randomUUID();
          (await this.store.run('INSERT INTO sections(id,record_id,parent_id,name,position,visibility,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)',result.sectionId,record.id,command.parentId,command.name,command.position,command.visibility,now,now)); break;
        }
        case 'section.update':
          (await this.section(record.id,command.sectionId));
          (await this.store.run('UPDATE sections SET name=?,position=?,visibility=?,revision=revision+1,updated_at=? WHERE id=?',command.name,command.position,command.visibility,now,command.sectionId)); break;
        case 'section.archive':
          (await this.section(record.id,command.sectionId));
          (await this.store.run('UPDATE sections SET archived_at=?,updated_at=?,revision=revision+1 WHERE id=?',now,now,command.sectionId)); break;
        case 'field.add':
          (await this.section(record.id,command.sectionId)); result.fieldId=randomUUID();
          (await this.store.run('INSERT INTO fields(id,record_id,section_id,name,position,value_type,visibility,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)',result.fieldId,record.id,command.sectionId,command.name,command.position,command.valueType,command.visibility,now,now)); break;
        case 'field.update':
          (await this.field(record.id,command.fieldId));
          (await this.store.run('UPDATE fields SET name=?,position=?,visibility=?,updated_at=?,revision=revision+1 WHERE id=?',command.name,command.position,command.visibility,now,command.fieldId)); break;
        case 'field.archive':
          (await this.field(record.id,command.fieldId));
          (await this.store.run('UPDATE fields SET archived_at=?,updated_at=?,revision=revision+1 WHERE id=?',now,now,command.fieldId)); break;
        case 'field.set': {
          const field=(await this.field(record.id,command.fieldId));
          const matches=field.value_type==='json' || (field.value_type==='text'?typeof command.value==='string':typeof command.value===field.value_type);
          ensure(matches,400,'field_type_mismatch');
          (await this.store.run('INSERT INTO field_values VALUES (?,?,1,?,?) ON CONFLICT(field_id) DO UPDATE SET value_json=excluded.value_json,revision=field_values.revision+1,updated_at=excluded.updated_at,updated_by=excluded.updated_by',field.id,JSON.stringify(command.value),now,actor.id)); break;
        }
        case 'visibility.grant':
        case 'visibility.revoke':
          ensure(scope.type==='campaign',400,'campaign_required');
          ensure((await this.store.get('SELECT user_id FROM memberships WHERE campaign_id=? AND user_id=?',scope.id,command.userId)),404,'not_found');
          if(command.type==='visibility.grant') (await this.store.run('INSERT INTO visibility_grants VALUES (?,?,?,?) ON CONFLICT(record_id,user_id) DO NOTHING',record.id,command.userId,now,actor.id));
          else (await this.store.run('DELETE FROM visibility_grants WHERE record_id=? AND user_id=?',record.id,command.userId));
          break;
      }
      (await this.store.run('UPDATE records SET revision=revision+1,updated_at=?,updated_by=? WHERE id=?',now,actor.id,record.id));
      const after=await this.snapshot(record.id);
      return (await this.finish(scope,actor,key,command,result,command.type,after,scope.id,{before,after,reason:auditMeta.reason??command.type,note:auditMeta.note}));
    }));
  }
  private async copyStructure(sourceId:string,targetId:string,actor:Actor,now:string) {
    const mapping=new Map<string,string>();
    const sections=(await this.store.all<SectionRow>('SELECT * FROM sections WHERE record_id=? AND archived_at IS NULL ORDER BY id',sourceId));
    const pending=[...sections];
    // Parent-first insert; excluded archived ancestors also exclude their descendants.
    while(pending.length) {
      let progressed=false;
      for(let i=pending.length-1;i>=0;i--) {
        const section=pending[i]!;
        if(section.parent_id && !mapping.has(section.parent_id)) continue;
        const id=randomUUID(); mapping.set(section.id,id);
        (await this.store.run('INSERT INTO sections(id,record_id,parent_id,name,position,visibility,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)',id,targetId,section.parent_id?mapping.get(section.parent_id)!:null,section.name,section.position,section.visibility,now,now));
        pending.splice(i,1); progressed=true;
      }
      if(!progressed) break;
    }
    for(const field of (await this.store.all<FieldRow>('SELECT * FROM fields WHERE record_id=? AND archived_at IS NULL',sourceId))) {
      const sectionId=mapping.get(field.section_id); if(!sectionId)continue;
      const id=randomUUID();
      (await this.store.run('INSERT INTO fields(id,record_id,section_id,name,position,value_type,visibility,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)',id,targetId,sectionId,field.name,field.position,field.value_type,field.visibility,now,now));
      const value=(await this.store.get<{value_json:string}>('SELECT value_json FROM field_values WHERE field_id=?',field.id));
      if(value)(await this.store.run('INSERT INTO field_values VALUES (?,?,1,?,?)',id,value.value_json,now,actor.id));
    }
  }
  private async recordDeletionDependencies(scope:Scope,recordId:string){
    const record=await this.record(scope,recordId,true);
    const count=async(sql:string,...args:string[])=>(await this.store.get<{n:number}>(sql,...args))!.n;
    const owned={
      sections:await count('SELECT count(*) n FROM sections WHERE record_id=?',recordId),
      fields:await count('SELECT count(*) n FROM fields WHERE record_id=?',recordId),
      values:await count('SELECT count(*) n FROM field_values WHERE field_id IN (SELECT id FROM fields WHERE record_id=?)',recordId),
      grants:await count('SELECT count(*) n FROM visibility_grants WHERE record_id=?',recordId)
    };
    const blockers={
      sourceInstances:await count('SELECT count(*) n FROM records WHERE source_record_id=?',recordId),
      canonRecords:await count('SELECT count(*) n FROM canon_records WHERE record_id=?',recordId),
      canonLinks:await count('SELECT count(*) n FROM canon_record_links WHERE source_record_id=? OR target_record_id=?',recordId,recordId),
      canonSnapshots:await count('SELECT count(*) n FROM canon_revision_records WHERE record_id=?',recordId)
    };
    const retainedHistory={
      events:await count('SELECT count(*) n FROM domain_events WHERE aggregate_id=?',recordId),
      audits:await count('SELECT count(*) n FROM audit_log WHERE target_id=?',recordId)
    };
    return {record:{id:record.id,name:record.name,revision:record.revision,archivedAt:record.archived_at},owned,blockers,retainedHistory,
      hardDeleteAllowed:Boolean(record.archived_at)&&Object.values(blockers).every(value=>value===0)};
  }
  private deletionDependencyHash(dependencies:Awaited<ReturnType<Domain['recordDeletionDependencies']>>){
    return digest({record:dependencies.record,owned:dependencies.owned,blockers:dependencies.blockers,hardDeleteAllowed:dependencies.hardDeleteAllowed});
  }
  async deletionReport(actor:Actor,scope:Scope,recordId:string,note?:string){
    return this.store.transaction(async()=>{
      const access=await this.access(actor,scope,true);ensure(access.owner_id===actor.id,403,'owner_required');
      const dependencies=await this.recordDeletionDependencies(scope,recordId),id=randomUUID(),createdAt=clock(),expiresAt=new Date(Date.now()+10*60000).toISOString();
      await this.store.run('INSERT INTO deletion_reports VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',id,1,scope.type,scope.id,'record',recordId,actor.id,JSON.stringify(dependencies),this.deletionDependencyHash(dependencies),dependencies.hardDeleteAllowed?1:0,createdAt,expiresAt,null);
      await this.store.run('INSERT INTO audit_log(id,actor_id,world_id,campaign_id,action,target_id,created_at,request_id,reason,before_json,after_json,note) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
       randomUUID(),actor.id,scope.type==='world'?scope.id:null,scope.type==='campaign'?scope.id:null,'record.deletion.reported',recordId,createdAt,actor.requestId??null,'dependency-review',null,auditJson(dependencies),note??null);
      return {id,schemaVersion:1,targetId:recordId,expiresAt,...dependencies,confirmation:'HARD_DELETE '+recordId};
    },'write');
  }
  async hardDeleteRecord(actor:Actor,scope:Scope,recordId:string,reportId:string,confirmation:string,note?:string){
    return this.store.transaction(async()=>{
      const access=await this.access(actor,scope,true);ensure(access.owner_id===actor.id,403,'owner_required');
      const report=await this.store.get<{dependency_hash:string;hard_delete_allowed:number;expires_at:string;consumed_at:string|null;created_by:string}>(
       'SELECT dependency_hash,hard_delete_allowed,expires_at,consumed_at,created_by FROM deletion_reports WHERE id=? AND scope_type=? AND scope_id=? AND target_type=? AND target_id=?',reportId,scope.type,scope.id,'record',recordId);
      ensure(report&&report.created_by===actor.id,404,'deletion_report_unavailable');
      ensure(!report.consumed_at&&Date.parse(report.expires_at)>Date.now(),409,'deletion_report_expired');
      ensure(confirmation==='HARD_DELETE '+recordId,400,'hard_delete_confirmation_required');
      const dependencies=await this.recordDeletionDependencies(scope,recordId);
      ensure(report.dependency_hash===this.deletionDependencyHash(dependencies),409,'deletion_dependencies_changed');
      ensure(report.hard_delete_allowed===1&&dependencies.hardDeleteAllowed,409,'hard_delete_blocked');
      const ids=await this.store.all<{id:string}>('SELECT id FROM sections WHERE record_id=? UNION ALL SELECT id FROM fields WHERE record_id=?',recordId,recordId);
      const revision=dependencies.record.revision+1,at=clock(),eventId=randomUUID(),seed=randomBytes(32).toString('hex');
      await this.store.run('INSERT INTO domain_events VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',eventId,1,scope.type==='world'?scope.id:null,scope.type==='campaign'?scope.id:null,actor.id,recordId,revision,'record.hard_deleted',JSON.stringify({reportId,retainedHistory:dependencies.retainedHistory}),seed,'hmac-sha256-v1',at);
      await this.store.run('INSERT INTO outbox(event_id,created_at) VALUES (?,?)',eventId,at);
      await this.store.run('DELETE FROM visibility_grants WHERE record_id=?',recordId);
      await this.store.run('DELETE FROM field_values WHERE field_id IN (SELECT id FROM fields WHERE record_id=?)',recordId);
      await this.store.run('DELETE FROM fields WHERE record_id=?',recordId);
      await this.store.run('DELETE FROM sections WHERE record_id=?',recordId);
      await this.store.run('DELETE FROM records WHERE id=?',recordId);
      for(const artifactId of [recordId,...ids.map(row=>row.id)])await this.store.run('DELETE FROM artifact_schema_versions WHERE artifact_id=? AND scope_type=? AND scope_id=?',artifactId,scope.type,scope.id);
      await this.store.run('UPDATE deletion_reports SET consumed_at=? WHERE id=?',at,reportId);
      await this.store.run('INSERT INTO audit_log(id,actor_id,world_id,campaign_id,action,target_id,event_id,created_at,request_id,reason,before_json,after_json,note) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
       randomUUID(),actor.id,scope.type==='world'?scope.id:null,scope.type==='campaign'?scope.id:null,'record.hard_deleted',recordId,eventId,at,actor.requestId??null,'confirmed-hard-delete',auditJson(dependencies),auditJson({deleted:true,reportId}),note??null);
      return {id:recordId,deleted:true,eventId,reportId};
    },'write');
  }
  async read(actor:Actor,scope:Scope,id:string) {
    const access=(await this.access(actor,scope)), record=(await this.record(scope,id));
    const grant=Boolean((await this.store.get('SELECT record_id FROM visibility_grants WHERE record_id=? AND user_id=?',id,actor.id)));
    const visible=(visibility:string) => privileged(access.role) || (visibility==='campaign' && access.role!=='observer') || (visibility==='owner' && record.owner_id===actor.id) || (visibility==='knowledge' && grant);
    ensure(visible(record.visibility),404,'not_found');
    const sections=(await this.store.all<SectionRow>('SELECT * FROM sections WHERE record_id=? AND archived_at IS NULL ORDER BY position,id',id));
    const byId=new Map(sections.map(s=>[s.id,s]));
    const visibleSection=(section:SectionRow):boolean => visible(section.visibility) && (!section.parent_id || (byId.has(section.parent_id) && visibleSection(byId.get(section.parent_id)!)));
    const fields=(await this.store.all<FieldRow & {value_json:string|null}>('SELECT f.*,v.value_json FROM fields f LEFT JOIN field_values v ON v.field_id=f.id WHERE f.record_id=? AND f.archived_at IS NULL ORDER BY f.position,f.id',id));
    return {
      id:record.id,kind:record.kind,name:record.name,revision:record.revision,
      sections:sections.filter(visibleSection).map(section=>({
        id:section.id,parentId:section.parent_id,name:section.name,position:section.position,
        fields:fields.filter(f=>f.section_id===section.id && visible(f.visibility)).map(f=>({
          id:f.id,name:f.name,position:f.position,valueType:f.value_type,
          value:f.value_json===null?null:JSON.parse(f.value_json)
        }))
      }))
    };
  }
  async list(actor:Actor,scope:Scope,after='') {
    const access=(await this.access(actor,scope));
    const rows=(await this.store.all<{id:string}>(
      'SELECT r.id FROM records r WHERE '+column(scope)+'=? AND r.archived_at IS NULL AND r.id>? AND (?=1 OR (r.visibility=\'campaign\' AND ?!=\'observer\') OR (r.visibility=\'owner\' AND r.owner_id=?) OR (r.visibility=\'knowledge\' AND EXISTS (SELECT 1 FROM visibility_grants g WHERE g.record_id=r.id AND g.user_id=?))) ORDER BY r.id LIMIT 101',
      scope.id,after,privileged(access.role)?1:0,access.role,actor.id,actor.id));
    const page=rows.slice(0,100);
    return {items:await Promise.all(page.map(r=>this.read(actor,scope,r.id))),nextCursor:rows.length>100?page.at(-1)!.id:null};
  }
  async history(actor:Actor,scope:Scope,after='') {
    (await this.access(actor,scope,true));
    return (await this.store.all('SELECT id,actor_id,aggregate_id,aggregate_revision,type,payload_json,seed,rng_version,created_at FROM domain_events WHERE '+column(scope)+'=? AND rowid>COALESCE((SELECT rowid FROM domain_events WHERE id=? AND '+column(scope)+'=?),0) ORDER BY rowid LIMIT 100',scope.id,after,scope.id));
  }
  async audits(actor:Actor,scope:Scope,after='') {
    (await this.access(actor,scope,true));
    return (await this.store.all('SELECT id,actor_id,action,target_id,event_id,created_at,request_id,reason,note,before_json,after_json FROM audit_log WHERE '+column(scope)+'=? AND rowid>COALESCE((SELECT rowid FROM audit_log WHERE id=? AND '+column(scope)+'=?),0) ORDER BY rowid LIMIT 100',scope.id,after,scope.id));
  }
}

// Internal worker interface, never a public event stream. A failure leaves work pending.
export async function dispatchNotifications(store:Store, hook:(event:DomainEvent)=>Promise<void>,limit=100) {
  const rows=(await store.all<{event_id:string}>('SELECT event_id FROM outbox WHERE delivered_at IS NULL ORDER BY created_at,event_id LIMIT ?',Math.min(Math.max(limit,1),1000)));
  for(const row of rows) {
    (await store.run('UPDATE outbox SET attempts=attempts+1 WHERE event_id=?',row.event_id));
    const event=(await store.get<{id:string;actor_id:string;aggregate_id:string;aggregate_revision:number;type:string;payload_json:string;seed:string;rng_version:string;created_at:string}>('SELECT * FROM domain_events WHERE id=?',row.event_id))!;
    await hook(eventSchema.parse({id:event.id,schemaVersion:1,actorId:event.actor_id,aggregateId:event.aggregate_id,aggregateRevision:event.aggregate_revision,type:event.type,payload:JSON.parse(event.payload_json),seed:event.seed,rngVersion:event.rng_version,createdAt:event.created_at}));
    (await store.run('UPDATE outbox SET delivered_at=? WHERE event_id=?',clock(),row.event_id));
  }
}
