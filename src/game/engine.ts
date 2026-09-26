import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {z} from 'zod';
import {Store} from '../db.ts';
import {Domain} from '../domain.ts';
import {ensure} from '../contracts.ts';
import type {Actor} from '../contracts.ts';
import {actionSchema,data,entitySchema,getEntity,refs,settingsSchema,validateEntity,validateState} from './model.ts';
import type {Action,Entity,State} from './model.ts';
import {observerView,retrieve,observe,fact} from './epistemics.ts';
import {resolveAction} from './actions.ts';
import type {Effect} from './simulation.ts';
import {skillNames,traitGroups} from './catalog.ts';
type Timeline={id:string;campaign_id:string;parent_id:string|null;parent_save_id:string|null;name:string;revision:number;clock:string;settings_json:string};
const now=()=>new Date().toISOString();
const canonical=(v:unknown):string=>Array.isArray(v)?'['+v.map(canonical).join(',')+']':v&&typeof v==='object'?'{'+Object.entries(v).sort(([a],[b])=>a.localeCompare(b)).map(([k,x])=>JSON.stringify(k)+':'+canonical(x)).join(',')+'}':JSON.stringify(v);
export const checksum=(v:unknown)=>createHash('sha256').update(canonical(v)).digest('hex');
const privileged=(role:string)=>['creator','admin'].includes(role);
const keySchema=z.string().regex(/^[A-Za-z0-9_-]{16,128}$/);
const transcriptSchema=z.strictObject({id:z.uuid(),character_id:z.uuid(),user_id:z.uuid(),input_text:z.string().max(1000),narration:z.string().max(200000),narration_status:z.string().max(100),created_at:z.iso.datetime(),source_event_id:z.uuid()});
const snapshotSchema=z.strictObject({version:z.literal(1),transcript:z.array(transcriptSchema).default([]),state:z.strictObject({clock:z.iso.datetime(),settings:settingsSchema,entities:z.array(entitySchema).max(20000),
 facts:z.array(z.strictObject({id:z.uuid(),subjectId:z.uuid(),predicate:z.string().max(160),value:z.json(),eventId:z.uuid(),at:z.iso.datetime(),retiredAt:z.iso.datetime().nullable()})),
 knowledge:z.array(z.strictObject({observerId:z.uuid(),factId:z.uuid(),source:z.string(),at:z.iso.datetime()})),
 beliefs:z.array(z.strictObject({id:z.uuid(),observerId:z.uuid(),proposition:z.string().max(16000),confidence:z.number().min(0).max(1),source:z.string(),at:z.iso.datetime(),correctedBy:z.uuid().nullable()})),
 memories:z.array(z.strictObject({id:z.uuid(),observerId:z.uuid(),text:z.string().max(16000),salience:z.number().min(0).max(1),decayPerDay:z.number().min(0).max(1),eventId:z.uuid(),at:z.iso.datetime(),private:z.boolean()}))
})});
export class Game {
 store:Store;domain:Domain;
 constructor(store:Store){this.store=store;this.domain=new Domain(store);}
 access(actor:Actor,id:string,write=false){
  const t=this.store.get<Timeline>('SELECT * FROM timelines WHERE id=? AND archived_at IS NULL',id);ensure(t,404,'timeline_unavailable');
  const access=this.domain.access(actor,{type:'campaign',id:t.campaign_id},write);return {t,access};
 }
 list(actor:Actor,campaignId:string){this.domain.access(actor,{type:'campaign',id:campaignId});return this.store.all('SELECT id,name,parent_id,parent_save_id,revision,clock FROM timelines WHERE campaign_id=? AND archived_at IS NULL ORDER BY created_at,id',campaignId);}
 initialize(actor:Actor,campaignId:string){
  return this.store.transaction(()=>{
   this.domain.access(actor,{type:'campaign',id:campaignId},true);
   const existing=this.store.get<{id:string}>('SELECT id FROM timelines WHERE campaign_id=? AND parent_id IS NULL ORDER BY created_at LIMIT 1',campaignId);if(existing)return existing;
   const campaign=this.store.get<{starting_at:string;timezone:string}>('SELECT starting_at,timezone FROM campaigns WHERE id=?',campaignId)!;
   const id=randomUUID(),settings=settingsSchema.parse({timezone:campaign.timezone});
   this.store.run('INSERT INTO timelines(id,campaign_id,name,clock,settings_json,created_at) VALUES (?,?,?,?,?,?)',id,campaignId,'Original timeline',campaign.starting_at,JSON.stringify(settings),now());
   this.audit(actor,campaignId,'timeline.created',id);return {id};
  });
 }
 load(id:string):State{
  const t=this.store.get<Timeline>('SELECT * FROM timelines WHERE id=?',id)!;
  const entities=this.store.all<{id:string;kind:Entity['kind'];name:string;visibility:Entity['visibility'];data_json:string;revision:number;archived_at:string|null}>('SELECT * FROM game_entities WHERE timeline_id=? ORDER BY id',id).map(e=>({id:e.id,kind:e.kind,name:e.name,visibility:e.visibility,data:JSON.parse(e.data_json),revision:e.revision,archived:!!e.archived_at}));
  const facts=this.store.all<Record<string,unknown>>('SELECT * FROM world_facts WHERE timeline_id=? ORDER BY id',id).map(r=>({id:r.id as string,subjectId:r.subject_id as string,predicate:r.predicate as string,value:JSON.parse(r.value_json as string),eventId:r.source_event_id as string,at:r.created_at as string,retiredAt:r.retired_at as string|null}));
  const knowledge=this.store.all<Record<string,string>>('SELECT * FROM character_knowledge WHERE timeline_id=?',id).map(r=>({observerId:r.observer_id!,factId:r.fact_id!,source:r.source!,at:r.learned_at!}));
  const beliefs=this.store.all<Record<string,unknown>>('SELECT * FROM character_beliefs WHERE timeline_id=?',id).map(r=>({id:r.id as string,observerId:r.observer_id as string,proposition:r.proposition as string,confidence:r.confidence as number,source:r.source as string,at:r.updated_at as string,correctedBy:r.corrected_by as string|null}));
  const memories=this.store.all<Record<string,unknown>>('SELECT * FROM character_memories WHERE timeline_id=?',id).map(r=>({id:r.id as string,observerId:r.observer_id as string,text:r.text as string,salience:r.salience as number,decayPerDay:r.decay_per_day as number,eventId:r.source_event_id as string,at:r.created_at as string,private:!!r.private}));
  return {clock:t.clock,settings:settingsSchema.parse(JSON.parse(t.settings_json)),entities,facts,knowledge,beliefs,memories};
 }
 persist(id:string,s:State){
  validateState(s);const timestamp=now();
  this.store.run('DELETE FROM entity_links WHERE timeline_id=?',id);
  for(const e of s.entities){
   const previous=this.store.get<{revision:number;name:string;visibility:string;data_json:string;archived_at:string|null}>('SELECT revision,name,visibility,data_json,archived_at FROM game_entities WHERE timeline_id=? AND id=?',id,e.id);
   const json=JSON.stringify(e.data),changed=!previous||previous.name!==e.name||previous.visibility!==e.visibility||previous.data_json!==json||!!previous.archived_at!==e.archived;
   e.revision=previous?previous.revision+(changed?1:0):e.revision;
   if(changed)this.store.run('INSERT INTO game_entities VALUES (?,?,?,?,?,?,?,NULL,?,?,?) ON CONFLICT(timeline_id,id) DO UPDATE SET name=excluded.name,visibility=excluded.visibility,data_json=excluded.data_json,revision=excluded.revision,updated_at=excluded.updated_at,archived_at=excluded.archived_at',
    id,e.id,e.kind,e.name,e.visibility,json,e.revision,timestamp,timestamp,e.archived?timestamp:null);
  }
  for(const e of s.entities)for(const ref of refs(e))this.store.run('INSERT INTO entity_links VALUES (?,?,?)',id,e.id,ref);
  for(const f of s.facts)this.store.run('INSERT INTO world_facts VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(timeline_id,id) DO UPDATE SET retired_at=excluded.retired_at',id,f.id,f.subjectId,f.predicate,JSON.stringify(f.value),f.eventId,f.at,f.retiredAt);
  for(const k of s.knowledge)this.store.run('INSERT INTO character_knowledge VALUES (?,?,?,?,?) ON CONFLICT DO NOTHING',id,k.observerId,k.factId,k.source,k.at);
  for(const b of s.beliefs)this.store.run('INSERT INTO character_beliefs VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(timeline_id,id) DO UPDATE SET proposition=excluded.proposition,confidence=excluded.confidence,source=excluded.source,updated_at=excluded.updated_at,corrected_by=excluded.corrected_by',id,b.id,b.observerId,b.proposition,b.confidence,b.source,b.at,b.correctedBy);
  for(const m of s.memories)this.store.run('INSERT INTO character_memories VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(timeline_id,id) DO UPDATE SET salience=excluded.salience,decay_per_day=excluded.decay_per_day,created_at=excluded.created_at',id,m.id,m.observerId,m.text,m.salience,m.decayPerDay,m.eventId,m.at,m.private?1:0);
  this.store.run('UPDATE timelines SET clock=?,settings_json=? WHERE id=?',s.clock,JSON.stringify(s.settings),id);
 }
 private audit(actor:Actor,campaignId:string,action:string,targetId:string){this.store.run('INSERT INTO audit_log(id,actor_id,campaign_id,action,target_id,created_at) VALUES (?,?,?,?,?,?)',randomUUID(),actor.id,campaignId,action,targetId,now());}
 private controlled(actor:Actor,s:State,characterId:string,role:string){
  const e=getEntity(s,characterId,'character'),d=data(e,'character');
  ensure(d.playable&&(d.controllerUserId===actor.id||privileged(role)&&d.controllerUserId===null),403,'character_not_controlled');return e;
 }
 roster(actor:Actor,id:string){const {access}=this.access(actor,id);const s=this.load(id);return s.entities.filter(e=>e.kind==='character'&&!e.archived&&e.data.playable&&(e.data.controllerUserId===actor.id||privileged(access.role)&&!e.data.controllerUserId)).map(e=>({id:e.id,name:e.name,description:e.data.description,condition:e.data.condition}));}
 view(actor:Actor,id:string,characterId:string){const {t,access}=this.access(actor,id);const s=this.load(id);this.controlled(actor,s,characterId,access.role);
  return {timeline:{id:t.id,name:t.name,revision:t.revision},...observerView(s,characterId),turns:this.transcript(id).filter(turn=>turn.character_id===characterId&&turn.user_id===actor.id).slice(-100)};}
 creator(actor:Actor,id:string){const {t}=this.access(actor,id,true);return {timeline:t,...this.load(id),references:this.store.all('SELECT entity_id,target_id FROM entity_links WHERE timeline_id=?',id)};}
 private mutate<T extends object>(actor:Actor,id:string,expectedRevision:number,key:string,body:unknown,type:string,creator:boolean,fn:(s:State,eventId:string,seed:string,role:string)=>{result:T;effects?:Effect[];draws?:number;characterId?:string;turnText?:string}){
  keySchema.parse(key);
  return this.store.transaction(()=>{
   const {t,access}=this.access(actor,id,creator);
   const receipt=this.store.get<{body_hash:string;result_json:string}>('SELECT * FROM game_receipts WHERE timeline_id=? AND actor_id=? AND key=?',id,actor.id,key);
   if(receipt){ensure(receipt.body_hash===checksum(body),409,'idempotency_conflict');return JSON.parse(receipt.result_json);}
   ensure(t.revision===expectedRevision,409,'revision_conflict');
   const s=this.load(id),eventId=randomUUID(),seed=randomBytes(32).toString('hex');
   const action=fn(s,eventId,seed,access.role);this.persist(id,s);
   const revision=t.revision+1;
   this.store.run('UPDATE timelines SET revision=? WHERE id=?',revision,id);
   this.store.run('INSERT INTO game_events VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',eventId,id,revision,actor.id,action.characterId??null,type,JSON.stringify(body),JSON.stringify(action.effects??[]),seed,action.draws??0,s.clock,now());
   if(action.characterId){
    const permitted=(action.effects??[]).filter(e=>e.observers.includes(action.characterId!));
    const narration=permitted.map(e=>e.text).join('\n\n')||'The action is recorded.';
    this.store.run('INSERT INTO story_turns VALUES (?,?,?,?,?,?,?,?,?,?)',eventId,id,actor.id,action.characterId,action.turnText??type,JSON.stringify(permitted),narration,'grounded','grounded-v1',now());
   }
   this.audit(actor,t.campaign_id,type,eventId);
   const response={revision,eventId,...action.result};
   this.store.run('INSERT INTO game_receipts VALUES (?,?,?,?,?)',id,actor.id,key,checksum(body),JSON.stringify(response));
   this.saveInternal(actor,id,'Autosave '+revision,s,revision,true);
   return response;
  });
 }
 edit(actor:Actor,id:string,input:{revision:number;entity:unknown},key:string){
  const entity=validateEntity(input.entity);
  return this.mutate(actor,id,input.revision,key,input,'creator.entity',true,s=>{
   const previous=s.entities.find(e=>e.id===entity.id);ensure(!previous||previous.kind===entity.kind,400,'entity_kind_immutable');
   if(entity.kind==='character'&&entity.data.controllerUserId)ensure(this.store.get('SELECT user_id FROM memberships WHERE campaign_id=(SELECT campaign_id FROM timelines WHERE id=?) AND user_id=?',id,String(entity.data.controllerUserId)),400,'controller_not_member');
   if(entity.kind==='character'){
    const c=data(entity,'character');let spent=0;const seen=new Set(c.traits);ensure(seen.size===c.traits.length,400,'duplicate_traits');
    for(const traitId of c.traits){const t=data(getEntity(s,traitId,'trait'),'trait');ensure(t.prerequisites.every(x=>seen.has(x))&&!t.opposes.some(x=>seen.has(x)),400,'trait_prerequisite_or_opposition');if(t.mode==='costed')spent+=Math.max(0,t.cost);}
    ensure(spent<=s.settings.traitBudget,400,'trait_budget_exceeded');
    if(previous)for(const old of data(previous,'character').traits){const trait=data(getEntity(s,old,'trait'),'trait');ensure(!trait.permanent||seen.has(old),400,'permanent_trait');}
   }
   if(entity.archived)ensure(!s.entities.some(e=>!e.archived&&e.id!==entity.id&&refs(e).includes(entity.id)),409,'entity_has_active_references');
   if(previous)s.entities[s.entities.indexOf(previous)]=entity;else s.entities.push(entity);
   return {result:{entityId:entity.id}};
  });
 }
 configure(actor:Actor,id:string,revision:number,settings:unknown,key:string){
  const parsed=settingsSchema.parse(settings);new Intl.DateTimeFormat('en-US',{timeZone:parsed.timezone});
  return this.mutate(actor,id,revision,key,{revision,settings:parsed},'creator.settings',true,s=>{s.settings=parsed;return {result:{}};});
 }
 epistemic(actor:Actor,id:string,revision:number,input:{layer:'truth'|'knowledge'|'belief'|'memory'|'correct-belief'|'retire-truth'|'refresh-memory';subjectId:string;text:string;factId?:string;confidence?:number;recordId?:string;salience?:number;decayPerDay?:number},key:string){
  return this.mutate(actor,id,revision,key,input,'creator.epistemic',true,(s,eventId)=>{
   getEntity(s,input.subjectId);
   if(['knowledge','belief','memory','correct-belief','refresh-memory'].includes(input.layer))getEntity(s,input.subjectId,'character');
   if(input.layer==='truth')fact(s,input.subjectId,'authored',input.text,eventId);
   if(input.layer==='knowledge'){ensure(input.factId,400,'fact_required');observe(s,input.subjectId,input.factId,'Creator');}
   if(input.layer==='belief')s.beliefs.push({id:randomUUID(),observerId:input.subjectId,proposition:input.text,confidence:input.confidence??0.5,source:'Creator',at:s.clock,correctedBy:null});
   if(input.layer==='memory')s.memories.push({id:randomUUID(),observerId:input.subjectId,text:input.text,salience:input.salience??1,decayPerDay:input.decayPerDay??0.01,eventId,at:s.clock,private:true});
   if(input.layer==='correct-belief'){const belief=s.beliefs.find(b=>b.id===input.recordId&&b.observerId===input.subjectId);ensure(belief&&input.factId,400,'belief_and_correction_required');observe(s,input.subjectId,input.factId,'correction:'+eventId);belief.correctedBy=input.factId;belief.at=s.clock;}
   if(input.layer==='retire-truth'){const old=s.facts.find(f=>f.id===input.factId&&f.subjectId===input.subjectId);ensure(old,400,'fact_required');old.retiredAt=s.clock;fact(s,input.subjectId,old.predicate,input.text,eventId);}
   if(input.layer==='refresh-memory'){const memory=s.memories.find(m=>m.id===input.recordId&&m.observerId===input.subjectId);ensure(memory,400,'memory_required');memory.at=s.clock;memory.salience=input.salience??memory.salience;memory.decayPerDay=input.decayPerDay??memory.decayPerDay;}
   return {result:{}};
  });
 }
 turn(actor:Actor,id:string,input:{revision:number;characterId:string;action:Action;text?:string},key:string){
  const action=actionSchema.parse(input.action);
  this.authorizeCharacter(actor,id,input.characterId);
  return this.mutate(actor,id,input.revision,key,{...input,action},'story.turn',false,(s,eventId,seed,role)=>{
   this.controlled(actor,s,input.characterId,role);
   const resolved=resolveAction(s,input.characterId,action,eventId,seed);
   const permitted=resolved.effects.filter(e=>e.observers.includes(input.characterId));
   const narration=permitted.map(e=>e.text).join('\n\n')||'The action is recorded.';
   return {result:{narration,permitted},effects:resolved.effects,draws:resolved.draws,characterId:input.characterId,turnText:input.text??action.type};
  });
 }
 authorizeCharacter(actor:Actor,id:string,characterId:string){const {access}=this.access(actor,id);this.controlled(actor,this.load(id),characterId,access.role);}
 parse(actor:Actor,id:string,characterId:string,text:string):{action:Action|null;clarification?:string}{
  const {access}=this.access(actor,id),s=this.load(id);this.controlled(actor,s,characterId,access.role);
  const input=text.trim();
  if(/^look$/i.test(input))return {action:{type:'look'}};
  const wait=/^(wait|sleep)\s+(\d+)(?:\s+minutes?)?$/i.exec(input);
  if(wait)return {action:actionSchema.parse({type:wait[1]!.toLowerCase(),minutes:Number(wait[2])})};
  const say=/^say\s+([\s\S]+)$/i.exec(input);if(say)return {action:{type:'say',text:say[1]!}};
  const go=/^(?:go|travel)\s+(?:to\s+)?(.+)$/i.exec(input);
  if(go){const matches=s.entities.filter(e=>e.kind==='location'&&!e.archived&&e.name.toLowerCase()===go[1]!.toLowerCase()&&observerView(s,characterId).entities.some(v=>v.id===e.id));if(matches.length===1)return {action:{type:'travel',destinationId:matches[0]!.id,mode:'walk',vehicleId:null}};}
  return {action:null,clarification:'Choose an explicit action below, or enter “look”, “wait 10”, “sleep 60”, “say …”, or “go to [known location]”. No action has been taken.'};
 }
 private saveInternal(actor:Actor,id:string,name:string,s:State,revision:number,automatic=false){
  const saveId=randomUUID(),snapshot={version:1,state:s,transcript:this.transcript(id)};
  this.store.run('INSERT INTO saves VALUES (?,?,?,?,?,?,?,?,?)',saveId,id,name,revision,JSON.stringify(snapshot),checksum(snapshot),actor.id,now(),automatic?1:0);return saveId;
 }
 save(actor:Actor,id:string,name:string){const {t,access}=this.access(actor,id);ensure(access.role!=='observer',403,'forbidden');return this.store.transaction(()=>{const saveId=this.saveInternal(actor,id,name,this.load(id),t.revision);this.audit(actor,t.campaign_id,'save.created',saveId);return {id:saveId};});}
 saves(actor:Actor,id:string){const {access}=this.access(actor,id);return this.store.all('SELECT id,name,revision,created_at,automatic FROM saves WHERE timeline_id=? AND (?=1 OR created_by=?) ORDER BY rowid DESC LIMIT 100',id,privileged(access.role)?1:0,actor.id);}
 branch(actor:Actor,id:string,saveId:string,name:string){
  return this.store.transaction(()=>{
   const {t,access}=this.access(actor,id);ensure(access.role!=='observer',403,'forbidden');
   const save=this.store.get<{snapshot_json:string;checksum:string;revision:number}>('SELECT * FROM saves WHERE id=? AND timeline_id=? AND (?=1 OR created_by=?)',saveId,id,privileged(access.role)?1:0,actor.id);ensure(save,404,'save_unavailable');
   const snapshot=JSON.parse(save.snapshot_json);ensure(checksum(snapshot)===save.checksum,409,'corrupt_save');
   const parsed=snapshotSchema.parse(snapshot),childId=randomUUID();
   this.store.run('INSERT INTO timelines(id,campaign_id,parent_id,parent_save_id,name,revision,clock,settings_json,created_at) VALUES (?,?,?,?,?,?,?,?,?)',childId,t.campaign_id,id,saveId,name,1,parsed.state.clock,JSON.stringify(parsed.state.settings),now());
   this.persist(childId,parsed.state);this.restoreTranscript(childId,parsed.transcript);this.audit(actor,t.campaign_id,'timeline.branched',childId);
   this.saveInternal(actor,childId,'Branch origin',parsed.state,1,true);return {id:childId};
  });
 }
 export(actor:Actor,id:string){this.access(actor,id,true);const payload={version:1,state:this.load(id),transcript:this.transcript(id)};return {payload,checksum:checksum(payload)};}
 validateImport(actor:Actor,id:string,raw:unknown){
  this.access(actor,id,true);const bundle=z.strictObject({payload:snapshotSchema,checksum:z.string().length(64)}).parse(raw);
  ensure(checksum(bundle.payload)===bundle.checksum,400,'import_checksum_mismatch');
  const state=bundle.payload.state;state.entities=state.entities.map(validateEntity);validateState(state);
  const turnIds=new Set<string>();
  for(const turn of bundle.payload.transcript){ensure(!turnIds.has(turn.id),400,'duplicate_transcript_id');turnIds.add(turn.id);ensure(state.entities.some(e=>e.id===turn.character_id&&e.kind==='character'&&e.data.playable),400,'invalid_transcript_character');}
  for(const e of state.entities.filter(e=>e.kind==='character'))e.data.controllerUserId=e.data.playable?actor.id:null;
  return state;
 }
 import(actor:Actor,id:string,name:string,raw:unknown,dryRun=true){
  const state=this.validateImport(actor,id,raw);if(dryRun)return {valid:true,entities:state.entities.length,version:1};
  return this.store.transaction(()=>{const {t}=this.access(actor,id,true),child=randomUUID();this.store.run('INSERT INTO timelines(id,campaign_id,parent_id,name,clock,settings_json,created_at) VALUES (?,?,?,?,?,?,?)',child,t.campaign_id,id,name,state.clock,JSON.stringify(state.settings),now());this.persist(child,state);
   const bundle=z.object({payload:snapshotSchema}).parse(raw);
   this.restoreTranscript(child,bundle.payload.transcript.map(turn=>({...turn,user_id:actor.id})));
   this.audit(actor,t.campaign_id,'timeline.imported',child);this.saveInternal(actor,child,'Import origin',state,1,true);return {id:child};});
 }
 history(actor:Actor,id:string){this.access(actor,id,true);return this.store.all('SELECT * FROM game_events WHERE timeline_id=? ORDER BY rowid DESC LIMIT 100',id);}
 context(actor:Actor,id:string,characterId:string,query:string){const {access}=this.access(actor,id);const s=this.load(id);this.controlled(actor,s,characterId,access.role);return retrieve(s,characterId,query);}
 template(actor:Actor,id:string,name:string){
  const {t}=this.access(actor,id,true),campaign=this.store.get<{source_world_id:string}>('SELECT source_world_id FROM campaigns WHERE id=?',t.campaign_id)!;
  this.domain.access(actor,{type:'world',id:campaign.source_world_id},true);const bundle=this.export(actor,id),templateId=randomUUID();
  this.store.transaction(()=>{this.store.run('INSERT INTO creator_templates(id,world_id,name,bundle_json,created_by,created_at) VALUES (?,?,?,?,?,?)',templateId,campaign.source_world_id,name,JSON.stringify(bundle),actor.id,now());this.audit(actor,t.campaign_id,'template.created',templateId);});return {id:templateId};
 }
 installCatalog(actor:Actor,id:string,revision:number,key:string){
  return this.mutate(actor,id,revision,key,{revision,type:'catalog.install'},'creator.catalog',true,s=>{
   let count=0;
   const add=(kind:'trait'|'skill',name:string,category:string)=>{
    if(s.entities.some(e=>e.kind===kind&&e.name===name))return;
    s.entities.push(validateEntity({id:randomUUID(),kind,name,visibility:'campaign',data:{category,mode:'descriptive',description:'Creator-editable '+category+' descriptor. Mechanical effects and prerequisites must be authored.'}}));count++;
   };
   for(const name of skillNames)add('skill',name,'skill');
   for(const[category,names]of Object.entries(traitGroups))for(const name of names)add('trait',name,category);
   return {result:{created:count}};
  });
 }
 transcript(id:string){
  return [...this.store.all<z.infer<typeof transcriptSchema>>('SELECT id,character_id,user_id,input_text,narration,narration_status,created_at,source_event_id FROM archived_chronicle WHERE timeline_id=? ORDER BY rowid',id),
   ...this.store.all<z.infer<typeof transcriptSchema>>('SELECT id,character_id,user_id,input_text,narration,narration_status,created_at,id AS source_event_id FROM story_turns WHERE timeline_id=? ORDER BY rowid',id)];
 }
 private restoreTranscript(id:string,turns:z.infer<typeof transcriptSchema>[]){
  for(const turn of turns)this.store.run('INSERT INTO archived_chronicle VALUES (?,?,?,?,?,?,?,?,?)',id,turn.id,turn.character_id,turn.user_id,turn.input_text,turn.narration,turn.narration_status,turn.created_at,turn.source_event_id);
 }
 templates(actor:Actor,id:string){
  const {t}=this.access(actor,id,true),campaign=this.store.get<{source_world_id:string}>('SELECT source_world_id FROM campaigns WHERE id=?',t.campaign_id)!;
  this.domain.access(actor,{type:'world',id:campaign.source_world_id});
  return this.store.all('SELECT id,name,revision FROM creator_templates WHERE world_id=? AND archived_at IS NULL',campaign.source_world_id);
 }
 instantiateTemplate(actor:Actor,id:string,templateId:string,name:string){
  const available=this.templates(actor,id) as {id:string}[];
  ensure(available.some(t=>t.id===templateId),404,'template_unavailable');
  const template=this.store.get<{bundle_json:string}>('SELECT bundle_json FROM creator_templates WHERE id=?',templateId)!;
  return this.import(actor,id,name,JSON.parse(template.bundle_json),false);
 }
}
