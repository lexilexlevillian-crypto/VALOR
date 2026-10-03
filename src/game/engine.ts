import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {z} from 'zod';
import {Store} from '../db.ts';
import {Domain} from '../domain.ts';
import {ensure} from '../contracts.ts';
import type {Actor} from '../contracts.ts';
import {actionSchema,applyCharacterProfileTemplate,beliefSchema,characterProfileTemplateSchema,data,entitySchema,factSchema,getEntity,knowledgeSchema,kinds,memorySchema,refs,remapEntityReference,settingsSchema,validateEntity,validateState} from './model.ts';
import type {Action,Entity,Kind,State} from './model.ts';
import {observerView,project,retrieve,observe,fact,gossip,remember,visible} from './epistemics.ts';
import {phoneView} from './phone.ts';
import {caseFileView,journalView} from './events.ts';
import {resolveAction} from './actions.ts';
import type {CheckRecord} from './actions.ts';
import {advance,type Effect} from './simulation.ts';
import {skillNames,traitBackgroundRequirements,traitGenerationTags,traitGroups,traitOppositions} from './catalog.ts';
import {generateNpcTraitSelection,validateTraitSelection} from './traits.ts';
import {prepareAppearance,assignResidence} from './profile-creation.ts';
import {validateStartingBuild,applyPlayerChoices} from './creation.ts';
import {stockTrait,stockSkill,startingBudget,applyStartingGrants} from '../../public/creation-rules.js';
import type {InStatement,InValue} from '@libsql/client';
import {buildContextManifest,contextBrief} from './context.ts';
import {proposeIntent} from './intent.ts';
import type {IntentProposal} from './intent.ts';
import type {RetrievalFilters} from './epistemics.ts';
import {TurnTraceRecorder,beginTurnTrace,failureReason,persistTurnTrace} from './turn-pipeline.ts';
import {encodeSnapshot,decodeSnapshot} from './snapshots.ts';
import {mediaBytes} from './media.ts';
import {defaultCampaignConfig,parseStoredCampaignConfig,resolveCampaignConfig} from '../campaign-config.ts';
import {buildFoundationProjections} from '../foundation-projections.ts';
import {auditJson,ensureJsonBytes} from '../security.ts';
import {canonSourceSchema,canonSnapshotSchema} from './canon.ts';
import type {CanonSource} from './canon.ts';
import {chronicleNoticeSchema,chroniclePresentation,chronicleSceneSchema} from './chronicle.ts';
import {listNpcs,mergeNpcData,mergePayload,mergePayloadForChecksum,npcDerived,npcMergeConflicts,npcReferrers,remapNpcReferences} from './npcs.ts';
import type {NpcFilters} from './npcs.ts';
import {developerSocialGraph,playerRelationships,recordReputation} from './social.ts';
import {inventoryView} from './items.ts';
type Timeline={id:string;campaign_id:string;parent_id:string|null;parent_save_id:string|null;name:string;revision:number;clock:string;settings_json:string};
type Mutation<T>={result:T;effects?:Effect[];draws?:number;checks?:CheckRecord[];characterId?:string;turnText?:string};
const now=()=>new Date().toISOString();
const canonical=(v:unknown):string=>Array.isArray(v)?'['+v.map(canonical).join(',')+']':v&&typeof v==='object'?'{'+Object.entries(v).sort(([a],[b])=>a.localeCompare(b)).map(([k,x])=>JSON.stringify(k)+':'+canonical(x)).join(',')+'}':JSON.stringify(v);
export const checksum=(v:unknown)=>createHash('sha256').update(canonical(v)).digest('hex');
const deterministicUuid=(seed:string,label:string)=>{const value=checksum(seed+':'+label).slice(0,32).split('');value[12]='4';value[16]=(8+(parseInt(value[16]!,16)%4)).toString(16);const text=value.join('');return text.slice(0,8)+'-'+text.slice(8,12)+'-'+text.slice(12,16)+'-'+text.slice(16,20)+'-'+text.slice(20);};
const validationErrors=(error:unknown)=>error instanceof z.ZodError?error.issues.map(issue=>({path:issue.path.join('.'),message:issue.message})): [{path:'',message:error instanceof Error?error.message:'invalid_content'}];
const privileged=(role:string)=>['creator','admin'].includes(role);
const keySchema=z.string().regex(/^[A-Za-z0-9_-]{16,128}$/);
const startDefinitionSchema=z.strictObject({
 character:z.strictObject({
  name:z.string().trim().min(1).max(160),
  description:z.string().max(16000).default(''),
  data:z.record(z.string(),z.json()).default({})
 }),
 grantEntityIds:z.array(z.uuid()).max(100).default([]),
 relationshipTemplates:z.array(z.strictObject({
  targetId:z.uuid(),labels:z.array(z.string().max(80)).max(100).default([]),
  attraction:z.number().min(-100).max(100).default(0),affection:z.number().min(-100).max(100).default(0),
  trust:z.number().min(-100).max(100).default(0),respect:z.number().min(-100).max(100).default(0),
  familiarity:z.number().min(-100).max(100).default(0),secret:z.boolean().default(true)
 })).max(100).default([]),
 reputation:z.array(z.strictObject({factionId:z.uuid(),score:z.number().min(-100).max(100)})).max(100).default([]),
 plotHookIds:z.array(z.uuid()).max(100).default([]),
 requiresSystems:z.array(z.string().trim().min(1).max(80)).max(100).default([])
});
type StartDefinition=z.infer<typeof startDefinitionSchema>;
const packageInputSchema=z.strictObject({
 name:z.string().trim().min(1).max(160),slug:z.string().trim().min(1).max(80).regex(/^[a-z0-9][a-z0-9._-]*$/),
 description:z.string().max(16000).default(''),kind:z.enum(['guided','freeform','template']),
 visibility:z.enum(['creator','campaign']).default('campaign'),status:z.enum(['draft','published','archived']).default('draft'),
 definition:z.unknown()
});
const transcriptSchema=z.strictObject({id:z.uuid(),character_id:z.uuid(),user_id:z.uuid(),input_text:z.string().max(1000),narration:z.string().max(200000),narration_status:z.string().max(100),created_at:z.iso.datetime(),source_event_id:z.uuid(),notices_json:z.string().max(100000).default('[]'),scene_json:z.string().max(10000).default('{}')});
const presentTranscript=(turn:z.infer<typeof transcriptSchema>)=>{
 const notices=z.array(chronicleNoticeSchema).safeParse(JSON.parse(turn.notices_json)),scene=chronicleSceneSchema.safeParse(JSON.parse(turn.scene_json));
 return {...turn,notices:notices.success?notices.data:[],scene:scene.success?scene.data:{clock:turn.created_at,locationId:null,locationName:null}};
};
const snapshotMetadataSchema=z.strictObject({schemaVersion:z.literal(1),campaignId:z.uuid(),timelineId:z.uuid(),revision:z.number().int().positive(),clock:z.iso.datetime(),eventCursor:z.string().min(16).max(128),eventId:z.uuid().nullable(),projectionVersion:z.literal(1),contentChecksum:z.string().length(64),createdAt:z.iso.datetime()});
const snapshotSchema=z.strictObject({version:z.literal(1),metadata:snapshotMetadataSchema.optional(),worldHistory:z.array(z.strictObject({eventId:z.uuid(),canonRevisionId:z.uuid().nullable(),configuration:z.json()})).default([]),transcript:z.array(transcriptSchema).default([]),state:z.strictObject({canon:canonSourceSchema.nullable().optional(),clock:z.iso.datetime(),settings:settingsSchema,entities:z.array(entitySchema).max(20000),
 facts:z.array(factSchema),knowledge:z.array(knowledgeSchema),beliefs:z.array(beliefSchema),memories:z.array(memorySchema),eventIds:z.array(z.uuid()).max(100000).optional()
})});
const snapshotCore=(snapshot:z.infer<typeof snapshotSchema>)=>({version:snapshot.version,worldHistory:snapshot.worldHistory,transcript:snapshot.transcript,state:snapshot.state});
const verifySnapshotMetadata=(snapshot:z.infer<typeof snapshotSchema>)=>{if(!snapshot.metadata)return snapshot;ensure(snapshot.metadata.clock===snapshot.state.clock,409,'snapshot_clock_mismatch');ensure(snapshot.metadata.contentChecksum===checksum(snapshotCore(snapshot)),409,'snapshot_content_checksum_mismatch');return snapshot;};
export class Game {
 store:Store;domain:Domain;readonly exportBytes:number;readonly importBytes:number;
 constructor(store:Store,limits:{exportBytes?:number;importBytes?:number}={}){
  this.store=store;this.domain=new Domain(store);
  this.exportBytes=limits.exportBytes??8*1024*1024;this.importBytes=limits.importBytes??8*1024*1024;
 }
 private async recoverySchemaReady(){return Boolean(await this.store.get<{ready:number}>("SELECT 1 ready FROM sqlite_master WHERE type='table' AND name='save_manifests'"));}
 async access(actor:Actor,id:string,write=false){
  const t=(await this.store.get<Timeline>('SELECT * FROM timelines WHERE id=? AND archived_at IS NULL',id));ensure(t,404,'timeline_unavailable');
  const access=(await this.domain.access(actor,{type:'campaign',id:t.campaign_id},write));return {t,access};
 }
 async list(actor:Actor,campaignId:string){(await this.domain.access(actor,{type:'campaign',id:campaignId}));return (await this.store.all('SELECT id,name,parent_id,parent_save_id,revision,clock FROM timelines WHERE campaign_id=? AND archived_at IS NULL ORDER BY created_at,id',campaignId));}
 async initialize(actor:Actor,campaignId:string){
  return (await this.store.transaction(async ()=>{
   (await this.domain.access(actor,{type:'campaign',id:campaignId},true));
   const existing=(await this.store.get<{id:string}>('SELECT id FROM timelines WHERE campaign_id=? AND parent_id IS NULL ORDER BY created_at LIMIT 1',campaignId));if(existing)return existing;
   const campaign=(await this.store.get<{starting_at:string;timezone:string;defaults_json:string;overrides_json:string}>('SELECT c.starting_at,c.timezone,cc.defaults_json,cc.overrides_json FROM campaigns c JOIN campaign_configurations cc ON cc.campaign_id=c.id WHERE c.id=?',campaignId))!;
   const stored=campaign.defaults_json?parseStoredCampaignConfig({defaults_json:campaign.defaults_json,overrides_json:campaign.overrides_json,revision:1,schema_version:1}):{defaults:defaultCampaignConfig(campaign.starting_at,campaign.timezone),overrides:{},revision:1,schemaVersion:1};
   const resolved=resolveCampaignConfig(stored.defaults,stored.overrides),id=randomUUID(),settings=settingsSchema.parse({campaign:resolved,timezone:resolved.timezone,needs:resolved.needsIntensity!=='off',intensity:resolved.injuryIntensity==='restrained'?'restrained':'grounded'});
   (await this.store.run('INSERT INTO timelines(id,campaign_id,name,clock,settings_json,created_at) VALUES (?,?,?,?,?,?)',id,campaignId,'Original timeline',resolved.startAt,JSON.stringify(settings),now()));
   const binding=await this.store.get<{canon_revision_id:string}>('SELECT canon_revision_id FROM campaign_canon_bindings WHERE campaign_id=?',campaignId);
   if(binding)await this.store.run('INSERT INTO timeline_canon_bindings VALUES (?,?,?)',id,binding.canon_revision_id,now());
   if(await this.recoverySchemaReady()){const initial=await this.load(id),cursor=await this.store.get<{cursor:string}>('SELECT cursor FROM timeline_turn_cursors WHERE timeline_id=?',id);ensure(cursor,409,'turn_cursor_unavailable');let saveId:string|null=null;if((initial.settings.campaign?.saveBehavior.autosave??'safe-commit')==='safe-commit')saveId=await this.saveInternal(actor,id,'Initial checkpoint',initial,1,{automatic:true,checkpoint:'safe-commit',cursor:cursor.cursor,eventId:null});await this.store.run('INSERT INTO timeline_commit_history(timeline_id,revision,cursor,event_id,save_id,state_checksum,committed_at) VALUES (?,?,?,?,?,?,?)',id,1,cursor.cursor,null,saveId,checksum(initial),now());}
   (await this.audit(actor,campaignId,'timeline.created',id));return {id};
  }));
 }
 async canon(id:string):Promise<CanonSource|null>{
  const portable=await this.store.get<{source_json:string}>('SELECT source_json FROM timeline_canon_sources WHERE timeline_id=?',id);
  if(portable)return canonSourceSchema.nullable().parse(JSON.parse(portable.source_json));
  const binding=await this.store.get<{canon_revision_id:string;world_id:string}>('SELECT b.canon_revision_id,r.world_id FROM timeline_canon_bindings b JOIN canon_revisions r ON r.id=b.canon_revision_id WHERE b.timeline_id=?',id);
  if(!binding)return null;
  const records=await this.store.all<{snapshot_json:string}>('SELECT snapshot_json FROM canon_revision_records WHERE revision_id=? ORDER BY record_id',binding.canon_revision_id);
  return {revisionId:binding.canon_revision_id,worldId:binding.world_id,records:records.map(r=>canonSnapshotSchema.parse(JSON.parse(r.snapshot_json)))};
 }
 private async pinCanon(id:string,source:CanonSource|null){await this.store.run('INSERT INTO timeline_canon_sources VALUES (?,?)',id,JSON.stringify(source));}
 async worldHistory(id:string,throughRevision?:number){
  const inherited=await this.store.get<{history_json:string}>('SELECT history_json FROM timeline_world_history WHERE timeline_id=?',id);
  const rows=await this.store.all<{event_id:string;canon_revision_id:string|null;configuration_json:string}>('SELECT w.* FROM event_world_context w JOIN game_events e ON e.id=w.event_id WHERE e.timeline_id=? AND (? IS NULL OR e.revision<=?) ORDER BY e.rowid',id,throughRevision??null,throughRevision??null);
  return [...(inherited?JSON.parse(inherited.history_json):[]),...rows.map(r=>({eventId:r.event_id,canonRevisionId:r.canon_revision_id,configuration:JSON.parse(r.configuration_json)}))];
 }
 async load(id:string):Promise<State>{
  return this.store.transaction(async()=>{
  const t=(await this.store.get<Timeline>('SELECT * FROM timelines WHERE id=?',id))!;
  const entities=(await this.store.all<{id:string;kind:Entity['kind'];name:string;visibility:Entity['visibility'];data_json:string;revision:number;archived_at:string|null}>('SELECT * FROM game_entities WHERE timeline_id=? ORDER BY id',id)).map(e=>({id:e.id,kind:e.kind,name:e.name,visibility:e.visibility,data:JSON.parse(e.data_json),revision:e.revision,archived:!!e.archived_at}));
  const facts=(await this.store.all<Record<string,unknown>>('SELECT * FROM world_facts WHERE timeline_id=? ORDER BY id',id)).map(r=>factSchema.parse({id:r.id,subjectId:r.subject_id,predicate:r.predicate,objectId:r.object_id,value:JSON.parse(String(r.value_json)),qualifiers:JSON.parse(String(r.qualifiers_json)),source:r.source,truthStatus:r.truth_status,audience:JSON.parse(String(r.audience_json)),confidence:r.confidence,observedAt:r.observed_at,learnedAt:r.learned_at,validFrom:r.valid_from,validUntil:r.valid_until,eventId:r.source_event_id,eventIds:JSON.parse(String(r.event_ids_json)),evidenceIds:JSON.parse(String(r.evidence_ids_json)),tags:JSON.parse(String(r.tags_json)),at:r.created_at,retiredAt:r.retired_at}));
  const knowledge=(await this.store.all<Record<string,unknown>>('SELECT * FROM character_knowledge WHERE timeline_id=?',id)).map(r=>knowledgeSchema.parse({observerId:r.observer_id,factId:r.fact_id,source:r.source,at:r.learned_at,confidence:r.confidence,observedAt:r.observed_at,expiresAt:r.expires_at,evidenceIds:JSON.parse(String(r.evidence_ids_json))}));
  const beliefs=(await this.store.all<Record<string,unknown>>('SELECT * FROM character_beliefs WHERE timeline_id=?',id)).map(r=>beliefSchema.parse({id:r.id,observerId:r.observer_id,proposition:r.proposition,subjectId:r.subject_id,predicate:r.predicate,objectId:r.object_id,value:JSON.parse(String(r.value_json)),qualifiers:JSON.parse(String(r.qualifiers_json)),confidence:r.confidence,source:r.source,truthStatus:r.truth_status,audience:JSON.parse(String(r.audience_json)),observedAt:r.observed_at,validFrom:r.valid_from,validUntil:r.valid_until,eventIds:JSON.parse(String(r.event_ids_json)),evidenceIds:JSON.parse(String(r.evidence_ids_json)),tags:JSON.parse(String(r.tags_json)),at:r.updated_at,correctedBy:r.corrected_by}));
  const memories=(await this.store.all<Record<string,unknown>>('SELECT * FROM character_memories WHERE timeline_id=?',id)).map(r=>memorySchema.parse({id:r.id,observerId:r.observer_id,text:r.text,interpretation:r.interpretation,salience:r.salience,decayPerDay:r.decay_per_day,eventId:r.source_event_id,eventRefs:JSON.parse(String(r.event_refs_json)),at:r.created_at,private:!!r.private,privacy:r.privacy,recallConditions:JSON.parse(String(r.recall_conditions_json)),lastRefreshedAt:r.last_refreshed_at,refreshCount:r.refresh_count,expiresAt:r.expires_at,tags:JSON.parse(String(r.tags_json))}));
  const inherited=await this.store.get<{history_json:string}>('SELECT history_json FROM timeline_world_history WHERE timeline_id=?',id),currentEvents=await this.store.all<{id:string}>('SELECT id FROM game_events WHERE timeline_id=? ORDER BY revision',id),eventIds=[...new Set([...(inherited?JSON.parse(inherited.history_json).map((row:{eventId:string})=>row.eventId):[]),...currentEvents.map(row=>row.id)])];
  return {canon:await this.canon(id),clock:t.clock,settings:settingsSchema.parse(JSON.parse(t.settings_json)),entities,facts,knowledge,beliefs,memories,eventIds};
  },'read');
 }
 async persist(id:string,s:State){
  validateState(s);const timestamp=now();
  const statements:InStatement[]=[];
  const write=(sql:string,...args:InValue[])=>{statements.push({sql,args});};
  const previousRows=await this.store.all<{id:string;revision:number;name:string;visibility:string;data_json:string;archived_at:string|null}>('SELECT id,revision,name,visibility,data_json,archived_at FROM game_entities WHERE timeline_id=?',id);
  const byId=new Map(previousRows.map(row=>[row.id,row]));
  const previousLinks=await this.store.all<{entity_id:string;target_id:string}>('SELECT entity_id,target_id FROM entity_links WHERE timeline_id=?',id),linksByEntity=new Map<string,Set<string>>();
  for(const link of previousLinks){let targets=linksByEntity.get(link.entity_id);if(!targets){targets=new Set();linksByEntity.set(link.entity_id,targets);}targets.add(link.target_id);}
  for(const e of s.entities){
   const previous=byId.get(e.id);
   const json=JSON.stringify(e.data),changed=!previous||previous.name!==e.name||previous.visibility!==e.visibility||previous.data_json!==json||!!previous.archived_at!==e.archived;
   e.revision=previous?previous.revision+(changed?1:0):e.revision;
   if(changed)write('INSERT INTO game_entities VALUES (?,?,?,?,?,?,?,NULL,?,?,?) ON CONFLICT(timeline_id,id) DO UPDATE SET name=excluded.name,visibility=excluded.visibility,data_json=excluded.data_json,revision=excluded.revision,updated_at=excluded.updated_at,archived_at=excluded.archived_at',
    id,e.id,e.kind,e.name,e.visibility,json,e.revision,timestamp,timestamp,e.archived?timestamp:null);
  }
  const currentIds=new Set(s.entities.map(entity=>entity.id));
  for(const e of s.entities){
   const current=new Set(refs(e)),previous=linksByEntity.get(e.id)??new Set<string>();
   if(current.size===previous.size&&[...current].every(ref=>previous.has(ref)))continue;
   write('DELETE FROM entity_links WHERE timeline_id=? AND entity_id=?',id,e.id);
   for(const ref of current)write('INSERT INTO entity_links VALUES (?,?,?)',id,e.id,ref);
  }
  for(const entityId of linksByEntity.keys())if(!currentIds.has(entityId))write('DELETE FROM entity_links WHERE timeline_id=? AND entity_id=?',id,entityId);
  for(const raw of s.facts){const f=factSchema.parse(raw),eventIds=[...new Set([f.eventId,...f.eventIds])];write('INSERT INTO world_facts(timeline_id,id,subject_id,predicate,value_json,source_event_id,created_at,retired_at,object_id,qualifiers_json,source,truth_status,audience_json,confidence,observed_at,learned_at,valid_from,valid_until,event_ids_json,evidence_ids_json,tags_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(timeline_id,id) DO UPDATE SET retired_at=excluded.retired_at,truth_status=excluded.truth_status',id,f.id,f.subjectId,f.predicate,JSON.stringify(f.value),f.eventId,f.at,f.retiredAt,f.objectId,JSON.stringify(f.qualifiers),f.source,f.truthStatus,JSON.stringify(f.audience),f.confidence,f.observedAt,f.learnedAt,f.validFrom,f.validUntil,JSON.stringify(eventIds),JSON.stringify(f.evidenceIds),JSON.stringify(f.tags));}
  for(const raw of s.knowledge){const k=knowledgeSchema.parse(raw);write('INSERT INTO character_knowledge(timeline_id,observer_id,fact_id,source,learned_at,confidence,observed_at,expires_at,evidence_ids_json) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING',id,k.observerId,k.factId,k.source,k.at,k.confidence,k.observedAt,k.expiresAt,JSON.stringify(k.evidenceIds));}
  for(const raw of s.beliefs){const b=beliefSchema.parse(raw);write('INSERT INTO character_beliefs(timeline_id,id,observer_id,proposition,confidence,source,updated_at,corrected_by,subject_id,predicate,object_id,value_json,qualifiers_json,truth_status,audience_json,observed_at,valid_from,valid_until,event_ids_json,evidence_ids_json,tags_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(timeline_id,id) DO UPDATE SET proposition=excluded.proposition,confidence=excluded.confidence,source=excluded.source,updated_at=excluded.updated_at,corrected_by=excluded.corrected_by,truth_status=excluded.truth_status,audience_json=excluded.audience_json,valid_until=excluded.valid_until,event_ids_json=excluded.event_ids_json,evidence_ids_json=excluded.evidence_ids_json,tags_json=excluded.tags_json',id,b.id,b.observerId,b.proposition,b.confidence,b.source,b.at,b.correctedBy,b.subjectId,b.predicate,b.objectId,JSON.stringify(b.value),JSON.stringify(b.qualifiers),b.truthStatus,JSON.stringify(b.audience),b.observedAt,b.validFrom,b.validUntil,JSON.stringify(b.eventIds),JSON.stringify(b.evidenceIds),JSON.stringify(b.tags));}
  for(const raw of s.memories){const m=memorySchema.parse(raw),eventRefs=[...new Set([m.eventId,...m.eventRefs])];write('INSERT INTO character_memories(timeline_id,id,observer_id,text,salience,decay_per_day,source_event_id,created_at,private,interpretation,privacy,recall_conditions_json,last_refreshed_at,refresh_count,expires_at,event_refs_json,tags_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(timeline_id,id) DO UPDATE SET text=excluded.text,interpretation=excluded.interpretation,salience=excluded.salience,decay_per_day=excluded.decay_per_day,created_at=excluded.created_at,private=excluded.private,privacy=excluded.privacy,recall_conditions_json=excluded.recall_conditions_json,last_refreshed_at=excluded.last_refreshed_at,refresh_count=excluded.refresh_count,expires_at=excluded.expires_at,event_refs_json=excluded.event_refs_json,tags_json=excluded.tags_json',id,m.id,m.observerId,m.text,m.salience,m.decayPerDay,m.eventId,m.at,m.private?1:0,m.interpretation,m.privacy,JSON.stringify(m.recallConditions),m.lastRefreshedAt,m.refreshCount,m.expiresAt,JSON.stringify(eventRefs),JSON.stringify(m.tags));}
  write('UPDATE timelines SET clock=?,settings_json=? WHERE id=?',s.clock,JSON.stringify(s.settings),id);
  for(let offset=0;offset<statements.length;offset+=100)await this.store.batch(statements.slice(offset,offset+100));
 }
 private async audit(actor:Actor,campaignId:string,action:string,targetId:string,details:{reason?:string;note?:string;before?:unknown;after?:unknown}={}){
  await this.store.run('INSERT INTO audit_log(id,actor_id,campaign_id,action,target_id,created_at,request_id,reason,before_json,after_json,note) VALUES (?,?,?,?,?,?,?,?,?,?,?)',randomUUID(),actor.id,campaignId,action,targetId,now(),actor.requestId??null,details.reason??action,auditJson(details.before),auditJson(details.after),details.note??null);
 }
 private controlled(actor:Actor,s:State,characterId:string,role:string){
  const e=getEntity(s,characterId,'character'),d=data(e,'character');
  ensure(d.playable&&(d.controllerUserId===actor.id||privileged(role)&&d.controllerUserId===null),403,'character_not_controlled');return e;
 }
 async roster(actor:Actor,id:string){
  const {t,access}=await this.access(actor,id),s=await this.load(id),developer=privileged(access.role)&&(await this.domain.userMode(actor)).mode==='developer';
  const campaign=await this.store.get<{name:string}>('SELECT name FROM campaigns WHERE id=?',t.campaign_id);
  const turns=await this.store.all<{character_id:string;last_played:string}>('SELECT character_id,MAX(created_at) last_played FROM story_turns WHERE timeline_id=? GROUP BY character_id',id);
  const starts=await this.store.all<{character_id:string;last_played:string}>('SELECT character_id,MAX(created_at) last_played FROM game_events WHERE timeline_id=? AND character_id IS NOT NULL GROUP BY character_id',id);
  const lastPlayed=new Map(starts.map(row=>[row.character_id,row.last_played]));for(const row of turns)lastPlayed.set(row.character_id,row.last_played);
  const saveRows=await this.store.all<{name:string;revision:number;created_at:string}>('SELECT name,revision,created_at FROM saves WHERE timeline_id=? AND (?=1 OR created_by=?) ORDER BY rowid DESC LIMIT 100',id,developer?1:0,actor.id),latestSave=saveRows[0]??null;
  return s.entities.filter(e=>e.kind==='character'&&!e.archived&&e.data.playable&&(e.data.controllerUserId===actor.id||developer&&!e.data.controllerUserId)).map(e=>{
   const d=data(e,'character'),location=d.locationId?s.entities.find(x=>x.id===d.locationId&&x.kind==='location'&&!x.archived):null;
   const permittedLocation=location&&visible(s,location,e.id)?{id:location.id,name:location.name}:null;
   const portraitMediaId=d.mediaIds.find(mediaId=>{const media=s.entities.find(x=>x.id===mediaId&&x.kind==='media'&&!x.archived);return Boolean(media&&visible(s,media,e.id));})??null;
   return {id:e.id,name:e.name,description:d.description,condition:d.condition,status:d.condition,campaign:{id:t.campaign_id,name:campaign?.name??'Campaign'},lastPlayed:lastPlayed.get(e.id)??null,location:permittedLocation,locationTime:permittedLocation?s.clock:null,portraitMediaId,timeline:{id:t.id,name:t.name,revision:t.revision,clock:s.clock,parentId:t.parent_id},saveSummary:{count:saveRows.length,latest:latestSave?{name:latestSave.name,revision:latestSave.revision,createdAt:latestSave.created_at}:null}};
  });
 }
 private validateStartSystems(s:State,definition:StartDefinition){
  const builtIn:Record<string,boolean>={needs:s.settings.needs,fuel:s.settings.fuel,romance:s.settings.romance,intimacy:s.settings.intimacy!=='off','reproductive-health':s.settings.reproductiveHealth,rules:s.settings.rules!==null,'npc-route-travel':s.settings.npcRouteTravel,tactics:s.settings.tactics!==null};
  const disabled=definition.requiresSystems.filter(system=>s.settings.campaign?.enabledSystems[system]===false||(system in builtIn&&!builtIn[system]));
  ensure(!disabled.length,400,'start_package_requires_disabled_system');
 }
 private startSummary(s:State,definition:StartDefinition){
  const sources=[...new Set([...definition.grantEntityIds,...definition.plotHookIds])].map(id=>s.entities.find(e=>e.id===id&&!e.archived)).filter((e):e is Entity=>Boolean(e));
  const character=definition.character.data,items=sources.filter(e=>e.kind==='item'),relations=sources.filter(e=>e.kind==='relationship');
  const includes:string[]=[];
  const add=(when:boolean,label:string)=>{if(when)includes.push(label);};
  add(sources.some(e=>e.kind==='job'),'job');add(sources.some(e=>e.kind==='housing')||Object.prototype.hasOwnProperty.call(character,'homeId'),'home');
  add(items.some(e=>e.kind==='item'&&data(e,'item').category==='phone'),'phone');add(items.some(e=>e.kind==='item'&&data(e,'item').contacts.length>0),'contacts');
  add(definition.reputation.length>0,'reputation');add(Array.isArray(character.traits)&&character.traits.length>0,'traits');add(Boolean(character.skills&&typeof character.skills==='object'&&Object.keys(character.skills).length),'skills');
  add(items.some(e=>e.kind==='item'&&data(e,'item').category==='clothing'),'clothing');add(Object.prototype.hasOwnProperty.call(character,'cash')||Object.prototype.hasOwnProperty.call(character,'bank'),'money');
  add(sources.some(e=>e.kind==='vehicle'),'vehicle');add(sources.some(e=>e.kind==='quest'),'ongoing problem');add(definition.relationshipTemplates.length>0||relations.length>0,'relationship history');
  return {characterName:definition.character.name,includes,grantCount:sources.length,relationshipCount:definition.relationshipTemplates.length+relations.length,reputationCount:definition.reputation.length,requiresSystems:definition.requiresSystems};
 }
 private materializeStart(s:State,actor:Actor,definition:StartDefinition,enforceEmpty=true,eventId?:string){
  this.validateStartSystems(s,definition);
  if(enforceEmpty)ensure(!s.entities.some(e=>e.kind==='character'&&!e.archived&&e.data.playable),409,'timeline_already_started');
  const characterId=randomUUID();
  const rawData={...definition.character.data,description:definition.character.description,playable:true,controllerUserId:actor.id};
  const character=validateEntity({id:characterId,kind:'character',name:definition.character.name,visibility:'owner',data:rawData});
  const startingCharacter=data(character,'character');prepareAppearance(s,startingCharacter);applyStartingGrants(startingCharacter,s.entities);validateStartingBuild(s,startingCharacter);character.data=startingCharacter;s.entities.push(character);assignResidence(s,character);
  const sources=[...new Set([...definition.grantEntityIds,...definition.plotHookIds])];
  for(const sourceId of sources){
   const source=getEntity(s,sourceId);
   ensure(['item','vehicle','quest','housing','relationship','job'].includes(source.kind),400,'invalid_start_grant');
   const clone=structuredClone(source);
   clone.id=randomUUID();clone.revision=1;clone.archived=false;clone.visibility=source.kind==='relationship'?'owner':source.visibility;
   if(source.kind==='item'){const d=data(clone,'item');d.ownerId=characterId;d.locationId=null;d.containerId=null;d.equipped=false;d.provenance='start:'+characterId;clone.data=d as Entity['data'];}
   if(source.kind==='vehicle'){const d=data(clone,'vehicle');d.ownerId=characterId;d.registeredOwnerId=characterId;d.locationId=data(character,'character').locationId;d.keyId=null;d.keyIds=[];d.occupants=[];d.ignition='off';d.authorizedDriverIds=[];d.accessGrants=[];d.hotwiredByIds=[];d.routeState=null;d.custodianId=null;d.custodyRole=null;d.custodyHistory=[];d.stolen=false;d.theftStatus='none';d.theftReports=[];d.discoveredByIds=[];clone.data=d as Entity['data'];}
   if(source.kind==='quest'){const d=data(clone,'quest');d.characterId=characterId;clone.data=d as Entity['data'];}
   if(source.kind==='housing'){const d=data(clone,'housing');d.tenantId=characterId;clone.data=d as Entity['data'];}
   if(source.kind==='relationship'){const d=data(clone,'relationship');d.fromId=characterId;d.disclosure=d.secret?'secret':'private';d.knownByIds=[...new Set([...d.knownByIds,characterId,d.toId])];clone.data=d as Entity['data'];}
   if(source.kind==='job'){const d=data(clone,'job');d.employeeId=characterId;d.lastWorked=null;clone.data=d as Entity['data'];}
   s.entities.push(validateEntity(clone));
  }
  for(const relation of definition.relationshipTemplates){
   getEntity(s,relation.targetId,'character');
   s.entities.push(validateEntity({id:randomUUID(),kind:'relationship',name:relation.labels[0]??'Starting relationship',visibility:'owner',data:{
    fromId:characterId,toId:relation.targetId,labels:relation.labels,attraction:relation.attraction,affection:relation.affection,
    trust:relation.trust,respect:relation.respect,familiarity:relation.familiarity,secret:relation.secret,disclosure:relation.secret?'secret':'private',knownByIds:[characterId,relation.targetId],
    labelRecords:relation.labels.map(label=>({id:randomUUID(),label,category:'other',disclosure:relation.secret?'secret':'private',knownByIds:[characterId,relation.targetId],status:'active',sourceEventId:eventId??null,at:s.clock,endedAt:null}))
   }}));
  }
  for(const reputation of definition.reputation){
   if(eventId)recordReputation(s,reputation.factionId,characterId,reputation.score,eventId,'Starting reputation',0,'private',[reputation.factionId]);
   else{const faction=getEntity(s,reputation.factionId,'faction'),d=data(faction,'faction');d.reputation[characterId]=reputation.score;faction.data=d as Entity['data'];}
  }
  validateState(s);
  return character;
 }
 private async packageFor(actor:Actor,t:Timeline,id:string){
  const row=await this.store.get<{id:string;campaign_id:string;slug:string;name:string;description:string;kind:string;visibility:string;status:string;definition_json:string;schema_version:number;revision:number;created_at:string;updated_at:string}>('SELECT id,campaign_id,slug,name,description,kind,visibility,status,definition_json,schema_version,revision,created_at,updated_at FROM campaign_start_packages WHERE id=? AND campaign_id=? AND archived_at IS NULL',id,t.campaign_id);
  ensure(row,404,'start_package_unavailable');
  const role=(await this.domain.access(actor,{type:'campaign',id:t.campaign_id})).role;
  if(!privileged(role))ensure(row.visibility==='campaign'&&row.status==='published',403,'start_package_unavailable');
  return {...row,definition:startDefinitionSchema.parse(JSON.parse(row.definition_json))};
 }
 async creationOptions(actor:Actor,id:string){await this.access(actor,id);const s=await this.load(id);return {settings:{attributeScale:s.settings.attributeScale,residencePlans:s.settings.residencePlans},entities:s.entities.filter(e=>!e.archived&&e.visibility==='campaign'&&['trait','skill'].includes(e.kind)).map(e=>({id:e.id,kind:e.kind,name:e.name,data:{description:e.data.description,scale:e.data.scale,mode:e.data.mode,cost:e.data.cost,modifiers:e.data.modifiers,scopedCheckModifiers:e.data.scopedCheckModifiers,effects:e.data.effects,skillGrants:e.data.skillGrants,prerequisites:e.data.prerequisites,opposes:e.data.opposes}}))};}
 async startPackages(actor:Actor,id:string){
  const {t,access}=await this.access(actor,id),developer=privileged(access.role)&&(await this.domain.userMode(actor)).mode==='developer';
  const state=await this.load(id),rows=await this.store.all<{id:string;slug:string;name:string;description:string;kind:string;visibility:string;status:string;definition_json:string;schema_version:number;revision:number;created_at:string;updated_at:string}>("SELECT id,slug,name,description,kind,visibility,status,definition_json,schema_version,revision,created_at,updated_at FROM campaign_start_packages WHERE campaign_id=? AND archived_at IS NULL AND (status='published' AND visibility='campaign' OR ?=1) ORDER BY name,id",t.campaign_id,developer?1:0);  return rows.map(row=>{const definition=startDefinitionSchema.parse(JSON.parse(row.definition_json));const build={profile:Object.fromEntries(['heightCm','build','eyes','complexion','nationality','ethnicityContext','birthplace','identity','originNeighborhood','residence'].filter(key=>definition.character.data[key]!==undefined).map(key=>[key,definition.character.data[key]])),attributes:definition.character.data.attributes??{},skills:definition.character.data.skills??{},traits:definition.character.data.traits??[],background:Object.fromEntries(['option1','option2','option3','option4','originChoice'].map(key=>[key,(definition.character.data.background as Record<string,unknown>|undefined)?.[key]??'']))};const ids=[...(Array.isArray(build.traits)?build.traits:[]),...Object.keys(build.skills as object)];const customizable=ids.every(id=>state.entities.some(e=>e.id===id&&!e.archived&&e.visibility==='campaign'));return {customizable,...(customizable?{build}:{}),id:row.id,slug:row.slug,name:row.name,description:row.description,kind:row.kind,visibility:row.visibility,status:row.status,schemaVersion:row.schema_version,revision:row.revision,createdAt:row.created_at,updatedAt:row.updated_at,summary:this.startSummary(state,definition),...(developer?{definition}:{})};});
 }
 async createStartPackage(actor:Actor,id:string,input:unknown,key:string){
  keySchema.parse(key);
  const parsed=packageInputSchema.parse(input);
  return this.store.transaction(async()=>{
   const {t}=await this.access(actor,id,true),definition=startDefinitionSchema.parse(parsed.definition),state=await this.load(id);
   const duplicate=await this.store.get('SELECT id FROM campaign_start_packages WHERE campaign_id=? AND slug=? AND archived_at IS NULL',t.campaign_id,parsed.slug);
   ensure(!duplicate,409,'start_package_slug_taken');
   const preview=structuredClone(state);this.materializeStart(preview,actor,definition,false);
   const packageId=randomUUID(),at=now();
   await this.store.run('INSERT INTO campaign_start_packages VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',packageId,t.campaign_id,parsed.slug,parsed.name,parsed.description,parsed.kind,parsed.visibility,parsed.status,JSON.stringify(definition),1,1,actor.id,at,at,null);
   await this.audit(actor,t.campaign_id,'start.package.created',packageId,{reason:'start.package.created',after:{name:parsed.name,slug:parsed.slug,kind:parsed.kind,status:parsed.status}});
   return {id:packageId,slug:parsed.slug,revision:1};
  });
 }
 async duplicateStartPackage(actor:Actor,id:string,packageId:string,input:{name:string;slug:string;visibility?:'creator'|'campaign';status?:'draft'|'published'},key:string){
  const {t}=await this.access(actor,id,true),source=await this.packageFor(actor,t,packageId);
  return this.createStartPackage(actor,id,{name:input.name,slug:input.slug,description:source.description,kind:'template',visibility:input.visibility??'creator',status:input.status??'draft',definition:source.definition},key);
 }
 async start(actor:Actor,id:string,input:{revision:number;packageId?:string;definition?:unknown;choices?:unknown},key:string){
  const parsed=z.strictObject({revision:z.number().int().positive(),packageId:z.uuid().optional(),definition:z.unknown().optional(),choices:z.strictObject({profile:z.strictObject({heightCm:z.number().nullable().optional(),build:z.string().max(160).optional(),eyes:z.string().max(160).optional(),complexion:z.string().max(160).optional(),nationality:z.string().max(160).optional(),ethnicityContext:z.string().max(16000).optional(),birthplace:z.string().max(160).optional(),identity:z.record(z.string().max(100),z.string().max(160)).optional(),originNeighborhood:z.string().max(160).optional(),residence:z.strictObject({neighborhood:z.string().max(160),name:z.string().max(160).default(''),building:z.literal(1).default(1),floor:z.literal(0).default(0),apartment:z.literal('').default('')}).nullable().optional()}).optional(),name:z.string().trim().min(1).max(160).optional(),occupations:z.array(z.strictObject({placeOfWork:z.string().max(1000),position:z.string().max(1000)})).max(3).optional(),attributes:z.record(z.string(),z.number()).optional(),skills:z.record(z.string(),z.number()).optional(),traits:z.array(z.uuid()).max(100).optional(),background:z.record(z.string(),z.string()).optional()}).optional()}).refine(v=>Boolean(v.packageId)!==Boolean(v.definition),'one_start_source_required').parse(input);
  return this.mutate(actor,id,parsed.revision,key,parsed,'start.character',false,async(s,eventId,seed,role)=>{
   const timeline=(await this.store.get<Timeline>('SELECT * FROM timelines WHERE id=?',id))!;
   const definition=parsed.packageId?(await this.packageFor(actor,timeline,parsed.packageId)).definition:startDefinitionSchema.parse(parsed.definition);
   if(!parsed.packageId)ensure(privileged(role),403,'freeform_start_creator_only');
   if(parsed.choices){ensure(Boolean(parsed.packageId),400,'package_required_for_choices');definition.character.data=z.record(z.string(),z.json()).parse(applyPlayerChoices(s,definition.character.data,parsed.choices));}
   ensure(!await this.store.get('SELECT id FROM shared_world WHERE timeline_id=?',id),409,'world_authoring_only');
   if(await this.store.get('SELECT campaign_id FROM player_lives WHERE campaign_id=?',timeline.campaign_id))ensure(!s.entities.some(e=>e.kind==='character'&&e.data.playable),409,'life_already_started');
   if(parsed.choices?.name)definition.character.name=parsed.choices.name;
   const character=this.materializeStart(s,actor,definition,true,eventId);
   const effects:Effect[]=[{id:randomUUID(),text:'A new playable life is ready in the roster.',observers:[character.id],type:'start.created',subjectId:character.id}];
   return {result:{characterId:character.id,packageId:parsed.packageId??null},effects,characterId:character.id,turnText:'start.character'};
  });
 } async view(actor:Actor,id:string,characterId:string){return this.store.transaction(async()=>{const {t,access}=(await this.access(actor,id));const s=(await this.load(id));this.controlled(actor,s,characterId,access.role);
  const cursor=await this.store.get<{revision:number;cursor:string}>('SELECT revision,cursor FROM timeline_turn_cursors WHERE timeline_id=?',id);ensure(cursor&&cursor.revision===t.revision,409,'turn_cursor_desynchronized');
  return {timeline:{id:t.id,name:t.name,revision:cursor.revision,turnCursor:cursor.cursor},...observerView(s,characterId),journal:journalView(s,characterId),caseFiles:s.entities.filter(entity=>entity.kind==='case'&&!entity.archived&&entity.data.investigatorId===characterId).map(entity=>caseFileView(s,entity.id,characterId)),checks:await this.checkHistory(id,characterId,false,s),turns:(await this.transcript(id)).filter(turn=>turn.character_id===characterId&&turn.user_id===actor.id).slice(-100).map(presentTranscript)};},'read');}
 async relationships(actor:Actor,id:string,characterId:string){const {access}=await this.access(actor,id),state=await this.load(id);this.controlled(actor,state,characterId,access.role);return playerRelationships(state,characterId);}
 async phone(actor:Actor,id:string,characterId:string){const {access}=await this.access(actor,id),state=await this.load(id);this.controlled(actor,state,characterId,access.role);return phoneView(state,characterId);}
 async inventory(actor:Actor,id:string,characterId:string,options:{sort?:'name'|'category'|'condition'|'quantity';category?:string;equipped?:boolean}){const {access}=await this.access(actor,id),state=await this.load(id);this.controlled(actor,state,characterId,access.role);return inventoryView(state,characterId,options);}
 async socialGraph(actor:Actor,id:string){const {access}=await this.access(actor,id,true),mode=await this.domain.userMode(actor);ensure(privileged(access.role)&&mode.mode==='developer',403,'developer_mode_required');return developerSocialGraph(await this.load(id));}
 async projections(actor:Actor,id:string,characterId:string){
  const {access}=await this.access(actor,id),state=await this.load(id);
  this.controlled(actor,state,characterId,access.role);
  return buildFoundationProjections(state,characterId,(await this.transcript(id)).filter(turn=>turn.user_id===actor.id));
 }
 async checks(actor:Actor,id:string,characterId:string){
  const {access}=(await this.access(actor,id));
  const state=await this.load(id);
  if(!privileged(access.role))this.controlled(actor,state,characterId,access.role);
  else getEntity(state,characterId,'character');
  return this.checkHistory(id,characterId,privileged(access.role),state);
 } async checkHistory(id:string,characterId:string,revealSources=false,state?:State){
  const rows=(await this.store.all<Record<string,unknown>>('SELECT id,event_id,character_id,check_definition_id,attribute,skill_id,context,difficulty,die_value,attribute_value,skill_value,total,outcome,modifiers_json,provenance_json,created_at FROM check_records WHERE timeline_id=? AND character_id=? ORDER BY rowid DESC LIMIT 200',id,characterId)).map(row=>({...row,modifiers:JSON.parse(String(row.modifiers_json)) as Array<{kind?:string;name:string;value:number;sourceId?:string}>,provenance:JSON.parse(String(row.provenance_json)) as Record<string,unknown>}));
  if(revealSources)return rows;const snapshot=state??await this.load(id);
  return rows.map(row=>({...row,modifiers:row.modifiers.map(modifier=>{if(!modifier.sourceId)return modifier;const source=snapshot.entities.find(entity=>entity.id===modifier.sourceId);return source&&visible(snapshot,source,characterId)?modifier:{kind:modifier.kind,name:'Private authored modifier',value:modifier.value};}),provenance:Object.fromEntries(Object.entries(row.provenance).filter(([key])=>!['requiredTraits','missingRequirements','traitEffectResolution'].includes(key)))}));
 } async creator(actor:Actor,id:string){const {t}=(await this.access(actor,id,true));return {timeline:t,...(await this.load(id)),references:(await this.store.all('SELECT entity_id,target_id FROM entity_links WHERE timeline_id=?',id))};}
 async characterProfileTemplates(actor:Actor,id:string){
  const {t}=await this.access(actor,id,true),campaign=await this.store.get<{source_world_id:string}>('SELECT source_world_id FROM campaigns WHERE id=?',t.campaign_id);
  return (await this.store.all<{id:string;name:string;template_json:string;revision:number;created_at:string;updated_at:string}>('SELECT id,name,template_json,revision,created_at,updated_at FROM character_profile_templates WHERE world_id=? AND archived_at IS NULL ORDER BY name,id',campaign!.source_world_id))
   .map(row=>({id:row.id,name:row.name,definition:characterProfileTemplateSchema.parse(JSON.parse(row.template_json)),revision:row.revision,createdAt:row.created_at,updatedAt:row.updated_at}));
 }
 async createCharacterProfileTemplate(actor:Actor,id:string,input:{name:string;characterId:string}){
  return this.store.transaction(async()=>{
   const {t}=await this.access(actor,id,true),state=await this.load(id),character=getEntity(state,input.characterId,'character'),profile=data(character,'character');
   const campaign=await this.store.get<{source_world_id:string}>('SELECT source_world_id FROM campaigns WHERE id=?',t.campaign_id),templateName=z.string().trim().min(1).max(160).parse(input.name),templateId=randomUUID(),timestamp=now();
   ensure(!(await this.store.get('SELECT id FROM character_profile_templates WHERE world_id=? AND name=? AND archived_at IS NULL',campaign!.source_world_id,templateName)),409,'character_profile_template_name_taken');
   const layout=profile.sections.map(section=>({...section,fields:section.fields.map(field=>({...field,value:field.repeatable?[]:field.type==='number'?0:field.type==='boolean'?false:field.type==='json'?{}:''}))}));
   const definition=characterProfileTemplateSchema.parse({schemaVersion:1,sections:layout});
   await this.store.run('INSERT INTO character_profile_templates(id,world_id,name,template_json,revision,created_by,created_at,updated_at,archived_at) VALUES (?,?,?,?,1,?,?,?,NULL)',templateId,campaign!.source_world_id,templateName,JSON.stringify(definition),actor.id,timestamp,timestamp);
   await this.audit(actor,t.campaign_id,'character.profile-template.created',templateId,{after:{name:templateName,characterId:character.id,sections:definition.sections.length}});
   return {id:templateId};
  });
 }
 async useCharacterProfileTemplate(actor:Actor,id:string,input:{revision:number;templateId:string;characterId:string},key:string){
  const {t}=await this.access(actor,id,true),campaign=await this.store.get<{source_world_id:string}>('SELECT source_world_id FROM campaigns WHERE id=?',t.campaign_id);
  const row=await this.store.get<{template_json:string}>('SELECT template_json FROM character_profile_templates WHERE id=? AND world_id=? AND archived_at IS NULL',input.templateId,campaign!.source_world_id);
  ensure(row,404,'character_profile_template_unavailable');const definition=characterProfileTemplateSchema.parse(JSON.parse(row.template_json));
  return this.mutate(actor,id,input.revision,key,input,'creator.character-profile-template',true,s=>{
   const character=getEntity(s,input.characterId,'character'),profile=data(character,'character');
   profile.sections=applyCharacterProfileTemplate(profile.sections,definition);profile.characterSchemaVersion=5;character.data=profile as Entity['data'];
   validateEntity(character);return {result:{characterId:character.id,templateId:input.templateId}};
  });
 }
 async preview(actor:Actor,id:string,characterId:string){await this.access(actor,id,true);const s=await this.load(id);getEntity(s,characterId,'character');return observerView(s,characterId);}
 private npcMediaReferences(state:State,npc:Entity,allowedIds?:Set<string>){
  const character=data(npc,'character'),ids=[...new Set([...(character.portraitMediaId?[character.portraitMediaId]:[]),...character.mediaIds])];
  const references=ids.map(mediaId=>state.entities.find(entity=>entity.id===mediaId&&entity.kind==='media'&&!entity.archived)).filter((entity):entity is Entity=>!!entity&&(!allowedIds||allowedIds.has(entity.id))).map(entity=>{const media=data(entity,'media');return {id:entity.id,name:entity.name,mime:media.mime,alt:media.alt,visibility:entity.visibility};});
  return {portrait:character.portraitMediaId?references.find(reference=>reference.id===character.portraitMediaId)??null:null,media:references.filter(reference=>reference.id!==character.portraitMediaId)};
 }
 private async npcEventHistory(id:string,npcId:string){
  return await this.store.all<Record<string,unknown>>('SELECT id,revision,actor_id AS actorId,character_id AS characterId,type,input_json AS input,effects_json AS effects,clock,created_at AS createdAt FROM game_events WHERE timeline_id=? AND (character_id=? OR instr(input_json,?)>0 OR instr(effects_json,?)>0) ORDER BY rowid DESC LIMIT 100',id,npcId,npcId,npcId);
 }
 async npcRegistry(actor:Actor,id:string,filters:NpcFilters={}){
  await this.access(actor,id,true);const state=await this.load(id),events=await this.store.all<{character_id:string|null;input_json:string;effects_json:string;created_at:string}>('SELECT character_id,input_json,effects_json,created_at FROM game_events WHERE timeline_id=? ORDER BY rowid',id),lastActive=new Map<string,string>();
  const npcIds=new Set(state.entities.filter(entity=>entity.kind==='character'&&!entity.data.playable).map(entity=>entity.id)),uuid=/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gi;
  for(const event of events)for(const candidate of new Set([...(event.character_id?[event.character_id]:[]),...((event.input_json+' '+event.effects_json).match(uuid)??[])]))if(npcIds.has(candidate))lastActive.set(candidate,event.created_at);
  const items=listNpcs(state,filters,lastActive);return {items,total:items.length};
 }
 async creatorNpcProfile(actor:Actor,id:string,npcId:string){
  await this.access(actor,id,true);const state=await this.load(id),npc=state.entities.find(entity=>entity.id===npcId&&entity.kind==='character'&&!entity.data.playable);ensure(npc,404,'npc_unavailable');
  const history=await this.npcEventHistory(id,npcId),lastActive=history[0]?.createdAt?String(history[0].createdAt):null;
  return {kind:'creator-dossier',canonicalSource:'authored-record',entity:npc,derived:npcDerived(state,npc,lastActive),mediaReferences:this.npcMediaReferences(state,npc),
   relationships:state.entities.filter(entity=>entity.kind==='relationship'&&(entity.data.fromId===npcId||entity.data.toId===npcId)),jobs:state.entities.filter(entity=>entity.kind==='job'&&entity.data.employeeId===npcId),
   injuries:state.entities.filter(entity=>entity.kind==='injury'&&entity.data.characterId===npcId),references:npcReferrers(state,npcId),history};
 }
 async playerNpcProfile(actor:Actor,id:string,npcId:string,observerId:string){
  const {access}=await this.access(actor,id),state=await this.load(id);this.controlled(actor,state,observerId,access.role);
  const npc=state.entities.find(entity=>entity.id===npcId&&entity.kind==='character'&&!entity.archived&&!entity.data.playable);ensure(npc&&visible(state,npc,observerId),404,'npc_unavailable');
  const view=observerView(state,observerId),presented=project(state,npc,observerId),allowedMedia=new Set([...(presented.data.mediaIds as string[]??[]),...(presented.data.portraitMediaId?[String(presented.data.portraitMediaId)]:[])]);
  const facts=view.facts.filter(row=>row.subjectId===npcId);
  const relationships=view.entities.filter(entity=>entity.kind==='relationship'&&(entity.data.fromId===npcId||entity.data.toId===npcId));
  return {kind:'player-presentation',canonicalSource:'authored-and-learned-fields',entity:presented,knownFacts:facts,relationships,mediaReferences:this.npcMediaReferences(state,npc,allowedMedia)};
 }
 async previewNpcMerge(actor:Actor,id:string,sourceNpcId:string,targetNpcId:string){
  await this.access(actor,id,true);ensure(sourceNpcId!==targetNpcId,400,'npc_merge_same_record');const state=await this.load(id),source=state.entities.find(entity=>entity.id===sourceNpcId&&entity.kind==='character'&&!entity.archived&&!entity.data.playable),target=state.entities.find(entity=>entity.id===targetNpcId&&entity.kind==='character'&&!entity.archived&&!entity.data.playable);ensure(source&&target,404,'npc_unavailable');
  const sourceHistory=await this.npcEventHistory(id,sourceNpcId),targetHistory=await this.npcEventHistory(id,targetNpcId);
  return {source:{id:source.id,name:source.name,revision:source.revision},target:{id:target.id,name:target.name,revision:target.revision},conflicts:npcMergeConflicts(source,target),references:{source:npcReferrers(state,source.id),target:npcReferrers(state,target.id)},events:{source:sourceHistory.length,target:targetHistory.length},eventPolicy:'immutable-events-retain-original-character-id',reversible:true};
 }
 async mergeNpcs(actor:Actor,id:string,input:{revision:number;sourceNpcId:string;targetNpcId:string;resolution:Record<string,'source'|'target'>},key:string){
  ensure(input.sourceNpcId!==input.targetNpcId,400,'npc_merge_same_record');
  return this.mutate(actor,id,input.revision,key,input,'creator.npc.merge',true,async(s,eventId)=>{
   const source=s.entities.find(entity=>entity.id===input.sourceNpcId&&entity.kind==='character'&&!entity.archived&&!entity.data.playable),target=s.entities.find(entity=>entity.id===input.targetNpcId&&entity.kind==='character'&&!entity.archived&&!entity.data.playable);ensure(source&&target,404,'npc_unavailable');
   const before=mergePayload(s),merged=mergeNpcData(source,target,input.resolution),mergeId=randomUUID();
   remapNpcReferences(s,source.id,target.id,true);
   const targetIndex=s.entities.findIndex(entity=>entity.id===target.id);s.entities[targetIndex]=remapEntityReference(merged,source.id,target.id);
   const sourceIndex=s.entities.findIndex(entity=>entity.id===source.id),archived=structuredClone(source),sourceData=data(archived,'character');sourceData.registryStatus='retired';sourceData.mergedIntoId=target.id;sourceData.mergeRecordId=mergeId;archived.data=sourceData as Entity['data'];archived.archived=true;s.entities[sourceIndex]=archived;
   validateState(s);const afterChecksum=checksum(mergePayloadForChecksum(s));
   await this.store.run('INSERT INTO npc_merge_records(id,timeline_id,source_npc_id,target_npc_id,merge_revision,resolution_json,before_json,after_checksum,event_id,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',mergeId,id,source.id,target.id,input.revision+1,JSON.stringify(input.resolution),JSON.stringify(before),afterChecksum,eventId,actor.id,now());
   return {result:{mergeId,sourceNpcId:source.id,targetNpcId:target.id,archivedSource:true,reversible:true}};
  });
 }
 async reverseNpcMerge(actor:Actor,id:string,input:{revision:number;mergeId:string},key:string){
  return this.mutate(actor,id,input.revision,key,input,'creator.npc.merge-reversed',true,async s=>{
   const row=await this.store.get<{before_json:string;after_checksum:string;reversed_at:string|null}>('SELECT before_json,after_checksum,reversed_at FROM npc_merge_records WHERE id=? AND timeline_id=?',input.mergeId,id);ensure(row,404,'npc_merge_unavailable');ensure(!row.reversed_at,409,'npc_merge_already_reversed');ensure(checksum(mergePayloadForChecksum(s))===row.after_checksum,409,'npc_merge_has_subsequent_changes');
   const before=JSON.parse(row.before_json) as ReturnType<typeof mergePayload>;s.entities=before.entities;s.facts=before.facts;s.knowledge=before.knowledge;s.beliefs=before.beliefs;s.memories=before.memories;validateState(s);
   await this.store.run('UPDATE npc_merge_records SET reversed_at=?,reversed_by=? WHERE id=? AND reversed_at IS NULL',now(),actor.id,input.mergeId);
   return {result:{mergeId:input.mergeId,reversed:true}};
  });
 }
 async retireNpc(actor:Actor,id:string,input:{revision:number;npcId:string;strategy:'replacement'|'retirement';replacementId?:string;narrative:string},key:string){
  return this.mutate(actor,id,input.revision,key,input,'creator.npc.retired',true,async(s,eventId)=>{
   const npc=s.entities.find(entity=>entity.id===input.npcId&&entity.kind==='character'&&!entity.archived&&!entity.data.playable);ensure(npc,404,'npc_unavailable');const character=data(npc,'character'),referrers=npcReferrers(s,npc.id);
   ensure(input.narrative.trim().length>0,400,'npc_retirement_narrative_required');
   if(character.condition!=='dead'&&referrers.length)ensure(input.strategy==='replacement'||input.strategy==='retirement',409,'living_referenced_npc_strategy_required');
   if(input.strategy==='replacement'){
    ensure(input.replacementId&&input.replacementId!==npc.id,400,'npc_replacement_required');const replacement=s.entities.find(entity=>entity.id===input.replacementId&&entity.kind==='character'&&!entity.archived&&!entity.data.playable);ensure(replacement,404,'npc_replacement_unavailable');remapNpcReferences(s,npc.id,replacement.id,true);
   }
   const current=s.entities.find(entity=>entity.id===npc.id)!,retired=data(current,'character');retired.registryStatus='retired';retired.retirementNarrative=input.narrative.trim();retired.lastActiveAt=s.clock;if(input.strategy==='replacement')retired.mergedIntoId=input.replacementId!;current.data=retired as Entity['data'];current.archived=true;validateState(s);
   const retirementId=randomUUID();await this.store.run('INSERT INTO npc_retirement_records(id,timeline_id,npc_id,strategy,replacement_id,narrative,event_id,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?)',retirementId,id,npc.id,input.strategy,input.replacementId??null,input.narrative.trim(),eventId,actor.id,now());
   return {result:{retirementId,npcId:npc.id,strategy:input.strategy,replacementId:input.replacementId??null,archived:true,preservedReferences:input.strategy==='retirement'?referrers.length:0}};
  });
 }
 async media(actor:Actor,id:string,mediaId:string,characterId:string){
  const {access}=await this.access(actor,id),s=await this.load(id);this.controlled(actor,s,characterId,access.role);const entity=getEntity(s,mediaId,'media');ensure(visible(s,entity,characterId),404,'media_unavailable');const m=data(entity,'media');return {mime:m.mime,bytes:mediaBytes(m.mime,m.body)};
 }
 private async developerAccess(actor:Actor,id:string){
  const result=await this.access(actor,id,true),mode=await this.domain.userMode(actor);ensure(privileged(result.access.role)&&mode.mode==='developer',403,'developer_mode_required');return result;
 }
 private async studioValidation(id:string,raw:unknown,characterId?:string){
  const state=await this.load(id),beforeState=structuredClone(state);
  try{
   const entity=validateEntity(raw),previous=state.entities.find(row=>row.id===entity.id),staged=structuredClone(state);
   const index=staged.entities.findIndex(row=>row.id===entity.id);if(index<0)staged.entities.push(entity);else staged.entities[index]=entity;
   validateState(staged);
   const candidate={...staged,entities:staged.entities.filter(row=>row.id!==entity.id)};if(previous)candidate.entities.push(previous);await this.applyEntity(id,candidate,entity);staged.entities=candidate.entities;validateState(staged);
   const incoming=state.entities.filter(row=>row.id!==entity.id&&refs(row).includes(entity.id)).map(row=>({id:row.id,name:row.name,kind:row.kind,archived:row.archived})),outgoing=refs(entity).map(targetId=>{const target=staged.entities.find(row=>row.id===targetId);return {id:targetId,name:target?.name??null,kind:target?.kind??null,missing:!target};});
   const eventReferences=(await this.store.get<{n:number}>('SELECT count(*) n FROM game_events WHERE timeline_id=? AND (character_id=? OR instr(input_json,?)>0 OR instr(effects_json,?)>0)',id,entity.id,entity.id,entity.id))?.n??0;
   const playable=staged.entities.filter(row=>row.kind==='character'&&row.data.playable&&!row.archived),observer=characterId?staged.entities.find(row=>row.id===characterId&&row.kind==='character'&&!row.archived):undefined,playerPreview=observer?observerView(staged,observer.id).entities.find(row=>row.id===entity.id)??null:null;
   const beforeVisible=observer?observerView(beforeState,observer.id).entities.find(row=>row.id===entity.id)??null:null,warnings:string[]=[];
   if(entity.archived)warnings.push('Publishing archives the live record; active references must be resolved first.');
   if(incoming.length)warnings.push(incoming.length+' active or archived records reference this content.');
   if(eventReferences)warnings.push(eventReferences+' immutable events mention this record and will retain their original history.');
   if(previous&&previous.kind!==entity.kind)warnings.push('Record kind cannot change after publication.');
   if(!observer)warnings.push('Choose a character to generate a Player-perspective preview.');
   return {valid:true,entity,sourceOfTruth:'published game_entities projection after creator.content.published event',developerPreview:entity,playerPreview,impact:{operation:previous?'update':'create',incoming,outgoing,eventReferences,playableCharacters:playable.length,selectedPlayerViewChanged:observer?checksum(beforeVisible)!==checksum(playerPreview):null,visibilityBefore:previous?.visibility??null,visibilityAfter:entity.visibility,archiveChange:Boolean(previous?.archived)!==Boolean(entity.archived)},warnings,generatedEntityCount:staged.entities.length-state.entities.length};
  }catch(error){return {valid:false,errors:validationErrors(error),sourceOfTruth:'draft only; invalid content cannot be published',developerPreview:raw,playerPreview:null,impact:null,warnings:['Fix validation errors before publishing.']};}
 }
 async studioDrafts(actor:Actor,id:string,filters:{query?:string;kind?:string;status?:'draft'|'published'|'archived'}={}){
  await this.developerAccess(actor,id);const query=(filters.query??'').trim().slice(0,160),kind=filters.kind&&kinds.includes(filters.kind as Kind)?filters.kind:null,status=filters.status??null;
  return this.store.all("SELECT id,entity_id AS entityId,kind,name,status,base_entity_revision AS baseEntityRevision,version,created_by AS createdBy,updated_by AS updatedBy,published_event_id AS publishedEventId,created_at AS createdAt,updated_at AS updatedAt FROM creator_content_drafts WHERE timeline_id=? AND (? IS NULL OR kind=?) AND (? IS NULL OR status=?) AND (?='' OR lower(name) LIKE '%'||lower(?)||'%' OR lower(kind) LIKE '%'||lower(?)||'%') ORDER BY updated_at DESC,id LIMIT 200",id,kind,kind,status,status,query,query,query);
 }
 async studioDraft(actor:Actor,id:string,draftId:string){
  await this.developerAccess(actor,id);const row=await this.store.get<Record<string,unknown>>('SELECT id,entity_id AS entityId,kind,name,status,entity_json AS entityJson,base_entity_revision AS baseEntityRevision,version,created_by AS createdBy,updated_by AS updatedBy,published_event_id AS publishedEventId,created_at AS createdAt,updated_at AS updatedAt FROM creator_content_drafts WHERE id=? AND timeline_id=?',draftId,id);ensure(row,404,'creator_draft_unavailable');
  return {...row,entity:JSON.parse(String(row.entityJson)),entityJson:undefined,versions:(await this.store.all<Record<string,unknown>>('SELECT version,action,validation_json AS validationJson,reason,created_by AS createdBy,created_at AS createdAt FROM creator_content_versions WHERE draft_id=? ORDER BY version DESC LIMIT 100',draftId)).map(version=>({...version,validation:JSON.parse(String(version.validationJson)),validationJson:undefined}))};
 }
 async saveStudioDraft(actor:Actor,id:string,input:{draftId?:string;expectedVersion?:number;entity:unknown;reason:string}){
  ensureJsonBytes(input.entity,2*1024*1024,'creator_draft_too_large');return this.store.transaction(async()=>{const {t}=await this.developerAccess(actor,id),identity=z.object({id:z.uuid(),kind:z.string().min(1).max(80),name:z.string().max(160)}).passthrough().parse(input.entity);ensure(kinds.includes(identity.kind as Kind),400,'unknown_entity_kind');const existing=input.draftId?await this.store.get<{entity_id:string;version:number;created_at:string;created_by:string}>('SELECT entity_id,version,created_at,created_by FROM creator_content_drafts WHERE id=? AND timeline_id=?',input.draftId,id):null;if(input.draftId)ensure(existing,404,'creator_draft_unavailable');if(existing){ensure(existing.entity_id===identity.id,409,'draft_entity_identity_immutable');ensure(input.expectedVersion===undefined||input.expectedVersion===existing.version,409,'draft_version_conflict');}
   const report=await this.studioValidation(id,input.entity),draftId=input.draftId??randomUUID(),version=(existing?.version??0)+1,timestamp=now(),reason=z.string().trim().min(1).max(500).parse(input.reason),summary={valid:report.valid,errors:'errors'in report?report.errors:[],warnings:report.warnings};
   if(existing)await this.store.run('UPDATE creator_content_drafts SET kind=?,name=?,status=?,entity_json=?,base_entity_revision=?,version=?,updated_by=?,published_event_id=NULL,updated_at=? WHERE id=?',identity.kind,identity.name,'draft',JSON.stringify(input.entity),(await this.load(id)).entities.find(entity=>entity.id===identity.id)?.revision??null,version,actor.id,timestamp,draftId);
   else await this.store.run('INSERT INTO creator_content_drafts(id,timeline_id,entity_id,kind,name,status,entity_json,base_entity_revision,version,created_by,updated_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',draftId,id,identity.id,identity.kind,identity.name,'draft',JSON.stringify(input.entity),(await this.load(id)).entities.find(entity=>entity.id===identity.id)?.revision??null,version,actor.id,actor.id,timestamp,timestamp);
   await this.store.run('INSERT INTO creator_content_versions VALUES (?,?,?,?,?,?,?,?)',draftId,version,'drafted',JSON.stringify(input.entity),JSON.stringify(summary),reason,actor.id,timestamp);await this.audit(actor,t.campaign_id,'creator.content.drafted',draftId,{reason,after:{entityId:identity.id,kind:identity.kind,name:identity.name,version,valid:report.valid}});return {draftId,version,status:'draft' as const,validation:report};
  });
 }
 async validateStudioDraft(actor:Actor,id:string,draftId:string,characterId?:string){
  await this.developerAccess(actor,id);const row=await this.store.get<{entity_json:string;version:number;status:string}>('SELECT entity_json,version,status FROM creator_content_drafts WHERE id=? AND timeline_id=?',draftId,id);ensure(row,404,'creator_draft_unavailable');return {draftId,version:row.version,status:row.status,...await this.studioValidation(id,JSON.parse(row.entity_json),characterId)};
 }
 async publishStudioDraft(actor:Actor,id:string,input:{drafts:{id:string;version:number}[];revision:number;reason:string;confirmed:boolean},key:string){
  await this.developerAccess(actor,id);const drafts=z.array(z.strictObject({id:z.uuid(),version:z.number().int().positive()})).min(1).max(100).parse(input.drafts);ensure(input.confirmed,409,'publish_confirmation_required');const reason=z.string().trim().min(1).max(500).parse(input.reason);
  return this.mutate(actor,id,input.revision,key,{drafts,reason,confirmed:true},'creator.content.published',true,async(s,eventId)=>{
   const rows=[] as Array<{id:string;entity_json:string;version:number}>;for(const selection of drafts){const row=await this.store.get<{id:string;entity_json:string;version:number;status:string}>('SELECT id,entity_json,version,status FROM creator_content_drafts WHERE id=? AND timeline_id=?',selection.id,id);ensure(row,404,'creator_draft_unavailable');ensure(row.status==='draft',409,'creator_draft_not_publishable');ensure(row.version===selection.version,409,'draft_version_conflict');rows.push(row);}
   const entities=rows.map(row=>validateEntity(JSON.parse(row.entity_json))),staged=structuredClone(s);for(const entity of entities){const index=staged.entities.findIndex(row=>row.id===entity.id);if(index<0)staged.entities.push(entity);else staged.entities[index]=entity;}validateState(staged);
   for(const entity of entities){const old=s.entities.find(row=>row.id===entity.id),candidate={...staged,entities:staged.entities.filter(row=>row.id!==entity.id)};if(old)candidate.entities.push(old);await this.applyEntity(id,candidate,entity);staged.entities=candidate.entities;}validateState(staged);s.entities=staged.entities;
   const timestamp=now();for(const [index,row] of rows.entries()){const version=row.version+1,entity=entities[index]!;await this.store.run('UPDATE creator_content_drafts SET status=?,entity_json=?,base_entity_revision=?,version=?,updated_by=?,published_event_id=?,updated_at=? WHERE id=?',entity.archived?'archived':'published',JSON.stringify(entity),entity.revision,version,actor.id,eventId,timestamp,row.id);await this.store.run('INSERT INTO creator_content_versions VALUES (?,?,?,?,?,?,?,?)',row.id,version,entity.archived?'archived':'published',JSON.stringify(entity),JSON.stringify({valid:true,publishedEventId:eventId}),reason,actor.id,timestamp);}
   return {result:{draftIds:rows.map(row=>row.id),entityIds:entities.map(entity=>entity.id),publishedEventId:eventId}};
  });
 }
 async restoreStudioVersion(actor:Actor,id:string,draftId:string,version:number,reason:string){
  return this.store.transaction(async()=>{const {t}=await this.developerAccess(actor,id),draft=await this.store.get<{version:number;entity_id:string}>('SELECT version,entity_id FROM creator_content_drafts WHERE id=? AND timeline_id=?',draftId,id);ensure(draft,404,'creator_draft_unavailable');const historical=await this.store.get<{entity_json:string}>('SELECT entity_json FROM creator_content_versions WHERE draft_id=? AND version=?',draftId,version);ensure(historical,404,'creator_version_unavailable');const identity=z.object({kind:z.string(),name:z.string()}).parse(JSON.parse(historical.entity_json)),next=draft.version+1,timestamp=now(),why=z.string().trim().min(1).max(500).parse(reason);
   await this.store.run('UPDATE creator_content_drafts SET kind=?,name=?,status=?,entity_json=?,version=?,updated_by=?,published_event_id=NULL,updated_at=? WHERE id=?',identity.kind,identity.name,'draft',historical.entity_json,next,actor.id,timestamp,draftId);await this.store.run('INSERT INTO creator_content_versions VALUES (?,?,?,?,?,?,?,?)',draftId,next,'restored',historical.entity_json,JSON.stringify({valid:null,restoredFrom:version}),why,actor.id,timestamp);await this.audit(actor,t.campaign_id,'creator.content.version-restored',draftId,{reason:why,before:{version:draft.version},after:{version:next,restoredFrom:version,entityId:draft.entity_id}});return {draftId,version:next,status:'draft' as const,restoredFrom:version};
  });
 }
 async createStudioTemplate(actor:Actor,id:string,input:{draftId:string;name:string}){
  return this.store.transaction(async()=>{const {t}=await this.developerAccess(actor,id),draft=await this.store.get<{kind:string;entity_json:string}>('SELECT kind,entity_json FROM creator_content_drafts WHERE id=? AND timeline_id=?',input.draftId,id);ensure(draft,404,'creator_draft_unavailable');const report=await this.studioValidation(id,JSON.parse(draft.entity_json));ensure(report.valid,400,'invalid_creator_template');const campaign=await this.store.get<{source_world_id:string}>('SELECT source_world_id FROM campaigns WHERE id=?',t.campaign_id),templateId=randomUUID(),timestamp=now(),templateName=z.string().trim().min(1).max(160).parse(input.name);await this.store.run('INSERT INTO creator_content_templates VALUES (?,?,?,?,?,?,?,?,?,?)',templateId,campaign!.source_world_id,templateName,draft.kind,draft.entity_json,1,'active',actor.id,timestamp,timestamp);await this.audit(actor,t.campaign_id,'creator.content-template.created',templateId,{after:{draftId:input.draftId,name:templateName,kind:draft.kind}});return {id:templateId};
  });
 }
 async studioTemplates(actor:Actor,id:string,kind?:string){
  const {t}=await this.developerAccess(actor,id),campaign=await this.store.get<{source_world_id:string}>('SELECT source_world_id FROM campaigns WHERE id=?',t.campaign_id);return this.store.all('SELECT id,name,kind,revision,created_at AS createdAt,updated_at AS updatedAt FROM creator_content_templates WHERE world_id=? AND status=? AND (? IS NULL OR kind=?) ORDER BY name,id',campaign!.source_world_id,'active',kind??null,kind??null);
 }
 async instantiateStudioTemplate(actor:Actor,id:string,input:{templateId:string;name:string;reason:string}){
  const {t}=await this.developerAccess(actor,id),campaign=await this.store.get<{source_world_id:string}>('SELECT source_world_id FROM campaigns WHERE id=?',t.campaign_id),template=await this.store.get<{kind:string;entity_json:string}>('SELECT kind,entity_json FROM creator_content_templates WHERE id=? AND world_id=? AND status=?',input.templateId,campaign!.source_world_id,'active');ensure(template,404,'creator_template_unavailable');const entity=JSON.parse(template.entity_json) as Record<string,unknown>;entity.id=randomUUID();entity.name=z.string().trim().min(1).max(160).parse(input.name);entity.revision=1;entity.archived=false;return this.saveStudioDraft(actor,id,{entity,reason:input.reason});
 }
 async developerDebugSnapshot(actor:Actor,id:string,characterId?:string){
  const {t}=await this.developerAccess(actor,id),state=await this.load(id),cursor=await this.store.get('SELECT revision,cursor,updated_at AS updatedAt FROM timeline_turn_cursors WHERE timeline_id=?',id),projection=characterId?observerView(state,getEntity(state,characterId,'character').id):null;
  return {sourceOfTruth:{events:'game_events (immutable committed intent/effects)',rawState:'typed projection tables rebuilt from the latest committed state',publishedContent:'game_entities; Creator drafts are non-canonical until publish',saves:'immutable saves + save_manifests checksums',ai:'ai_requests and usage rows; prompts/contexts are digested, never stored raw'},timeline:t,cursor,rawState:state,playerProjection:projection,recentEvents:await this.store.all('SELECT id,revision,type,character_id AS characterId,clock,created_at AS createdAt FROM game_events WHERE timeline_id=? ORDER BY revision DESC LIMIT 50',id),turnTraces:await this.store.all('SELECT trace_id AS traceId,event_id AS eventId,status,failure_reason AS failureReason,created_at AS createdAt,completed_at AS completedAt FROM turn_traces WHERE timeline_id=? ORDER BY created_at DESC LIMIT 50',id),aiRequests:await this.store.all('SELECT trace_id AS traceId,purpose,provider,model,prompt_id AS promptId,prompt_version AS promptVersion,response_schema_id AS responseSchemaId,response_schema_version AS responseSchemaVersion,status,attempt_count AS attempts,input_tokens AS inputTokens,output_tokens AS outputTokens,failure_code AS failureCode,created_at AS createdAt FROM ai_requests WHERE trace_id IN (SELECT id FROM ai_usage WHERE timeline_id=? UNION SELECT id FROM ai_intent_usage WHERE timeline_id=?) ORDER BY created_at DESC LIMIT 50',id,id),repairs:await this.store.all('SELECT id,operation,before_checksum AS beforeChecksum,after_checksum AS afterChecksum,report_json AS report,created_at AS createdAt FROM developer_repair_records WHERE timeline_id=? ORDER BY created_at DESC LIMIT 50',id)};
 }
 async previewDeveloperFixture(actor:Actor,id:string,seed:string){
  const {t}=await this.developerAccess(actor,id),state=await this.load(id),clean=z.string().trim().min(1).max(200).parse(seed),locationId=deterministicUuid(clean,'location'),npcId=deterministicUuid(clean,'npc'),itemId=deterministicUuid(clean,'item'),entities=[validateEntity({id:locationId,kind:'location',name:'Fixture '+clean+' room',visibility:'creator',data:{description:'Deterministic System 32 fixture location.'}}),validateEntity({id:npcId,kind:'character',name:'Fixture '+clean+' NPC',visibility:'creator',data:{locationId,playable:false}}),validateEntity({id:itemId,kind:'item',name:'Fixture '+clean+' item',visibility:'creator',data:{locationId}})],collisions=entities.filter(entity=>state.entities.some(row=>row.id===entity.id)).map(entity=>entity.id),plan={version:1,kind:'deterministic-fixture',seed:clean,entities},token=randomUUID(),createdAt=now(),expiresAt=new Date(Date.now()+30*60*1000).toISOString();await this.store.run('INSERT INTO developer_operation_previews VALUES (?,?,?,?,?,?,?,?,?,?,NULL)',token,id,actor.id,'fixture',JSON.stringify(plan),checksum(plan),checksum(state),t.revision,createdAt,expiresAt);return {valid:collisions.length===0,dryRun:true,persisted:false,token,expiresAt,expectedRevision:t.revision,confirmation:'APPLY '+token,collisions,plan};
 }
 async applyDeveloperFixture(actor:Actor,id:string,input:{token:string;revision:number;confirmation:string},key:string){
  await this.developerAccess(actor,id);return this.mutate(actor,id,input.revision,key,input,'developer.fixture.applied',true,async s=>{const preview=await this.store.get<{plan_json:string;plan_checksum:string;state_checksum:string;expires_at:string;used_at:string|null}>('SELECT plan_json,plan_checksum,state_checksum,expires_at,used_at FROM developer_operation_previews WHERE token=? AND timeline_id=? AND actor_id=? AND operation=?',input.token,id,actor.id,'fixture');ensure(preview,404,'developer_preview_unavailable');ensure(!preview.used_at,409,'developer_preview_used');ensure(preview.expires_at>now(),409,'developer_preview_expired');ensure(input.confirmation==='APPLY '+input.token,409,'developer_confirmation_mismatch');ensure(checksum(s)===preview.state_checksum,409,'developer_preview_state_changed');const plan=JSON.parse(preview.plan_json) as {entities:unknown[]};ensure(checksum(plan)===preview.plan_checksum,409,'developer_preview_corrupt');const entities=plan.entities.map(validateEntity);ensure(entities.every(entity=>!s.entities.some(row=>row.id===entity.id)),409,'fixture_collision');for(const entity of entities)await this.applyEntity(id,s,entity);validateState(s);await this.store.run('UPDATE developer_operation_previews SET used_at=? WHERE token=?',now(),input.token);return {result:{fixtureEntityIds:entities.map(entity=>entity.id),previewToken:input.token}};});
 }
 async previewDeveloperRepair(actor:Actor,id:string){
  const {t}=await this.developerAccess(actor,id),state=await this.load(id);validateState(state);const stored=new Set((await this.store.all<{entity_id:string;target_id:string}>('SELECT entity_id,target_id FROM entity_links WHERE timeline_id=?',id)).map(row=>row.entity_id+':'+row.target_id)),expected=new Set(state.entities.flatMap(entity=>refs(entity).map(target=>entity.id+':'+target))),missing=[...expected].filter(link=>!stored.has(link)),stale=[...stored].filter(link=>!expected.has(link)),plan={version:1,operation:'rebuild-projections',missingLinks:missing,staleLinks:stale,entityCount:state.entities.length,factCount:state.facts.length},token=randomUUID(),createdAt=now(),expiresAt=new Date(Date.now()+30*60*1000).toISOString();await this.store.run('INSERT INTO developer_operation_previews VALUES (?,?,?,?,?,?,?,?,?,?,NULL)',token,id,actor.id,'repair',JSON.stringify(plan),checksum(plan),checksum(state),t.revision,createdAt,expiresAt);return {valid:true,dryRun:true,persisted:false,token,expiresAt,expectedRevision:t.revision,confirmation:'REPAIR '+token,issues:{missingLinks:missing,staleLinks:stale},plan,warning:'Repair rebuilds derived projections only. Immutable events and saves are never rewritten.'};
 }
 async applyDeveloperRepair(actor:Actor,id:string,input:{token:string;revision:number;confirmation:string}){
  return this.store.transaction(async()=>{const {t}=await this.developerAccess(actor,id);ensure(t.revision===input.revision,409,'revision_conflict');const preview=await this.store.get<{plan_json:string;plan_checksum:string;state_checksum:string;expires_at:string;used_at:string|null}>('SELECT plan_json,plan_checksum,state_checksum,expires_at,used_at FROM developer_operation_previews WHERE token=? AND timeline_id=? AND actor_id=? AND operation=?',input.token,id,actor.id,'repair');ensure(preview,404,'developer_preview_unavailable');ensure(!preview.used_at,409,'developer_preview_used');ensure(preview.expires_at>now(),409,'developer_preview_expired');ensure(input.confirmation==='REPAIR '+input.token,409,'developer_confirmation_mismatch');const state=await this.load(id),before=checksum(state),plan=JSON.parse(preview.plan_json);ensure(before===preview.state_checksum,409,'developer_preview_state_changed');ensure(checksum(plan)===preview.plan_checksum,409,'developer_preview_corrupt');validateState(state);await this.persist(id,state);const afterState=await this.load(id),after=checksum(afterState);ensure(before===after,409,'repair_changed_source_state');const repairId=randomUUID(),timestamp=now(),report={operation:'rebuild-projections',revision:t.revision,plan,sourceStateUnchanged:true};await this.store.run('UPDATE developer_operation_previews SET used_at=? WHERE token=?',timestamp,input.token);await this.store.run('INSERT INTO developer_repair_records VALUES (?,?,?,?,?,?,?,?,?,?)',repairId,id,'rebuild-projections',input.token,before,after,JSON.stringify(report),null,actor.id,timestamp);await this.audit(actor,t.campaign_id,'developer.state.repaired',repairId,{reason:'confirmed projection rebuild',before:{checksum:before},after:{checksum:after,sourceStateUnchanged:true},note:'Immutable events and saves were not modified.'});return {repairId,...report};
  });
 }
 async operationalMetrics(actor:Actor,id:string){
  const {t}=await this.developerAccess(actor,id),since=new Date(Date.now()-24*60*60*1000).toISOString(),metrics=await this.store.all<Record<string,unknown>>("SELECT metric,count(*) AS samples,avg(value) AS average,max(value) AS maximum,sum(CASE WHEN status='failed' THEN 1 ELSE 0 END) AS failures FROM operational_metric_events WHERE (timeline_id=? OR campaign_id=? OR (timeline_id IS NULL AND campaign_id IS NULL)) AND created_at>=? GROUP BY metric ORDER BY metric",id,t.campaign_id,since),ai=await this.store.get<Record<string,unknown>>("SELECT count(*) AS requests,COALESCE(sum(reserved_tokens),0) AS reservedTokens,COALESCE(sum(used_tokens),0) AS usedTokens,sum(CASE WHEN status='failed' THEN 1 ELSE 0 END) AS failures FROM (SELECT reserved_tokens,used_tokens,status FROM ai_usage WHERE timeline_id=? UNION ALL SELECT reserved_tokens,0 AS used_tokens,status FROM ai_intent_usage WHERE timeline_id=?)",id,id),queue=await this.store.get<Record<string,unknown>>('SELECT count(*) AS pending,min(o.created_at) AS oldestPending FROM game_outbox o JOIN game_events e ON e.id=o.event_id WHERE e.timeline_id=? AND o.delivered_at IS NULL',id),turns=await this.store.get<Record<string,unknown>>("SELECT count(DISTINCT t.trace_id) AS turns,COALESCE(avg(s.duration_ms),0) AS averageStageMs,COALESCE(max(s.duration_ms),0) AS maximumStageMs,sum(CASE WHEN s.status='failed' THEN 1 ELSE 0 END) AS failedStages FROM turn_traces t LEFT JOIN turn_trace_steps s ON s.trace_id=t.trace_id WHERE t.timeline_id=? AND t.created_at>=?",id,since),storage=await this.store.get<Record<string,unknown>>('SELECT (SELECT count(*) FROM game_events WHERE timeline_id=?) AS events,(SELECT count(*) FROM saves WHERE timeline_id=?) AS saves,(SELECT COALESCE(sum(length(snapshot_json)),0) FROM saves WHERE timeline_id=?) AS saveManifestBytes,(SELECT COALESCE(sum(length(payload)),0) FROM snapshot_chunks) AS snapshotChunkBytes,(SELECT count(*) FROM game_entities WHERE timeline_id=?) AS entities',id,id,id,id),schema=await this.store.get<{version:number}>('SELECT max(version) version FROM schema_migrations');
  const simulation=await this.store.get<Record<string,unknown>>("SELECT count(*) AS samples,COALESCE(avg(s.duration_ms),0) AS averageMs,COALESCE(max(s.duration_ms),0) AS maximumMs,sum(CASE WHEN s.status='failed' THEN 1 ELSE 0 END) AS failures FROM turn_trace_steps s JOIN turn_traces t ON t.trace_id=s.trace_id WHERE t.timeline_id=? AND t.created_at>=? AND s.stage='deterministic-simulation'",id,since);
  return {window:{from:since,to:now()},sourceOfTruth:{api:'operational_metric_events',turns:'turn_traces + turn_trace_steps',simulation:'turn_trace_steps deterministic-simulation',ai:'ai_usage + ai_intent_usage + ai_requests',queue:'game_outbox',saves:'saves + snapshot chunks',schema:'schema_migrations'},api:metrics,turns,simulation,ai,queue,storage,schemaVersion:schema?.version??0,limits:{alertsExternal:true,aiBudgets:{campaign:(await this.load(id)).settings.tokenBudget,user:(await this.load(id)).settings.userTokenBudget},retention:'No automatic event/save pruning'}};
 }
 async diagnostics(actor:Actor,id:string){
  return this.store.transaction(async()=>{
   const {t}=await this.access(actor,id,true),s=await this.load(id);validateState(s);
   const warnings:string[]=[];
   if(s.entities.some(e=>e.kind==='character'&&!e.data.playable&&(e.data.schedule as unknown[]).length)&&!s.settings.npcRouteTravel)warnings.push('legacy_schedule_teleport_mode');
   if(s.settings.tokenBudget===0||s.settings.userTokenBudget===0)warnings.push('external_ai_budget_disabled');
   if(!s.settings.rules)warnings.push('resolution_rules_unconfigured');
   const saves=await this.store.get<{n:number;bytes:number}>('SELECT count(*) n,COALESCE(sum(length(snapshot_json)),0) bytes FROM saves WHERE timeline_id=?',id);
   const outbox=await this.store.get<{n:number}>('SELECT count(*) n FROM game_outbox o JOIN game_events e ON e.id=o.event_id WHERE e.timeline_id=? AND o.delivered_at IS NULL',id);
   return {revision:t.revision,valid:true,entities:s.entities.length,facts:s.facts.length,saves,pendingNotifications:outbox!.n,warnings};
  },'read');
 }
 async saveCompatibility(actor:Actor,id:string,saveId:string){await this.access(actor,id,true);const saved=await this.savedSnapshot(id,saveId);saved.state.entities=saved.state.entities.map(validateEntity);validateState(saved.state);return {valid:true,version:1,revision:saved.revision,entities:saved.state.entities.length,transcriptTurns:saved.transcript.length,metadata:saved.metadata??null,projectionRebuild:'validated',migrations:saved.metadata?[]:['legacy-v1-metadata-defaults']};}
 private async mutate<T extends object>(actor:Actor,id:string,expectedRevision:number,key:string,body:unknown,type:string,creator:boolean,fn:(s:State,eventId:string,seed:string,role:string)=>Mutation<T>|Promise<Mutation<T>>,trace?:{recorder:TurnTraceRecorder;expectedCursor?:string}){
  keySchema.parse(key);const recorder=trace?.recorder;
  const run=<R>(stage:string,task:()=>R|Promise<R>,details:Record<string,unknown>={})=>recorder?recorder.run(stage,task,details):Promise.resolve().then(task);
  return (await this.store.transaction(async ()=>{
   const {t,access}=await run('server-validation',()=>this.access(actor,id,creator),{operation:type});
   const receipt=await this.store.get<{body_hash:string;result_json:string}>('SELECT * FROM game_receipts WHERE timeline_id=? AND actor_id=? AND key=?',id,actor.id,key);
   if(receipt){ensure(receipt.body_hash===checksum(body),409,'idempotency_conflict');recorder?.mark('idempotency-replay','replayed',{requestKey:key});return JSON.parse(receipt.result_json);}
   const cursor=await this.store.get<{revision:number;cursor:string}>('SELECT revision,cursor FROM timeline_turn_cursors WHERE timeline_id=?',id);
   ensure(cursor,409,'turn_cursor_unavailable');ensure(t.revision===expectedRevision,409,'revision_conflict');ensure(cursor.revision===t.revision,409,'turn_cursor_desynchronized');
   if(trace?.expectedCursor!==undefined)ensure(cursor.cursor===trace.expectedCursor,409,'turn_cursor_conflict');
   recorder?.mark('turn-lock','succeeded',{protocol:'database-compare-and-swap',revision:t.revision,cursorMatched:trace?.expectedCursor!==undefined});
   const s=await run('state-load',()=>this.load(id)),beforeState=structuredClone(s),eventId=randomUUID(),seed=randomBytes(32).toString('hex');
   const beforeDeath=(s.settings.campaign?.saveBehavior.branchOnDeath??true)?structuredClone(s):null;
   const action=await run('deterministic-simulation',()=>fn(s,eventId,seed,access.role),{eventId,seedDigest:checksum(seed)});
   await run('state-projection',()=>this.persist(id,s));
   const revision=t.revision+1,nextCursor=randomUUID();
   const timelineUpdate=await this.store.run('UPDATE timelines SET revision=? WHERE id=? AND revision=?',revision,id,t.revision);ensure(timelineUpdate.rowsAffected===1,409,'revision_conflict');
   const cursorUpdate=await this.store.run('UPDATE timeline_turn_cursors SET revision=?,cursor=?,updated_at=? WHERE timeline_id=? AND revision=? AND cursor=?',revision,nextCursor,now(),id,t.revision,cursor.cursor);ensure(cursorUpdate.rowsAffected===1,409,'turn_cursor_conflict');
   await run('domain-event-append',async()=>{
    await this.store.run('INSERT INTO game_events VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',eventId,id,revision,actor.id,action.characterId??null,type,JSON.stringify(body),JSON.stringify(action.effects??[]),seed,action.draws??0,s.clock,now());
    for(const check of action.checks??[])await this.store.run('INSERT INTO check_records (id,timeline_id,event_id,character_id,check_definition_id,attribute,skill_id,context,difficulty,die_value,attribute_value,skill_value,total,outcome,modifiers_json,provenance_json,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',check.id,id,eventId,check.characterId,check.checkDefinitionId,check.attribute,check.skillId,check.context,check.difficulty,check.dieValue,check.attributeValue,check.skillValue,check.total,check.outcome,JSON.stringify(check.modifiers),JSON.stringify(check.provenance),now());
    const eventCanonId=s.canon?.revisionId;if(eventCanonId)await this.store.run('INSERT INTO event_canon_bindings VALUES (?,?,?)',eventId,eventCanonId,now());
    await this.store.run('INSERT INTO event_world_context VALUES (?,?,?)',eventId,s.canon?.revisionId??null,JSON.stringify(s.settings.campaign));
    await this.store.run('INSERT INTO game_outbox(event_id,created_at) VALUES (?,?)',eventId,now());
   },{eventId,revision,rngDraws:action.draws??0});
   const characterId=action.characterId;
   if(characterId){
    await run('grounded-summary',async()=>{
     const permitted=(action.effects??[]).filter(e=>e.observers.includes(characterId));
     const narration=permitted.map(e=>e.text).join('\n\n')||'The action resolved. No observer-visible change was recorded.';
     const presentation=chroniclePresentation(beforeState,s,characterId);
     await this.store.run('INSERT INTO story_turns (id,timeline_id,user_id,character_id,input_text,permitted_json,narration,narration_status,prompt_version,created_at,notices_json,scene_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',eventId,id,actor.id,characterId,action.turnText??type,JSON.stringify(permitted),narration,'grounded','grounded-v1',now(),JSON.stringify(presentation.notices),JSON.stringify(presentation.scene));
    },{eventId,mechanicsPreserved:true});
   }
   await this.audit(actor,t.campaign_id,type,eventId,{reason:type,before:creator?{revision:t.revision,command:body}:undefined,after:creator?{revision,effects:action.effects??[]}:undefined});
   const response={revision,eventId,turnCursor:nextCursor,...action.result};
   const recoveryReady=await this.recoverySchemaReady();let committedSaveId:string|null=null;
   if((s.settings.campaign?.saveBehavior.autosave??'safe-commit')==='safe-commit')committedSaveId=await this.saveInternal(actor,id,'Autosave '+revision,s,revision,{automatic:true,checkpoint:'safe-commit',cursor:nextCursor,eventId});
   if(recoveryReady)await this.store.run('INSERT INTO timeline_commit_history(timeline_id,revision,cursor,event_id,save_id,state_checksum,committed_at) VALUES (?,?,?,?,?,?,?)',id,revision,nextCursor,eventId,committedSaveId,checksum(s),now());
   const newlyDead=s.entities.find(e=>e.kind==='character'&&e.data.playable&&e.data.condition==='dead'&&beforeState.entities.some(old=>old.id===e.id&&old.data.condition!=='dead'));
   if(newlyDead){let deathBranchId:string|null=null;if(beforeDeath){const saveId=await this.saveInternal(actor,id,'Before death',beforeDeath,t.revision,{automatic:true,checkpoint:'before-death',cursor:cursor.cursor}),branch=await this.branch(actor,id,saveId,'Before death');deathBranchId=branch.id;}const mode=s.settings.campaign?.saveBehavior.postDeath??'load-or-branch',record=s.entities.find(entity=>entity.kind==='deathRecord'&&entity.data.characterId===newlyDead.id&&!entity.archived),options=mode==='observer'?['observe','roster']:mode==='roster'?['roster']:deathBranchId?['load-protected-branch','roster']:['roster'];Object.assign(response,{deathBranchId,deathTransition:{mode,characterId:newlyDead.id,deathRecordId:record?.id??null,branchId:deathBranchId,options}});}
   await this.store.run('INSERT INTO game_receipts VALUES (?,?,?,?,?)',id,actor.id,key,checksum(body),JSON.stringify(response));
   return response;
  }));
 } async developerValidate(actor:Actor,id:string,input:{revision:number;entities:unknown[]}){
  const {t}=await this.access(actor,id,true);ensure(t.revision===input.revision,409,'revision_conflict');
  const entities=z.array(entitySchema).min(1).max(100).parse(input.entities).map(validateEntity);ensure(new Set(entities.map(entity=>entity.id)).size===entities.length,400,'duplicate_entity_id');
  const state=await this.load(id),staged=structuredClone(state);
  for(const entity of entities){const index=staged.entities.findIndex(row=>row.id===entity.id);if(index<0)staged.entities.push(entity);else staged.entities[index]=entity;}
  validateState(staged);
  for(const entity of entities){const old=state.entities.find(row=>row.id===entity.id),candidate={...staged,entities:staged.entities.filter(row=>row.id!==entity.id)};if(old)candidate.entities.push(old);await this.applyEntity(id,candidate,entity);
    staged.entities=candidate.entities; /* Keep generated traits and homes from each entry. */}
  validateState(staged);
  const creates=entities.filter(entity=>!state.entities.some(row=>row.id===entity.id)).length,archives=entities.filter(entity=>entity.archived&&!state.entities.find(row=>row.id===entity.id)?.archived).length;
  return {valid:true,dryRun:true,persisted:false,revision:t.revision,count:entities.length,creates,updates:entities.length-creates,archives,kinds:Object.fromEntries([...new Set(entities.map(entity=>entity.kind))].map(kind=>[kind,entities.filter(entity=>entity.kind===kind).length])),warnings:archives?['Archived records disappear from normal views. Active references are rejected.']:[]};
 }
 async developerValidateSettings(actor:Actor,id:string,input:{revision:number;settings:unknown}){
  const {t}=await this.access(actor,id,true);ensure(t.revision===input.revision,409,'revision_conflict');const parsed=settingsSchema.parse(input.settings);new Intl.DateTimeFormat('en-US',{timeZone:parsed.timezone});const current=(await this.load(id)).settings;
  const changedKeys=Object.keys(parsed).filter(key=>checksum((current as unknown as Record<string,unknown>)[key])!==checksum((parsed as unknown as Record<string,unknown>)[key]));
  return {valid:true,dryRun:true,persisted:false,revision:t.revision,changedKeys,warnings:parsed.rules?[]:['Resolution rules remain unconfigured.']};
 } async developerSimulationPreview(actor:Actor,id:string,minutes:number){
  const {t}=await this.access(actor,id,true),state=await this.load(id),before=new Map(state.entities.map(entity=>[entity.id,checksum(entity)])),from=state.clock,effects:Effect[]=[];
  const playerId=state.entities.find(entity=>entity.kind==='character'&&entity.data.playable&&!entity.archived)?.id??state.entities.find(entity=>entity.kind==='character'&&!entity.archived)?.id??actor.id;
  advance(state,minutes,'developer-preview-'+randomUUID(),effects,playerId);validateState(state);
  const changed=state.entities.filter(entity=>before.has(entity.id)&&before.get(entity.id)!==checksum(entity)).map(entity=>({id:entity.id,name:entity.name,kind:entity.kind})),created=state.entities.filter(entity=>!before.has(entity.id)).map(entity=>({id:entity.id,name:entity.name,kind:entity.kind}));
  const effectTypes=Object.fromEntries([...new Set(effects.map(effect=>effect.type))].map(type=>[type,effects.filter(effect=>effect.type===type).length]));
  return {valid:true,dryRun:true,persisted:false,revision:t.revision,minutes,from,to:state.clock,summary:{changedEntities:changed.length,createdEntities:created.length,effects:effects.length,effectTypes},changed,created,effects:effects.slice(0,100)};
 } async edit(actor:Actor,id:string,input:{revision:number;entity:unknown},key:string){
  const entity=validateEntity(input.entity);
  return (await this.mutate(actor,id,input.revision,key,input,'creator.entity',true,async s=>{
   await this.applyEntity(id,s,entity);
   return {result:{entityId:entity.id}};
  }));
 }
 private async applyEntity(id:string,s:State,entity:Entity){
   const previous=s.entities.find(e=>e.id===entity.id);ensure(!previous||previous.kind===entity.kind,400,'entity_kind_immutable');
   if(previous&&['transaction','receipt'].includes(previous.kind))ensure(checksum(previous)===checksum(entity),409,'immutable_financial_record');
   if(entity.kind==='character'&&entity.data.controllerUserId)ensure((await this.store.get('SELECT user_id FROM memberships WHERE campaign_id=(SELECT campaign_id FROM timelines WHERE id=?) AND user_id=?',id,String(entity.data.controllerUserId))),400,'controller_not_member');
   if(entity.kind==='character'){
    const c=data(entity,'character');prepareAppearance(s,c,previous?data(previous,'character'):undefined);entity.data=c;if(!previous){applyStartingGrants(c,s.entities);entity.data=c;}const seen=new Set(c.traits);ensure(seen.size===c.traits.length,400,'duplicate_traits');
    const aligned=(value:number,min:number,step:number)=>Math.abs((value-min)/step-Math.round((value-min)/step))<1e-9;
    for(const value of Object.values(c.attributes)){ensure(value>=s.settings.attributeScale.min&&value<=s.settings.attributeScale.max,400,'attribute_out_of_scale');ensure(aligned(value,s.settings.attributeScale.min,s.settings.attributeScale.step),400,'attribute_step_mismatch');}
    for(const [skillId,value] of Object.entries(c.skills)){const skill=data(getEntity(s,skillId,'skill'),'skill');ensure(value>=skill.scale.min&&value<=skill.scale.max,400,'skill_out_of_scale');ensure(aligned(value,skill.scale.min,skill.scale.step),400,'skill_step_mismatch');}
    validateTraitSelection(s,c.traits,undefined,!c.playable);if(c.playable&&(!previous||!previous.data.playable))validateStartingBuild(s,c);
    if(previous){
     const before=new Set(data(previous,'character').traits);
     for(const old of before){const trait=data(getEntity(s,old,'trait'),'trait');ensure(!trait.permanent&&trait.loss.mode!=='never'||seen.has(old),400,'permanent_trait');}
     for(const added of seen)if(!before.has(added)){const trait=data(getEntity(s,added,'trait'),'trait');ensure(trait.acquirable,400,'trait_not_acquirable');ensure(['creator','either'].includes(trait.acquisition.mode),400,'trait_acquisition_requires_event');}
    }
   }
   if(entity.archived)ensure(!s.entities.some(e=>!e.archived&&e.id!==entity.id&&refs(e).includes(entity.id)),409,'entity_has_active_references');
   if(previous)s.entities[s.entities.indexOf(previous)]=entity;else s.entities.push(entity);
   if(entity.kind==='character')assignResidence(s,entity,previous?data(previous,'character'):undefined);
 }
 async bulkEdit(actor:Actor,id:string,input:{revision:number;entities:unknown[]},key:string){
  const entities=z.array(entitySchema).min(1).max(100).parse(input.entities).map(validateEntity);
  ensure(new Set(entities.map(e=>e.id)).size===entities.length,400,'duplicate_entity_id');
  return this.mutate(actor,id,input.revision,key,input,'creator.bulk',true,async s=>{
   // Put the complete candidate set in a staging state so references can cross batch entries.
   const staged=structuredClone(s);
   for(const entity of entities){const i=staged.entities.findIndex(e=>e.id===entity.id);if(i<0)staged.entities.push(entity);else staged.entities[i]=entity;}
   validateState(staged);
   for(const entity of entities){
    const old=s.entities.find(e=>e.id===entity.id);
    const candidate={...staged,entities:staged.entities.filter(e=>e.id!==entity.id)};
    if(old)candidate.entities.push(old);
    await this.applyEntity(id,candidate,entity);
    staged.entities=candidate.entities; /* Keep generated traits and homes from each entry. */
   }
   s.entities=staged.entities;return {result:{entityIds:entities.map(e=>e.id)}};
  });
 }
 private async savedSnapshot(id:string,saveId:string){
  const row=await this.store.get<{snapshot_json:string;checksum:string;revision:number}>('SELECT snapshot_json,checksum,revision FROM saves WHERE id=? AND timeline_id=?',saveId,id);
  ensure(row,404,'save_unavailable');const raw=await decodeSnapshot(this.store,JSON.parse(row.snapshot_json));
  ensure(checksum(raw)===row.checksum,409,'corrupt_save');return {revision:row.revision,...verifySnapshotMetadata(snapshotSchema.parse(raw))};
 }
 async compareSave(actor:Actor,id:string,saveId:string){
  return this.store.transaction(async()=>{
   await this.access(actor,id,true);const saved=await this.savedSnapshot(id,saveId),current=await this.load(id);
   const old=new Map(saved.state.entities.map(e=>[e.id,e])),fresh=new Map(current.entities.map(e=>[e.id,e]));
   return {saveRevision:saved.revision,savedClock:saved.state.clock,currentClock:current.clock,
    added:current.entities.filter(e=>!old.has(e.id)).map(e=>({id:e.id,name:e.name,kind:e.kind})),
    removed:saved.state.entities.filter(e=>!fresh.has(e.id)).map(e=>({id:e.id,name:e.name,kind:e.kind})),
    changed:current.entities.filter(e=>old.has(e.id)&&checksum(old.get(e.id))!==checksum(e)).map(e=>({id:e.id,name:e.name,kind:e.kind}))};
  },'read');
 }
 async restoreEntity(actor:Actor,id:string,input:{revision:number;saveId:string;entityId:string},key:string){
  return this.mutate(actor,id,input.revision,key,input,'creator.restore',true,async s=>{
   const saved=await this.savedSnapshot(id,input.saveId),entity=saved.state.entities.find(e=>e.id===input.entityId);
   ensure(entity,404,'entity_unavailable');await this.applyEntity(id,s,validateEntity(entity));
   return {result:{entityId:entity.id,sourceSaveId:input.saveId}};
  });
 }
 async configure(actor:Actor,id:string,revision:number,settings:unknown,key:string){
  const parsed=settingsSchema.parse(settings);new Intl.DateTimeFormat('en-US',{timeZone:parsed.timezone});
  return (await this.mutate(actor,id,revision,key,{revision,settings:parsed},'creator.settings',true,s=>{s.settings=parsed;return {result:{}};}));
 }
 async epistemic(actor:Actor,id:string,revision:number,input:{layer:'truth'|'knowledge'|'belief'|'memory'|'gossip'|'correct-belief'|'retire-truth'|'refresh-memory';subjectId:string;text:string;factId?:string;confidence?:number;recordId?:string;targetId?:string;salience?:number;decayPerDay?:number;predicate?:string;value?:unknown;propositionSubjectId?:string|null;objectId?:string|null;qualifiers?:Record<string,unknown>;source?:string;truthStatus?:'verified'|'asserted'|'disputed'|'false'|'superseded'|'believed'|'doubted'|'disproven'|'confirmed';audience?:string[];observedAt?:string|null;learnedAt?:string|null;validFrom?:string|null;validUntil?:string|null;eventIds?:string[];evidenceIds?:string[];tags?:string[];interpretation?:string;privacy?:'private'|'shared';recallConditions?:{entityIds?:string[];tags?:string[];locationId?:string|null;from?:string|null;until?:string|null};expiresAt?:string|null},key:string){
  return (await this.mutate(actor,id,revision,key,input,'creator.epistemic',true,(s,eventId)=>{
   getEntity(s,input.subjectId);if(input.propositionSubjectId)getEntity(s,input.propositionSubjectId);if(input.objectId)getEntity(s,input.objectId);for(const evidenceId of input.evidenceIds??[])getEntity(s,evidenceId,'evidence');
   if(['knowledge','belief','memory','gossip','correct-belief','refresh-memory'].includes(input.layer))getEntity(s,input.subjectId,'character');
   let recordId=input.recordId??input.factId??null;
   if(input.layer==='truth')recordId=fact(s,input.subjectId,input.predicate??'authored',input.value??input.text,eventId,[],{objectId:input.objectId,qualifiers:input.qualifiers,source:input.source??'Creator',truthStatus:['verified','asserted','disputed','false','superseded'].includes(input.truthStatus??'')?input.truthStatus as 'verified'|'asserted'|'disputed'|'false'|'superseded':'verified',audience:input.audience,confidence:input.confidence,observedAt:input.observedAt,learnedAt:input.learnedAt,validFrom:input.validFrom,validUntil:input.validUntil,eventIds:input.eventIds,evidenceIds:input.evidenceIds,tags:input.tags});
   if(input.layer==='knowledge'){ensure(input.factId,400,'fact_required');observe(s,input.subjectId,input.factId,input.source??'Creator',{confidence:input.confidence,observedAt:input.observedAt,expiresAt:input.validUntil,evidenceIds:input.evidenceIds});recordId=input.factId;}
   if(input.layer==='belief'){recordId=randomUUID();s.beliefs.push({id:recordId,observerId:input.subjectId,proposition:input.text,subjectId:input.propositionSubjectId??input.subjectId,predicate:input.predicate??'believes',objectId:input.objectId??null,value:input.value??input.text,qualifiers:input.qualifiers??{},confidence:input.confidence??0.5,source:input.source??'Creator',truthStatus:['believed','doubted','disproven','confirmed'].includes(input.truthStatus??'')?input.truthStatus as 'believed'|'doubted'|'disproven'|'confirmed':'believed',audience:input.audience??[input.subjectId],observedAt:input.observedAt??null,validFrom:input.validFrom??s.clock,validUntil:input.validUntil??null,eventIds:[...new Set([eventId,...(input.eventIds??[])])],evidenceIds:input.evidenceIds??[],tags:input.tags??[],at:s.clock,correctedBy:null});}
   if(input.layer==='memory'){remember(s,input.subjectId,input.text,eventId,input.salience??1,{interpretation:input.interpretation,privacy:input.privacy,recallConditions:input.recallConditions,decayPerDay:input.decayPerDay,expiresAt:input.expiresAt,eventRefs:input.eventIds,tags:input.tags});recordId=s.memories.at(-1)!.id;}
   if(input.layer==='gossip'){ensure(input.recordId&&input.targetId,400,'belief_and_target_required');recordId=gossip(s,input.subjectId,input.targetId,input.recordId,eventId,Math.max(0,Math.min(1,1-(input.confidence??0.8))));}
   if(input.layer==='correct-belief'){const belief=s.beliefs.find(b=>b.id===input.recordId&&b.observerId===input.subjectId);ensure(belief&&input.factId,400,'belief_and_correction_required');observe(s,input.subjectId,input.factId,'correction:'+eventId,{observedAt:s.clock,evidenceIds:input.evidenceIds});belief.correctedBy=input.factId;belief.truthStatus='disproven';belief.at=s.clock;recordId=belief.id;}
   if(input.layer==='retire-truth'){const old=s.facts.find(f=>f.id===input.factId&&f.subjectId===input.subjectId);ensure(old,400,'fact_required');old.retiredAt=s.clock;old.truthStatus='superseded';recordId=fact(s,input.subjectId,input.predicate??old.predicate,input.value??input.text,eventId,[],{objectId:input.objectId??old.objectId,qualifiers:input.qualifiers??old.qualifiers,source:input.source??'Creator correction',truthStatus:'verified',audience:input.audience??old.audience,confidence:input.confidence??old.confidence,observedAt:input.observedAt??s.clock,validFrom:input.validFrom??s.clock,validUntil:input.validUntil,eventIds:input.eventIds,evidenceIds:input.evidenceIds??old.evidenceIds,tags:input.tags??old.tags});}
   if(input.layer==='refresh-memory'){const memory=s.memories.find(m=>m.id===input.recordId&&m.observerId===input.subjectId);ensure(memory,400,'memory_required');memory.at=s.clock;memory.lastRefreshedAt=s.clock;memory.refreshCount=(memory.refreshCount??0)+1;memory.salience=input.salience??memory.salience;memory.decayPerDay=input.decayPerDay??memory.decayPerDay;if(input.expiresAt!==undefined)memory.expiresAt=input.expiresAt;if(input.interpretation!==undefined)memory.interpretation=input.interpretation;recordId=memory.id;}
   return {result:{recordId}};
  }));
 } async turn(actor:Actor,id:string,input:{revision:number;characterId:string;action:Action;text?:string;cursor?:string},key:string){
  keySchema.parse(key);const action=actionSchema.parse(input.action),body={...input,action},authorizationStarted=Date.now();
  // Authorization precedes trace creation so an unauthorized caller cannot write into another tenant's trace ledger.
  await this.authorizeCharacter(actor,id,input.characterId);
  const trace=await beginTurnTrace(this.store,{timelineId:id,actorId:actor.id,requestKey:key,bodyHash:checksum(body),originalText:input.text??'',expectedRevision:input.revision,expectedCursor:input.cursor});
  const recorder=new TurnTraceRecorder(trace.traceId);recorder.mark('input-preservation','succeeded',{originalTextPresent:input.text!==undefined,bytes:Buffer.byteLength(input.text??'')});recorder.mark('intent-confirmed','succeeded',{actionType:action.type,requiresServerValidation:true});recorder.mark('character-authorization','succeeded',{authorizedBeforeTraceWrite:true},undefined,Date.now()-authorizationStarted);
  try{
   const result=await recorder.run('atomic-commit',()=>this.mutate(actor,id,input.revision,key,body,'story.turn',false,(s,eventId,seed,role)=>{
    this.controlled(actor,s,input.characterId,role);
    const resolved=resolveAction(s,input.characterId,action,eventId,seed);
    const permitted=resolved.effects.filter(e=>e.observers.includes(input.characterId));
    const narration=permitted.map(e=>e.text).join('\n\n')||'The action resolved. No observer-visible change was recorded.';
    return {result:{narration,permitted,checks:resolved.checks??[],time:resolved.time},effects:resolved.effects,draws:resolved.draws,checks:resolved.checks,characterId:input.characterId,turnText:input.text??action.type};
   },{recorder,expectedCursor:input.cursor}),{rollbackOnFailure:true});
   const typed=result as {eventId:string};await persistTurnTrace(this.store,trace.traceId,recorder.steps,'committed',typed.eventId);return {...result,traceId:trace.traceId};
  }catch(error){await persistTurnTrace(this.store,trace.traceId,recorder.steps,'failed',undefined,failureReason(error)).catch(()=>{});throw error;}
 } async triggerWatcher(actor:Actor,id:string,revision:number,watcherId:string,key:string){
  return this.mutate(actor,id,revision,key,{revision,watcherId},'creator.watcher.trigger',true,s=>{
   const watcher=getEntity(s,watcherId,'watcher');
   ensure(!watcher.data.fired,409,'watcher_already_fired');
   watcher.data.fired=true;
   const subjectId=typeof watcher.data.subjectId==='string'?watcher.data.subjectId:null;
   const observers=subjectId&&s.entities.some(entity=>entity.id===subjectId&&entity.kind==='character')?[subjectId]:[];
   const effect:Effect={id:randomUUID(),text:String(watcher.data.description||watcher.name),observers,type:'watcher.triggered',subjectId:watcher.id};
   return {result:{watcherId:watcher.id},effects:[effect]};
  });
 }
 async authorizeCharacter(actor:Actor,id:string,characterId:string){const {access}=(await this.access(actor,id));this.controlled(actor,(await this.load(id)),characterId,access.role);}
 async parse(actor:Actor,id:string,characterId:string,text:string):Promise<IntentProposal>{
  const {access}=(await this.access(actor,id)),s=(await this.load(id));this.controlled(actor,s,characterId,access.role);
  return proposeIntent(s,characterId,text);
 }
 private async saveInternal(actor:Actor,id:string,name:string,s:State,revision:number,options:boolean|{automatic?:boolean;checkpoint?:'manual'|'safe-commit'|'before-death'|'branch-origin'|'import-origin'|'recovery';cursor?:string;eventId?:string|null;thumbnailMediaId?:string|null;mediaStrategy?:'inline'|'references'|'omit'}=false){
  const opts=typeof options==='boolean'?{automatic:options}:{...options},timeline=await this.store.get<Timeline>('SELECT * FROM timelines WHERE id=?',id);ensure(timeline,404,'timeline_unavailable');const currentCursor=await this.store.get<{cursor:string}>('SELECT cursor FROM timeline_turn_cursors WHERE timeline_id=?',id),event=opts.eventId===undefined?await this.store.get<{id:string}>('SELECT id FROM game_events WHERE timeline_id=? AND revision=?',id,revision):null,cursor=opts.cursor??currentCursor?.cursor;ensure(cursor,409,'turn_cursor_unavailable');if(opts.thumbnailMediaId)getEntity(s,opts.thumbnailMediaId,'media');
  const historicalRevision=revision<timeline.revision?revision:undefined,createdAt=now(),core={version:1 as const,state:s,worldHistory:await this.worldHistory(id,historicalRevision),transcript:(await this.transcript(id,historicalRevision))},contentChecksum=checksum(core),metadata={schemaVersion:1 as const,campaignId:timeline.campaign_id,timelineId:id,revision,clock:s.clock,eventCursor:cursor,eventId:opts.eventId===undefined?(event?.id??null):(opts.eventId??null),projectionVersion:1 as const,contentChecksum,createdAt},snapshot={...core,metadata},stored=await encodeSnapshot(this.store,snapshot),envelopeChecksum=checksum(snapshot),saveId=randomUUID(),automatic=opts.automatic??false,checkpoint=opts.checkpoint??(automatic?'safe-commit':'manual'),dependencies={canonRevisionId:s.canon?.revisionId??null,entityKinds:[...new Set(s.entities.map(entity=>entity.kind))].sort(),timelineScope:id};
  await this.store.run('INSERT INTO saves(id,timeline_id,name,revision,snapshot_json,checksum,created_by,created_at,automatic) VALUES (?,?,?,?,?,?,?,?,?)',saveId,id,name,revision,JSON.stringify(stored),envelopeChecksum,actor.id,createdAt,automatic?1:0);
  if(await this.recoverySchemaReady())await this.store.run('INSERT INTO save_manifests VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',saveId,timeline.campaign_id,id,1,1,s.clock,cursor,revision,metadata.eventId,contentChecksum,envelopeChecksum,JSON.stringify(dependencies),opts.mediaStrategy??'inline',opts.thumbnailMediaId??null,checkpoint,JSON.stringify({minimumVersion:1,currentVersion:1,projectionRebuild:'persist-validated-state',legacyReadable:true}),createdAt);return saveId;
 }
 async save(actor:Actor,id:string,input:string|{name:string;thumbnailMediaId?:string|null}){return this.store.transaction(async()=>{const {t,access}=await this.access(actor,id);ensure(access.role!=='observer',403,'forbidden');const parsed=typeof input==='string'?{name:input,thumbnailMediaId:null}:{name:z.string().trim().min(1).max(160).parse(input.name),thumbnailMediaId:input.thumbnailMediaId??null},state=await this.load(id),count=await this.store.get<{n:number}>('SELECT count(*) n FROM saves WHERE timeline_id=? AND automatic=0',id);ensure((count?.n??0)<(state.settings.campaign?.saveBehavior.maxManualSaves??100),409,'manual_save_limit');const saveId=await this.saveInternal(actor,id,parsed.name,state,t.revision,{checkpoint:'manual',thumbnailMediaId:parsed.thumbnailMediaId});await this.audit(actor,t.campaign_id,'save.created',saveId);return {id:saveId};});}
 async saves(actor:Actor,id:string){const {access}=await this.access(actor,id),developer=privileged(access.role)&&(await this.domain.userMode(actor)).mode==='developer';return (await this.store.all('SELECT s.id,s.name,s.revision,s.created_at,s.automatic,m.clock,m.event_cursor AS eventCursor,m.event_id AS eventId,m.checkpoint,m.thumbnail_media_id AS thumbnailMediaId,m.content_checksum AS contentChecksum FROM saves s LEFT JOIN save_manifests m ON m.save_id=s.id WHERE s.timeline_id=? AND (?=1 OR s.created_by=?) ORDER BY s.rowid DESC LIMIT 100',id,developer?1:0,actor.id));}
 async branch(actor:Actor,id:string,saveId:string,name:string){
  return (await this.store.transaction(async ()=>{
   const {t,access}=(await this.access(actor,id));ensure(access.role!=='observer',403,'forbidden');
   const save=(await this.store.get<{id:string}>('SELECT id FROM saves WHERE id=? AND timeline_id=? AND (?=1 OR created_by=?)',saveId,id,privileged(access.role)?1:0,actor.id));ensure(save,404,'save_unavailable');
   const parsed=await this.savedSnapshot(id,saveId),childId=randomUUID();
   (await this.store.run('INSERT INTO timelines(id,campaign_id,parent_id,parent_save_id,name,revision,clock,settings_json,created_at) VALUES (?,?,?,?,?,?,?,?,?)',childId,t.campaign_id,id,saveId,name,1,parsed.state.clock,JSON.stringify(parsed.state.settings),now()));
   await this.pinCanon(childId,parsed.state.canon===undefined?await this.canon(id):parsed.state.canon);
   await this.store.run('INSERT INTO timeline_world_history VALUES (?,?)',childId,JSON.stringify(parsed.worldHistory));
   (await this.persist(childId,parsed.state));(await this.restoreTranscript(childId,parsed.transcript));const childCursor=await this.store.get<{cursor:string}>('SELECT cursor FROM timeline_turn_cursors WHERE timeline_id=?',childId);ensure(childCursor,409,'turn_cursor_unavailable');
   const branchSaveId=await this.saveInternal(actor,childId,'Branch origin',parsed.state,1,{automatic:true,checkpoint:'branch-origin',cursor:childCursor.cursor,eventId:null});
   if(await this.recoverySchemaReady())await this.store.run('INSERT INTO timeline_commit_history(timeline_id,revision,cursor,event_id,save_id,state_checksum,committed_at) VALUES (?,?,?,?,?,?,?)',childId,1,childCursor.cursor,null,branchSaveId,checksum(parsed.state),now());
   (await this.audit(actor,t.campaign_id,'timeline.branched',childId,{before:{parentTimelineId:id,saveId,sourceCursor:parsed.metadata?.eventCursor??null,sourceRevision:parsed.metadata?.revision??null},after:{timelineId:childId,name}}));return {id:childId,parentTimelineId:id,parentSaveId:saveId};
  }));
 }
 async branchFromHere(actor:Actor,id:string,input:{name:string;saveId?:string;cursor?:string;eventId?:string}){
  const selector=z.strictObject({name:z.string().trim().min(1).max(160),saveId:z.uuid().optional(),cursor:z.string().min(16).max(128).optional(),eventId:z.uuid().optional()}).refine(value=>[value.saveId,value.cursor,value.eventId].filter(Boolean).length===1,'one_branch_origin_required').parse(input);
  if(selector.saveId)return this.branch(actor,id,selector.saveId,selector.name);
  await this.access(actor,id,true);const history=selector.cursor
   ?await this.store.get<{save_id:string|null}>('SELECT save_id FROM timeline_commit_history WHERE timeline_id=? AND cursor=?',id,selector.cursor)
   :await this.store.get<{save_id:string|null}>('SELECT save_id FROM timeline_commit_history WHERE timeline_id=? AND event_id=?',id,selector.eventId!);
  ensure(history,404,'committed_origin_unavailable');ensure(history.save_id,409,'checkpoint_unavailable_for_commit');return this.branch(actor,id,history.save_id,selector.name);
 }
 async duplicateCampaign(actor:Actor,id:string,name:string){
  return this.store.transaction(async()=>{const {t,access}=await this.access(actor,id,true);ensure(privileged(access.role),403,'forbidden');const source=await this.store.get<{source_world_id:string;timezone:string}>('SELECT source_world_id,timezone FROM campaigns WHERE id=?',t.campaign_id);ensure(source,404,'campaign_unavailable');const state=await this.load(id),createdAt=now(),campaignId=randomUUID(),timelineId=randomUUID();
   await this.store.run('INSERT INTO campaigns(id,owner_id,source_world_id,name,starting_at,timezone,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)',campaignId,actor.id,source.source_world_id,z.string().trim().min(1).max(160).parse(name),state.clock,source.timezone,createdAt,createdAt);
   await this.store.run('INSERT INTO campaign_configurations(campaign_id,schema_version,defaults_json,overrides_json,revision,created_at,updated_at,updated_by) SELECT ?,schema_version,defaults_json,overrides_json,revision,?,?,? FROM campaign_configurations WHERE campaign_id=?',campaignId,createdAt,createdAt,actor.id,t.campaign_id);
   await this.store.run('INSERT INTO campaign_theme_settings(campaign_id,recommended_theme_id,allowed_themes_json,revision,created_at,updated_at,updated_by) SELECT ?,recommended_theme_id,allowed_themes_json,revision,?,?,? FROM campaign_theme_settings WHERE campaign_id=?',campaignId,createdAt,createdAt,actor.id,t.campaign_id);
   const canon=await this.store.get<{canon_revision_id:string|null}>('SELECT canon_revision_id FROM campaign_canon_bindings WHERE campaign_id=?',t.campaign_id);await this.store.run('INSERT INTO campaign_canon_bindings VALUES (?,?,?,?)',campaignId,canon?.canon_revision_id??null,createdAt,actor.id);
   const members=await this.store.all<{user_id:string;role:string}>('SELECT user_id,role FROM memberships WHERE campaign_id=?',t.campaign_id);for(const member of members)await this.store.run('INSERT INTO memberships(campaign_id,user_id,role,created_at,updated_at) VALUES (?,?,?,?,?)',campaignId,member.user_id,member.user_id===actor.id?'creator':member.role,createdAt,createdAt);
   if(!members.some(member=>member.user_id===actor.id))await this.store.run('INSERT INTO memberships(campaign_id,user_id,role,created_at,updated_at) VALUES (?,?,?,?,?)',campaignId,actor.id,'creator',createdAt,createdAt);
   await this.store.run('INSERT INTO timelines(id,campaign_id,name,revision,clock,settings_json,created_at) VALUES (?,?,?,?,?,?,?)',timelineId,campaignId,t.name+' copy',1,state.clock,JSON.stringify(state.settings),createdAt);await this.pinCanon(timelineId,state.canon??null);await this.store.run('INSERT INTO timeline_world_history VALUES (?,?)',timelineId,JSON.stringify(await this.worldHistory(id)));await this.persist(timelineId,state);await this.restoreTranscript(timelineId,(await this.transcript(id)));
   const cursor=await this.store.get<{cursor:string}>('SELECT cursor FROM timeline_turn_cursors WHERE timeline_id=?',timelineId);ensure(cursor,409,'turn_cursor_unavailable');const saveId=await this.saveInternal(actor,timelineId,'Duplicate origin',state,1,{automatic:true,checkpoint:'recovery',cursor:cursor.cursor,eventId:null});await this.store.run('INSERT INTO timeline_commit_history(timeline_id,revision,cursor,event_id,save_id,state_checksum,committed_at) VALUES (?,?,?,?,?,?,?)',timelineId,1,cursor.cursor,null,saveId,checksum(state),createdAt);
   await this.store.run('INSERT INTO campaign_duplicate_lineage VALUES (?,?,?,?,?,?)',campaignId,t.campaign_id,id,timelineId,actor.id,createdAt);await this.audit(actor,t.campaign_id,'campaign.duplicated',campaignId,{before:{campaignId:t.campaign_id,timelineId:id},after:{campaignId,timelineId,name}});return {campaignId,timelineId,sourceCampaignId:t.campaign_id,sourceTimelineId:id};
  });
 }
 async export(actor:Actor,id:string,options:{mediaStrategy?:'inline'|'references'}={}){
  const {t}=await this.access(actor,id,true),payload={version:1 as const,worldHistory:await this.worldHistory(id),state:(await this.load(id)),transcript:(await this.transcript(id))},cursor=await this.store.get<{cursor:string}>('SELECT cursor FROM timeline_turn_cursors WHERE timeline_id=?',id),latest=await this.store.get<{id:string;created_at:string}>('SELECT id,created_at FROM game_events WHERE timeline_id=? ORDER BY revision DESC LIMIT 1',id);ensure(cursor,409,'turn_cursor_unavailable');
  const media=payload.state.entities.filter(entity=>entity.kind==='media').map(entity=>({id:entity.id,checksum:checksum(entity.data.body),visibility:entity.visibility})),payloadChecksum=checksum(payload),manifest={format:'valor-timeline-export' as const,formatVersion:2 as const,schemaVersion:44,projectionVersion:1 as const,exportedAt:latest?.created_at??payload.state.clock,campaignId:t.campaign_id,timeline:{id,name:t.name,revision:t.revision,clock:payload.state.clock,eventCursor:cursor.cursor,eventId:latest?.id??null},payloadChecksum,dependencies:{canonRevisionId:payload.state.canon?.revisionId??null,entityKinds:[...new Set(payload.state.entities.map(entity=>entity.kind))].sort(),media},mediaStrategy:options.mediaStrategy??'inline',visibility:'preserved' as const,migration:{sourceSnapshotVersion:1,targetSnapshotVersion:1,steps:[] as string[]}},envelope={manifest,payload};
  const result={...envelope,checksum:checksum(envelope)};ensureJsonBytes(result,this.exportBytes,'export_too_large');return result;
 }
 private async inspectImport(actor:Actor,id:string,raw:unknown){
  await this.access(actor,id,true);ensureJsonBytes(raw,this.importBytes,'import_too_large');const envelope=z.strictObject({manifest:z.unknown().optional(),payload:z.unknown(),checksum:z.string().length(64)}).parse(raw),payloadChecksum=checksum(envelope.payload),manifest=envelope.manifest===undefined?null:z.strictObject({format:z.literal('valor-timeline-export'),formatVersion:z.literal(2),schemaVersion:z.number().int().positive(),projectionVersion:z.literal(1),exportedAt:z.iso.datetime(),campaignId:z.uuid(),timeline:z.strictObject({id:z.uuid(),name:z.string(),revision:z.number().int().positive(),clock:z.iso.datetime(),eventCursor:z.string().min(16).max(128),eventId:z.uuid().nullable()}),payloadChecksum:z.string().length(64),dependencies:z.strictObject({canonRevisionId:z.uuid().nullable(),entityKinds:z.array(z.string()),media:z.array(z.strictObject({id:z.uuid(),checksum:z.string().length(64),visibility:z.string()}))}),mediaStrategy:z.enum(['inline','references']),visibility:z.literal('preserved'),migration:z.strictObject({sourceSnapshotVersion:z.number().int().positive(),targetSnapshotVersion:z.number().int().positive(),steps:z.array(z.string())})}).parse(envelope.manifest);
  const modernValid=manifest?checksum({manifest,payload:envelope.payload})===envelope.checksum:false,legacyValid=!manifest&&payloadChecksum===envelope.checksum;ensure(manifest?modernValid:legacyValid,400,'import_checksum_mismatch');if(manifest)ensure(manifest.payloadChecksum===payloadChecksum,400,'import_payload_checksum_mismatch');
  const parsed=verifySnapshotMetadata(snapshotSchema.parse(envelope.payload)),state=parsed.state;state.entities=state.entities.map(validateEntity);validateState(state);
  const turnIds=new Set<string>();
  for(const turn of parsed.transcript){ensure(!turnIds.has(turn.id),400,'duplicate_transcript_id');turnIds.add(turn.id);ensure(state.entities.some(e=>e.id===turn.character_id&&e.kind==='character'&&e.data.playable),400,'invalid_transcript_character');}
  const target=await this.load(id),targetIds=new Set(target.entities.map(entity=>entity.id)),collisions=state.entities.filter(entity=>targetIds.has(entity.id)).map(entity=>entity.id);
  for(const e of state.entities.filter(e=>e.kind==='character'))e.data.controllerUserId=e.data.playable?actor.id:null;
  const migrations=[...(manifest?.migration.steps??[])];if(!manifest)migrations.push('legacy-export-envelope');if(!parsed.metadata)migrations.push('legacy-snapshot-metadata-defaults');
  return {state,parsed,bundleChecksum:checksum(raw),report:{valid:true,formatVersion:manifest?.formatVersion??1,snapshotVersion:parsed.version,sourceSchemaVersion:manifest?.schemaVersion??null,targetSchemaVersion:44,projectionVersion:manifest?.projectionVersion??1,entities:state.entities.length,transcriptTurns:parsed.transcript.length,idCollisions:collisions,conflictPolicy:'isolated-child-timeline',overwritesLiveCampaign:false,visibility:manifest?.visibility??'preserved',mediaStrategy:manifest?.mediaStrategy??'inline',migrations,changes:['create-child-timeline','rebuild-state-projection','restore-world-history','restore-transcript']}};
 }
 async validateImport(actor:Actor,id:string,raw:unknown){return (await this.inspectImport(actor,id,raw)).state;}
 async import(actor:Actor,id:string,name:string,raw:unknown,dryRun=true,confirmationToken?:string){
  const inspection=await this.inspectImport(actor,id,raw);if(dryRun){const token=randomUUID(),createdAt=now(),expiresAt=new Date(Date.now()+60*60*1000).toISOString();await this.store.run('INSERT INTO import_previews(token,target_timeline_id,actor_id,bundle_checksum,report_json,created_at,expires_at) VALUES (?,?,?,?,?,?,?)',token,id,actor.id,inspection.bundleChecksum,JSON.stringify(inspection.report),createdAt,expiresAt);return {...inspection.report,confirmationRequired:true,confirmationToken:token,expiresAt};}
  ensure(confirmationToken,409,'import_confirmation_required');return (await this.store.transaction(async ()=>{const {t}=(await this.access(actor,id,true)),preview=await this.store.get<{bundle_checksum:string;expires_at:string;used_at:string|null}>('SELECT bundle_checksum,expires_at,used_at FROM import_previews WHERE token=? AND target_timeline_id=? AND actor_id=?',confirmationToken,id,actor.id);ensure(preview,409,'import_confirmation_unavailable');ensure(!preview.used_at,409,'import_confirmation_used');ensure(preview.expires_at>now(),409,'import_confirmation_expired');ensure(preview.bundle_checksum===inspection.bundleChecksum,409,'import_confirmation_changed');
   const state=inspection.state,child=randomUUID();(await this.store.run('INSERT INTO timelines(id,campaign_id,parent_id,name,clock,settings_json,created_at) VALUES (?,?,?,?,?,?,?)',child,t.campaign_id,id,name,state.clock,JSON.stringify(state.settings),now()));await this.pinCanon(child,state.canon??null);(await this.persist(child,state));
   await this.store.run('INSERT INTO timeline_world_history VALUES (?,?)',child,JSON.stringify(inspection.parsed.worldHistory));
   (await this.restoreTranscript(child,inspection.parsed.transcript.map(turn=>({...turn,user_id:actor.id}))));const childCursor=await this.store.get<{cursor:string}>('SELECT cursor FROM timeline_turn_cursors WHERE timeline_id=?',child);ensure(childCursor,409,'turn_cursor_unavailable');
   const originSaveId=await this.saveInternal(actor,child,'Import origin',state,1,{automatic:true,checkpoint:'import-origin',cursor:childCursor.cursor,eventId:null,mediaStrategy:inspection.report.mediaStrategy});await this.store.run('INSERT INTO timeline_commit_history(timeline_id,revision,cursor,event_id,save_id,state_checksum,committed_at) VALUES (?,?,?,?,?,?,?)',child,1,childCursor.cursor,null,originSaveId,checksum(state),now());
   if(confirmationToken)await this.store.run('UPDATE import_previews SET used_at=? WHERE token=?',now(),confirmationToken);
   (await this.audit(actor,t.campaign_id,'timeline.imported',child,{before:{parentTimelineId:id,confirmationToken},after:{timelineId:child,name,entities:state.entities.length,clock:state.clock,report:inspection.report}}));return {id:child,report:{...inspection.report,confirmationMode:'preview-token'}};}));
 }
 async history(actor:Actor,id:string){(await this.access(actor,id,true));return (await this.store.all('SELECT * FROM game_events WHERE timeline_id=? ORDER BY rowid DESC LIMIT 100',id));}
 async context(actor:Actor,id:string,characterId:string,query:string){
  const {access}=await this.access(actor,id),s=await this.load(id);this.controlled(actor,s,characterId,access.role);
  const recent=(await this.store.all<{id:string;input_text:string;narration:string}>('SELECT id,input_text,narration FROM story_turns WHERE timeline_id=? AND character_id=? ORDER BY rowid DESC LIMIT 8',id,characterId)).reverse().map(turn=>({id:turn.id,input:turn.input_text,narration:turn.narration}));
  const events=(await this.store.all<{effects_json:string}>('SELECT effects_json FROM game_events WHERE timeline_id=? ORDER BY revision DESC LIMIT 8',id)).flatMap(row=>(JSON.parse(row.effects_json) as Effect[]).filter(effect=>effect.observers.includes(characterId)));
  return {...retrieve(s,characterId,query),brief:contextBrief(s,characterId,query,s.settings.contextTokens,{currentEvents:events,recentConversation:recent}),manifest:buildContextManifest(s,characterId,query,{maxTokens:s.settings.contextTokens,currentEvents:events,recentConversation:recent})};
 }
 async developerContextManifest(actor:Actor,id:string,characterId:string,query:string){
  await this.access(actor,id,true);const s=await this.load(id);getEntity(s,characterId,'character');
  const recent=(await this.store.all<{id:string;input_text:string;narration:string}>('SELECT id,input_text,narration FROM story_turns WHERE timeline_id=? AND character_id=? ORDER BY rowid DESC LIMIT 8',id,characterId)).reverse().map(turn=>({id:turn.id,input:turn.input_text,narration:turn.narration}));
  const events=(await this.store.all<{effects_json:string}>('SELECT effects_json FROM game_events WHERE timeline_id=? ORDER BY revision DESC LIMIT 8',id)).flatMap(row=>(JSON.parse(row.effects_json) as Effect[]).filter(effect=>effect.observers.includes(characterId)));
  return buildContextManifest(s,characterId,query,{maxTokens:s.settings.contextTokens,currentEvents:events,recentConversation:recent,developer:true});
 } async semanticRetrieval(actor:Actor,id:string,characterId:string,query:string,filters:RetrievalFilters={},developer=false){
  const {access}=await this.access(actor,id,developer),s=await this.load(id);if(developer)getEntity(s,characterId,'character');else this.controlled(actor,s,characterId,access.role);
  return retrieve(s,characterId,query,50,[],filters,developer);
 }
 async template(actor:Actor,id:string,name:string){
  const {t}=(await this.access(actor,id,true)),campaign=(await this.store.get<{source_world_id:string}>('SELECT source_world_id FROM campaigns WHERE id=?',t.campaign_id))!;
  (await this.domain.access(actor,{type:'world',id:campaign.source_world_id},true));const bundle=(await this.export(actor,id)),templateId=randomUUID();
  (await this.store.transaction(async ()=>{(await this.store.run('INSERT INTO creator_templates(id,world_id,name,bundle_json,created_by,created_at) VALUES (?,?,?,?,?,?)',templateId,campaign.source_world_id,name,JSON.stringify(bundle),actor.id,now()));(await this.audit(actor,t.campaign_id,'template.created',templateId,{after:{templateId,name,worldId:campaign.source_world_id}}));}));return {id:templateId};
 }
 async installCatalog(actor:Actor,id:string,revision:number,key:string){
  return (await this.mutate(actor,id,revision,key,{revision,type:'catalog.install'},'creator.catalog',true,s=>{
   let count=0;
   const addSkill=(name:string)=>{
    const kind='skill' as const,category='skill';
    if(s.entities.some(e=>e.kind===kind&&e.name===name))return;
    s.entities.push(validateEntity({id:randomUUID(),kind,name,visibility:'campaign',data:{category,mode:'descriptive',description:stockSkill(name)?.description??'Creator-editable '+category+' descriptor. Mechanical effects and prerequisites must be authored.'}}));count++;
   };
   for(const name of skillNames)addSkill(name);
   const traitIds=new Map<string,string>();
   for(const name of Object.values(traitGroups).flat()){const existing=s.entities.find(entity=>entity.kind==='trait'&&entity.name===name);traitIds.set(name,existing?.id??randomUUID());}
   for(const[category,names]of Object.entries(traitGroups))for(const name of names){
    if(s.entities.some(entity=>entity.kind==='trait'&&entity.name===name))continue;
    const social=/appearance|Affluent|Poor|Working class|Connected|Respected|Feared|Notorious|Affiliated|reputation/i.test(name);
    s.entities.push(validateEntity({id:traitIds.get(name)!,kind:'trait',name,visibility:'campaign',data:{category,mode:'descriptive',
     description:social?'An authored social-presentation descriptor. Its meaning depends on observer and context; it is not an objective moral or attraction score.':'A Creator-editable characterization descriptor. It grants no broad capability unless a scoped effect is explicitly authored.',
     opposes:(traitOppositions[name]??[]).map(opposition=>traitIds.get(opposition)!),
     generation:{weight:1,tags:traitGenerationTags[name]??[],requiresBackgroundTags:traitBackgroundRequirements[name]??[]}
    }}));count++;
   }
   // Upgrade only untouched stock descriptors; keep custom mechanics and all stable IDs.
   let upgraded=0;
   for(const entity of s.entities.filter(e=>e.kind==='trait'&&!e.archived)){
    const old=data(entity,'trait'),stock=stockTrait(entity.name);
    if(!stock||old.mode!=='descriptive'||Object.keys(old.modifiers).length||old.effects.length||old.scopedCheckModifiers.length||old.combinations.length||!['A Creator-editable characterization descriptor.','An authored social-presentation descriptor.'].some(prefix=>old.description.startsWith(prefix)))continue;
    const skill=stock.skill?s.entities.find(e=>e.kind==='skill'&&e.name===stock.skill&&!e.archived):null;
    if(stock.skill&&!skill)continue;
    const replacement=validateEntity({...entity,revision:entity.revision+1,data:{...old,mode:'costed',balance:stock.cost>0?'advantage':'disadvantage',cost:stock.cost,description:stock.description,modifiers:stock.modifiers,scopedCheckModifiers:skill?[{name:entity.name,value:stock.bonus,skillId:skill.id,contexts:[]}]:[],skillGrants:Object.entries(stock.grants).flatMap(([name,fraction])=>{const skill=s.entities.find(e=>e.kind==='skill'&&e.name===name&&!e.archived);return skill?[{skillId:skill.id,fraction}]:[];}) }});
    s.entities[s.entities.indexOf(entity)]=replacement;upgraded++;
   }
   // Existing lives retain their legal selections; new lives also have the independent starting budget.
   if(upgraded){const existingPlayers=s.entities.filter(e=>e.kind==='character'&&e.data.playable).map(e=>data(e,'character').traits.map(id=>data(getEntity(s,id,'trait'),'trait')));s.settings.traitBalance.maxAdvantages=Math.max(s.settings.traitBalance.maxAdvantages,...existingPlayers.map(traits=>traits.filter(t=>t.mode==='costed'&&t.cost>0).length));s.settings.traitBalance.maxDisadvantages=Math.max(s.settings.traitBalance.maxDisadvantages,...existingPlayers.map(traits=>traits.filter(t=>t.mode==='costed'&&t.cost<0).length));s.settings.traitBalance.refundPolicy='capped-current';s.settings.traitBalance.disadvantageCreditCap=Math.max(6,s.settings.traitBalance.disadvantageCreditCap);s.settings.traitBudget=Math.max(6,s.settings.traitBudget,...s.entities.filter(e=>e.kind==='character'&&e.data.playable).map(e=>Math.max(0,startingBudget(e.data,s.entities,s.settings.attributeScale).traits)));}
   const addTemplate=(name:string,data:Record<string,unknown>)=>{if(s.entities.some(entity=>entity.kind==='traitTemplate'&&entity.name===name))return;s.entities.push(validateEntity({id:randomUUID(),kind:'traitTemplate',name,visibility:'creator',data}));count++;};
   const tagCaps={stature:1,build:1,strength:1,coordination:1,'trust-style':1,'empathy-style':1,'truth-style':1,'social-class':1};
   addTemplate('Grounded civilian traits',{description:'Weighted, contradiction-checked NPC characterization without specialized police, military, firearms, or criminal background.',backgroundTags:[],categoryWeights:{physical:2,personality:3,experience:1,social:2},minTraits:4,maxTraits:7,budget:0,categoryCaps:{physical:3,personality:3,experience:1,social:2},tagCaps});
   addTemplate('Police-background traits',{description:'Weighted NPC characterization for an explicitly authored police background.',backgroundTags:['police','firearms'],categoryWeights:{physical:2,personality:3,experience:2,social:2},requiredTraitIds:[traitIds.get('Police training')!],minTraits:5,maxTraits:8,budget:0,categoryCaps:{physical:3,personality:3,experience:2,social:2},tagCaps});
   return {result:{created:count,upgraded}};
  }));
 }
 async generateNpcTraits(actor:Actor,id:string,input:{revision:number;characterId:string;templateId:string;seed:string},key:string){
  return this.mutate(actor,id,input.revision,key,input,'creator.traits.generate',true,async s=>{
   const character=getEntity(s,input.characterId,'character');ensure(!character.data.playable,400,'npc_required');
   const generated=generateNpcTraitSelection(s,input.templateId,input.seed),candidate=structuredClone(character),definition=data(candidate,'character');
   definition.traits=generated.traitIds;candidate.data=definition as Entity['data'];await this.applyEntity(id,s,candidate);
   return {result:{characterId:character.id,templateId:input.templateId,seed:input.seed,traitIds:generated.traitIds,balance:generated.balance}};
  });
 }
 async transcript(id:string,throughRevision?:number){
  return [...(await this.store.all<z.infer<typeof transcriptSchema>>('SELECT id,character_id,user_id,input_text,narration,narration_status,created_at,source_event_id,notices_json,scene_json FROM archived_chronicle WHERE timeline_id=? ORDER BY rowid',id)),
   ...(await this.store.all<z.infer<typeof transcriptSchema>>('SELECT s.id,s.character_id,s.user_id,s.input_text,s.narration,s.narration_status,s.created_at,s.id AS source_event_id,s.notices_json,s.scene_json FROM story_turns s JOIN game_events e ON e.id=s.id WHERE s.timeline_id=? AND (? IS NULL OR e.revision<=?) ORDER BY s.rowid',id,throughRevision??null,throughRevision??null))];
 }
 private async restoreTranscript(id:string,turns:z.infer<typeof transcriptSchema>[]){
  for(const turn of turns)(await this.store.run('INSERT INTO archived_chronicle (timeline_id,id,character_id,user_id,input_text,narration,narration_status,created_at,source_event_id,notices_json,scene_json) VALUES (?,?,?,?,?,?,?,?,?,?,?)',id,turn.id,turn.character_id,turn.user_id,turn.input_text,turn.narration,turn.narration_status,turn.created_at,turn.source_event_id,turn.notices_json,turn.scene_json));
 }
 async templates(actor:Actor,id:string){
  const {t}=(await this.access(actor,id,true)),campaign=(await this.store.get<{source_world_id:string}>('SELECT source_world_id FROM campaigns WHERE id=?',t.campaign_id))!;
  (await this.domain.access(actor,{type:'world',id:campaign.source_world_id}));
  return (await this.store.all('SELECT id,name,revision FROM creator_templates WHERE world_id=? AND archived_at IS NULL',campaign.source_world_id));
 }
 async instantiateTemplate(actor:Actor,id:string,templateId:string,name:string){
  const available=(await this.templates(actor,id)) as {id:string}[];
  ensure(available.some(t=>t.id===templateId),404,'template_unavailable');
  const template=(await this.store.get<{bundle_json:string}>('SELECT bundle_json FROM creator_templates WHERE id=?',templateId))!;
  const bundle=JSON.parse(template.bundle_json),preview=await this.import(actor,id,name,bundle,true) as {confirmationToken:string};return (await this.import(actor,id,name,bundle,false,preview.confirmationToken));
 }
}
