import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Store } from './db.ts';
import { ensure, eventSchema, commandSchema } from './contracts.ts';
import type { Actor, Command, DomainEvent, Scope } from './contracts.ts';

type RecordRow = {id:string; world_id:string|null; campaign_id:string|null; owner_id:string; kind:string; name:string; visibility:string; revision:number; archived_at:string|null};
type SectionRow = {id:string; record_id:string; parent_id:string|null; name:string; position:number; visibility:string; archived_at:string|null};
type FieldRow = {id:string; record_id:string; section_id:string; name:string; position:number; visibility:string; value_type:string; archived_at:string|null};
type ScopeAccess = {role:string; owner_id:string; revision:number};
type Receipt = {request_hash:string; response_json:string};
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
  private async finish(scope:Scope, actor:Actor, key:string, body:unknown, result:Omit<CommandResult,'eventId'>, type:string, payload:Record<string,unknown>, receiptScope=scope.id):Promise<CommandResult> {
    const now=clock();
    const event=eventSchema.parse({
      id:randomUUID(),schemaVersion:1,actorId:actor.id,aggregateId:result.id,aggregateRevision:result.revision,
      type,payload,seed:randomBytes(32).toString('hex'),rngVersion:'hmac-sha256-v1',createdAt:now
    });
    const world=scope.type==='world'?scope.id:null, campaign=scope.type==='campaign'?scope.id:null;
    (await this.store.run('INSERT INTO domain_events VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',event.id,1,world,campaign,actor.id,result.id,result.revision,type,JSON.stringify(event.payload),event.seed,event.rngVersion,now));
    (await this.store.run('INSERT INTO audit_log VALUES (?,?,?,?,?,?,?,?)',randomUUID(),actor.id,world,campaign,type,result.id,event.id,now));
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
  async createCampaign(actor:Actor, input:{worldId:string;name:string;startingAt:string;timezone:string},key:string) {
    return (await this.store.transaction(async ()=>{
      (await this.access(actor,{type:'world',id:input.worldId},true));
      const replay=(await this.replay('campaign.create',actor,key,input)); if(replay) return replay;
      const id=randomUUID(), now=clock();
      (await this.store.run('INSERT INTO campaigns(id,owner_id,source_world_id,name,starting_at,timezone,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)',id,actor.id,input.worldId,input.name,input.startingAt,input.timezone,now,now));
      (await this.store.run('INSERT INTO memberships(campaign_id,user_id,role,created_at,updated_at) VALUES (?,?,?,?,?)',id,actor.id,'creator',now,now));
      return (await this.finish({type:'campaign',id},actor,key,input,{id,revision:1},'campaign.created',input,'campaign.create'));
    }));
  }
  async setMember(actor:Actor,campaignId:string,input:{userId:string;role:'admin'|'creator'|'player'|'observer'|null;expectedRevision:number},key:string) {
    const scope:Scope={type:'campaign',id:campaignId};
    return (await this.store.transaction(async ()=>{
      const access=(await this.access(actor,scope,true));
      ensure(access.owner_id===actor.id,403,'owner_required');
      ensure(input.userId!==actor.id,409,'owner_membership_protected');
      ensure((await this.store.get('SELECT id FROM users WHERE id=? AND archived_at IS NULL',input.userId)),404,'not_found');
      const replay=(await this.replay(campaignId,actor,key,{type:'member.set',...input})); if(replay)return replay;
      ensure(access.revision===input.expectedRevision,409,'revision_conflict');
      const now=clock();
      if(input.role) (await this.store.run('INSERT INTO memberships(campaign_id,user_id,role,created_at,updated_at) VALUES (?,?,?,?,?) ON CONFLICT(campaign_id,user_id) DO UPDATE SET role=excluded.role,updated_at=excluded.updated_at,revision=memberships.revision+1',campaignId,input.userId,input.role,now,now));
      else {
        (await this.store.run('DELETE FROM visibility_grants WHERE user_id=? AND record_id IN (SELECT id FROM records WHERE campaign_id=?)',input.userId,campaignId));
        (await this.store.run('DELETE FROM memberships WHERE campaign_id=? AND user_id=?',campaignId,input.userId));
      }
      (await this.store.run('UPDATE campaigns SET revision=revision+1,updated_at=? WHERE id=?',now,campaignId));
      return (await this.finish(scope,actor,key,{type:'member.set',...input},{id:campaignId,revision:access.revision+1},'member.set',input));
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
  async execute(actor:Actor,scope:Scope,raw:Command,key:string) {
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
        return (await this.finish(scope,actor,key,command,{id,revision:1},command.type,(await this.snapshot(id))));
      }
      const record=(await this.record(scope,command.recordId));
      ensure(record.revision===command.expectedRevision,409,'revision_conflict');
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
      return (await this.finish(scope,actor,key,command,result,command.type,(await this.snapshot(record.id))));
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
    return (await this.store.all('SELECT id,actor_id,action,target_id,event_id,created_at FROM audit_log WHERE '+column(scope)+'=? AND rowid>COALESCE((SELECT rowid FROM audit_log WHERE id=? AND '+column(scope)+'=?),0) ORDER BY rowid LIMIT 100',scope.id,after,scope.id));
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
