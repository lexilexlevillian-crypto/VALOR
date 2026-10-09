/**
 * Isolated System 10. Node.js 24+, no third-party dependencies.
 * All integrations return configured dummy JSON; no external world is simulated.
 * SQLite stores only this module's canonical state and deduplication constraints.
 * Callers cannot provide canonical samples, ratings, difficulty, or owner receipts.
 */
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { BASELINE, ATTRIBUTES, SKILLS, FIELDS } from './schema.mjs';

/** @typedef {null|boolean|number|string|JSONValue[]|{[key:string]:JSONValue}} JSONValue */
/** @typedef {{[key:string]:JSONValue}} JSONObject */
/** @typedef {{request_id:string,branch_id:string,action_id:string,actor_id:string,task_profile:string,target_refs:string[],method_id:string,intent_ref:string,opportunity_id:string,expected_revisions:Record<string,number>,requested_at:string,audience_context:string}} ResolutionRequest */
/** @typedef {{operation:string,request?:ResolutionRequest,record?:JSONObject,character_id?:string,skill_id?:string,resolution_id?:string,source_event_id?:string,branch_id?:string,simulation_time?:string}} Command */

// Compatibility name only; never emit a duplicate suppression event.
export const EVENT_ALIASES = Object.freeze({CheckSuppressed:'ResolutionSuppressed'});

export const OWNERS = Object.freeze(['core_turn','identity_creation','npc_character','npc_autonomy','inventory','health','combat','vehicles_travel','economy_jobs','knowledge','memory','relationships','romance_intimacy','narrative','persistence','randomness','creator']);
const clone = value => structuredClone(value);
const canonical = value => {
  if (value === null || typeof value !== 'object') {
    if (!['string','number','boolean'].includes(typeof value) && value !== null) throw new TypeError('JSON required');
    if (typeof value === 'number' && !Number.isFinite(value)) throw new TypeError('Finite JSON number required');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (Object.getPrototypeOf(value) !== Object.prototype) throw new TypeError('Plain JSON object required');
  return '{' + Object.keys(value).sort().map(k => JSON.stringify(k)+':'+canonical(value[k])).join(',') + '}';
};
export const digest = value => createHash('sha256').update(canonical(value)).digest('hex');
const id = (...parts) => digest(parts);
const fail = (code, reason, retryability = 'never') => { throw new ContractError(code,reason,retryability); };
const need = (condition, reason, code = 'INVALID_INTENT') => { if (!condition) fail(code,reason); };
const integer = (n, min, max = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(n) && n >= min && n <= max;
const timestamp = value => {
  need(typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(value) && Number.isFinite(Date.parse(value)), 'UTC simulation timestamp required');
  return Date.parse(value);
};
const only = (record, fields, required = fields) => {
  canonical(record);
  need(record && !Array.isArray(record) && typeof record === 'object','Object required');
  need(Object.keys(record).every(k => fields.includes(k)), 'Unknown contract field');
  need(required.every(k => Object.hasOwn(record,k)), 'Missing contract field');
};
const record = (kind, value, required = []) => only(value,FIELDS[kind],required);
const findRating = (state, kind, character, capability) => {
  const row = state[kind].find(x => x.character_id === character && x[kind === 'skill_rating' ? 'skill_id' : 'attribute_id'] === capability);
  need(row, 'Unknown capability; explicit initialization required', 'MISSING_PREREQUISITE');
  return row;
};

export class ContractError extends Error {
  constructor(code, reason, retryability = 'never') { super(reason); this.code = code; this.retryability = retryability; }
}

/** Fixed lookup only: fixtures never execute callbacks or mutate another domain. */
export function mockDependency(owner, fixtures = {}) {
  need(OWNERS.includes(owner),'Unknown owner');
  return (operation, request) => {
    const table = fixtures[owner]?.[operation];
    const response = table?.[digest(request)] ?? table?.default;
    return clone(response ?? {owner,revision:0,available:false,receipt:null,payload:{}});
  };
}
export const requestCoreTurn = fixtures => mockDependency('core_turn',fixtures);
export const requestIdentityCreation = fixtures => mockDependency('identity_creation',fixtures);
export const requestNPCCharacter = fixtures => mockDependency('npc_character',fixtures);
export const requestNPCAutonomy = fixtures => mockDependency('npc_autonomy',fixtures);
export const requestInventory = fixtures => mockDependency('inventory',fixtures);
export const requestHealth = fixtures => mockDependency('health',fixtures);
export const requestCombat = fixtures => mockDependency('combat',fixtures);
export const requestVehiclesTravel = fixtures => mockDependency('vehicles_travel',fixtures);
export const requestEconomyJobs = fixtures => mockDependency('economy_jobs',fixtures);
export const requestKnowledge = fixtures => mockDependency('knowledge',fixtures);
export const requestMemory = fixtures => mockDependency('memory',fixtures);
export const requestRelationships = fixtures => mockDependency('relationships',fixtures);
export const requestRomanceConsent = fixtures => mockDependency('romance_intimacy',fixtures);
export const requestNarrative = fixtures => mockDependency('narrative',fixtures);
export const requestPersistence = fixtures => mockDependency('persistence',fixtures);
export const requestRandomness = fixtures => mockDependency('randomness',fixtures);
export const requestCreator = fixtures => mockDependency('creator',fixtures);

/** This class contains ONLY state variables named in the supplied architecture. */
export class CapabilityState {
  constructor() {
    this.system = {stable_domain_id:'capability_resolution',specification_version:'v1',display_number:10,ruleset_id:'capability_resolution/v1',ruleset_version:'v1',schema_version:'v1'};
    this.baseline_rules = clone(BASELINE);
    this.attribute_registry = [...ATTRIBUTES];
    this.mandatory_skill_registry = [...SKILLS];
    for (const key of Object.keys(FIELDS)) if (!(key in this)) this[key] = [];
    this.development_ledger = {milestone_evidence:[],advancement_events:[],attribute_programs:[],initial_grants:[],corrections:[]};
    this.delivery_and_recovery = {outbox_entries:[],consumer_cursors:{},domain_acknowledgments:[],pending_choices:[],sample_reservations:[],errors:[]};
  }
}

/** Pure baseline arithmetic; useful for exhaustive distribution verification. */
export function evaluateDice(dice, mode, B, D, partial, critical = false) {
  need(['normal','advantage','disadvantage'].includes(mode),'Invalid random mode');
  need(dice.length === (mode === 'normal' ? 2 : 3) && dice.every(n=>integer(n,1,10)),'Invalid sample');
  need(Number.isSafeInteger(B) && Number.isSafeInteger(D),'Integer arithmetic required');
  const order = dice.map((_,i)=>i).sort((a,b)=> mode === 'advantage' ? dice[b]-dice[a] || a-b : dice[a]-dice[b] || a-b);
  const keep_indices = mode === 'normal' ? [0,1] : order.slice(0,2);
  const kept = keep_indices.map(i=>dice[i]);
  const total = kept[0]+kept[1]+B, margin = total-D;
  const outcome_band = margin >= 0 ? 'full' : partial && margin >= -3 ? 'partial' : 'failure';
  const critical_label = critical && margin >= 5 && kept.every(x=>x===10) ? 'exceptional' : critical && outcome_band === 'failure' && kept.every(x=>x===1) ? 'complication' : 'none';
  return {keep_indices,total,margin,outcome_band,critical_label};
}

/**
 * Infrastructure handles are not game state. A database represents one branch.
 * Fixture configuration is server-only. Never accept fixtures through dispatch().
 */
export class System10 {
  #db; #stubs; #branch;
  constructor({database = ':memory:',branch_id = 'branch-001',fixtures = {}} = {}) {
    need(typeof branch_id === 'string' && branch_id.length > 0,'Branch required');
    this.#branch = branch_id;
    this.#stubs = Object.fromEntries(OWNERS.map(owner=>[owner,mockDependency(owner,clone(fixtures))]));
    this.#db = new DatabaseSync(database);
    this.#db.exec(`PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS capability_state (singleton INTEGER PRIMARY KEY CHECK(singleton=1), state TEXT NOT NULL CHECK(json_valid(state)));
      CREATE TABLE IF NOT EXISTS request_identity (branch_id TEXT NOT NULL, request_id TEXT NOT NULL, payload_hash TEXT NOT NULL, PRIMARY KEY(branch_id,request_id));
      CREATE TABLE IF NOT EXISTS practice_identity (source_event_id TEXT NOT NULL, character_id TEXT NOT NULL, skill_id TEXT NOT NULL, receipt_id TEXT NOT NULL UNIQUE, PRIMARY KEY(source_event_id,character_id,skill_id));`);
    this.#db.prepare('INSERT OR IGNORE INTO capability_state VALUES (1,?)').run(JSON.stringify(new CapabilityState()));
    const saved = this.#read();
    // Classification correction only: canonical IDs, dice, and ledgers stay intact.
    if(saved.system.stable_domain_id==='capability_resolution' && saved.system.display_number===9) {
      this.#transaction(state=>{state.system.display_number=10;});
    }
    const branchEvent = saved.event_envelope.at(-1);
    need(!branchEvent || branchEvent.branch_id === branch_id,'Database belongs to another branch');
  }
  close() { this.#db.close(); }
  #read() { return JSON.parse(this.#db.prepare('SELECT state FROM capability_state WHERE singleton=1').get().state); }
  #transaction(fn) {
    this.#db.exec('BEGIN IMMEDIATE');
    try {
      const state = this.#read(), result = fn(state);
      this.#validateState(state);
      this.#db.prepare('UPDATE capability_state SET state=? WHERE singleton=1').run(JSON.stringify(state));
      this.#db.exec('COMMIT');
      return clone(result ?? null);
    } catch(error) { this.#db.exec('ROLLBACK'); throw error; }
  }
  #validateState(s) {
    only(s,[...Object.keys(FIELDS),'attribute_registry','mandatory_skill_registry']);
    need(canonical(s.baseline_rules) === canonical(BASELINE),'Unregistered ruleset override');
    for(const [kind,values] of Object.entries(s)) if(Array.isArray(values)&&FIELDS[kind]) for(const value of values) record(kind,value);
    const keys={capability_profile:['character_id'],skill_rating:['character_id','skill_id'],attribute_rating:['character_id','attribute_id'],skill_definition:['skill_id','version'],task_profile:['task_profile_id','profile_version'],specialization_binding:['binding_id'],mechanical_effect_binding:['binding_id'],resolution_request:['branch_id','request_id'],resolution_result:['resolution_id'],random_sample:['sample_id'],practice_receipt:['source_event_id','character_id','skill_id'],training_plan:['plan_id'],event_envelope:['event_id']};
    for(const [kind,fields] of Object.entries(keys)) need(new Set(s[kind].map(x=>digest(fields.map(k=>x[k])))).size===s[kind].length,'Duplicate canonical '+kind,'COMMIT_CONFLICT');
    for(const sample of s.random_sample) {
      need(sample.integrity_hash===digest(sample.dice),'Sample integrity mismatch');
      need(sample.dice.length>=2&&sample.dice.length<=3&&sample.dice.every(x=>integer(x,1,10))&&sample.keep_indices.length===2&&new Set(sample.keep_indices).size===2&&sample.keep_indices.every(x=>integer(x,0,sample.dice.length-1)),'Invalid stored sample');
    }
    for(const x of s.skill_rating) { record('skill_rating',x,FIELDS.skill_rating); need(integer(x.rank,0,10)&&integer(x.practice_units,0)&&integer(x.revision,0),'Invalid skill rating'); }
    for(const x of s.attribute_rating) { record('attribute_rating',x,FIELDS.attribute_rating); need(integer(x.value,1,7)&&integer(x.revision,0),'Invalid attribute rating'); }
    for(const x of s.practice_receipt) { record('practice_receipt',x,FIELDS.practice_receipt); need(integer(x.units,0,6),'Invalid receipt'); }
  }
  #call(owner, operation, request) {
    need(OWNERS.includes(owner),'Unregistered external owner');
    const response = this.#stubs[owner](operation,clone(request));
    only(response,['owner','revision','available','receipt','payload']);
    need(response.owner === owner && integer(response.revision,0),'Malformed owner projection');
    if(response.available !== true) fail('DOMAIN_UNAVAILABLE',owner+':'+operation,'resume_same_request');
    return response;
  }
  #authorize(operation, request, principal, creator = false) {
    need(typeof principal === 'string' && principal.length > 0,'Server-authenticated principal required');
    const a = this.#call(creator?'creator':'core_turn','authorize',{operation,request,principal}).payload;
    need(a.authorized === true && a.principal_id === principal && a.branch_id === this.#branch && a.operations?.includes(operation),'Unauthorized operation');
    const actor = request.actor_id ?? request.character_id ?? request.record?.character_id;
    if(actor) need(a.actor_ids?.includes(actor),'Actor authority denied');
    return a;
  }
  #event(s,type,payload,action,time) {
    const sequence = s.event_envelope.length+1;
    const envelope = {branch_id:this.#branch,event_id:id(this.#branch,sequence,type),parent_action_id:action,correlation_id:action,causation_id:action,simulation_time:time,sequence,schema_version:s.system.schema_version,ruleset_version:s.system.ruleset_version};
    timestamp(time); s.event_envelope.push(envelope);
    s.delivery_and_recovery.outbox_entries.push({event:{...envelope,type,payload:clone(payload)},recipient:'persistence'});
    return envelope.event_id;
  }
  #profile(s,ref) {
    const p = s.task_profile.find(x=>`${x.task_profile_id}@${x.profile_version}` === ref);
    need(p,'Pinned task definition missing','RULESET_MISSING');
    need(s.skill_definition.some(x=>x.skill_id===p.primary_skill_id),'Skill definition missing','RULESET_MISSING');
    return p;
  }
  #predicate(predicate,tags,projections,depth=0) {
    need(depth<=8,'Predicate nesting limit');
    only(predicate,['op','value','owner','key','args'],['op']);
    if(predicate.op==='tag') return tags.includes(predicate.value);
    if(predicate.op==='fact') {
      need(OWNERS.includes(predicate.owner) && typeof predicate.key==='string','Invalid factual predicate');
      return projections[predicate.owner]?.payload?.facts?.[predicate.key] === predicate.value;
    }
    need(['all','any','not'].includes(predicate.op) && Array.isArray(predicate.args) && predicate.args.length<=64,'Unsupported predicate');
    if(predicate.op==='not') { need(predicate.args.length===1,'not requires one operand'); return !this.#predicate(predicate.args[0],tags,projections,depth+1); }
    const evaluated=predicate.args.map(x=>this.#predicate(x,tags,projections,depth+1));
    return predicate.op==='all' ? evaluated.every(Boolean) : evaluated.some(Boolean);
  }
  #sources(p,s,actor) {
    const owners=new Set(['core_turn',p.owner,'knowledge']);
    const visit=x=> { if(x.op==='fact') owners.add(x.owner); for(const y of x.args??[]) visit(y); };
    for(const x of p.prerequisites) visit(x);
    for(const x of s.mechanical_effect_binding.filter(x=>x.character_id===actor)) { owners.add(x.source_owner); visit(x.task_predicate); }
    for(const c of p.effect_contracts) owners.add(c.owner);
    return [...owners];
  }
  #projection(s,p,actor,projections,time) {
    const r=findRating(s,'skill_rating',actor,p.primary_skill_id), a=findRating(s,'attribute_rating',actor,p.primary_attribute_id);
    let rank=r.rank, transfer=0;
    if(rank===0 && p.untrained_policy.mode==='related') {
      const definition=s.skill_definition.find(x=>x.skill_id===p.primary_skill_id);
      need(definition.related_skill_task_mappings.some(x=>x.skill_id===p.untrained_policy.skill_id && x.task_profile===`${p.task_profile_id}@${p.profile_version}`),'Undeclared skill transfer');
      rank=findRating(s,'skill_rating',actor,p.untrained_policy.skill_id).rank; transfer=-2;
    }
    const t=timestamp(time), tags=p.task_tags;
    const specialization=s.specialization_binding.some(x=>x.character_id===actor && x.evidence_refs.length && x.exact_task_tags.some(tag=>tags.includes(tag)) && (!x.expires_at || timestamp(x.expires_at)>t)) ? 1 : 0;
    const eligible=[],excluded=[],groups=new Map(), seen=new Set(), causes=new Map(), advantages=[],disadvantages=[];
    const bindings=s.mechanical_effect_binding.filter(x=>x.character_id===actor);
    need(bindings.filter(x=>this.#predicate(x.task_predicate,tags,projections)).length<=64,'Too many eligible effects');
    for(const effect of bindings) {
      const reason = !this.#predicate(effect.task_predicate,tags,projections) ? 'ineligible' : timestamp(effect.starts_at)>t || effect.ends_at && timestamp(effect.ends_at)<=t ? 'expired' : projections[effect.source_owner]?.revision !== effect.source_revision ? 'stale_source' : null;
      if(reason) { excluded.push({reference:effect.binding_id,reason}); continue; }
      const pair=id(effect.source_owner,effect.source_id,effect.effect_id);
      if(seen.has(pair)) { excluded.push({reference:effect.binding_id,reason:'duplicate_source_effect'}); continue; }
      seen.add(pair);
      const cause=id(effect.source_owner,effect.source_id);
      need(!p.difficulty_reason.sources?.some(x=>x.owner===effect.source_owner && x.source_id===effect.source_id),'Difficulty and effect duplicate a cause');
      if(causes.has(cause)) { excluded.push({reference:effect.binding_id,reason:'duplicate_causal_fact'}); continue; }
      causes.set(cause,effect.effect_kind); eligible.push(effect.binding_id);
      if(effect.effect_kind==='numeric') { const values=groups.get(effect.stacking_group)??[]; values.push(effect.value); groups.set(effect.stacking_group,values); }
      if(effect.effect_kind==='advantage') advantages.push(effect.binding_id);
      if(effect.effect_kind==='disadvantage') disadvantages.push(effect.binding_id);
    }
    let raw=transfer;
    for(const values of groups.values()) raw+=Math.max(0,...values)+Math.min(0,...values);
    const helpers=projections[p.owner].payload.helpers??[];
    need(!helpers.length || !groups.has('assistance'),'Assistance cannot be counted twice');
    need(helpers.length<=p.helper_capacity && helpers.length+1<=16,'Helper capacity exceeded');
    need(new Set(helpers.map(x=>x.actor_id)).size===helpers.length,'Duplicate helper');
    need(helpers.every(x=>x.present && x.capable && x.authorized && x.available_attention && x.equipment_access),'Ineligible helper');
    raw+=Math.min(2,helpers.length);
    const circumstance=Math.max(-5,Math.min(5,raw)), cancellations=Math.min(advantages.length,disadvantages.length);
    return {participant_id:actor,skill_rank:rank,attribute_value:a.value,attribute_contribution:a.value-4,specialization,eligible_effect_refs:eligible,excluded_effects:excluded,circumstance_raw:raw,circumstance,advantage_sources:advantages,disadvantage_sources:disadvantages,cancelled_sources:[...advantages.slice(0,cancellations),...disadvantages.slice(0,cancellations)],random_mode:p.resolution_kind==='passive'?'none':advantages.length===disadvantages.length?'normal':advantages.length>disadvantages.length?'advantage':'disadvantage',B:rank+(a.value-4)+specialization+circumstance};
  }
  #view(resolution_id,request,principal) {
    const s=this.#read(), result=s.resolution_result.find(x=>x.resolution_id===resolution_id);
    need(result,'Resolution missing');
    const authorization=this.#authorize('view',request,principal);
    if(authorization.developer===true) return clone(result);
    // The knowledge black box explicitly approves the WHOLE public envelope.
    // No private status, identifier, arithmetic, or exception is merged into it.
    return this.#call('knowledge','project',{request,result,principal}).payload.public_projection ?? {};
  }
  /** Typed JSON entry point. principal is supplied by the trusted transport. */
  dispatch(command,principal) {
    try {
      canonical(command);
      need(typeof command.operation==='string','Operation required');
      switch(command.operation) {
        case 'resolve': only(command,['operation','request']); return this.resolve(command.request,principal);
        case 'resume': only(command,['operation','request']); return this.resume(command.request,principal);
        case 'register': return this.register(command,principal);
        case 'initialize': return this.initialize(command,principal);
        case 'practice': return this.practice(command,principal);
        case 'advance': return this.advance(command,principal);
        case 'attribute_program': return this.attributeProgram(command,principal);
        case 'correct': return this.correct(command,principal);
        case 'aggregate': return this.aggregate(command,principal);
        case 'flush': return this.flush(command,principal);
        case 'restore': return this.restore(command,principal);
        case 'export': this.#authorize('export',command,principal,true); return this.#read();
        case 'fork': return this.fork(command,principal);
        default: fail('INVALID_INTENT','Unknown operation');
      }
    } catch(error) {
      if(!(error instanceof ContractError)) {
        if(error instanceof TypeError || error instanceof RangeError) error=new ContractError('INVALID_INTENT','Malformed JSON contract');
        else error=new ContractError('DOMAIN_UNAVAILABLE','Local persistence unavailable','resume_same_request');
      }
      // Error causes may themselves reveal hidden state. Default public failure is inert.
      const envelope={code:error.code,retryability:error.retryability,sample_exists:this.#read().random_sample.some(x=>x.resolution_id===id(this.#branch,command.request?.action_id,command.request?.opportunity_id))};
      try { this.#transaction(s=>{s.delivery_and_recovery.errors.push(envelope);}); } catch { /* Preserve canon if storage itself is unavailable. */ }
      try { const a=this.#authorize('diagnostics',command,principal); if(a.developer===true) return {error:{...envelope,reason:error.message}}; } catch {}
      return {};
    }
  }
  register(command,principal) {
    only(command,['operation','kind','record']); this.#authorize('register',command,principal,true);
    const allowed=['skill_definition','task_profile','mechanical_effect_binding','specialization_binding','training_plan'];
    need(allowed.includes(command.kind),'Unsupported registry');
    const value=clone(command.record); record(command.kind,value,FIELDS[command.kind].filter(k=> !['freshness_policy_ref','expires_at'].includes(k)));
    if(command.kind==='skill_definition') {
      need(typeof value.skill_id==='string' && typeof value.version==='string','Definition identity required');
      need(value.training_milestones.length===10,'Explicit milestone rubric required for every starting rank');
    }
    if(command.kind==='task_profile') {
      need(OWNERS.includes(value.owner) && ATTRIBUTES.includes(value.primary_attribute_id),'Invalid profile ownership/pairing');
      need(['active_fixed','passive','opposed'].includes(value.resolution_kind),'Invalid resolution kind');
      need(['settled','changed_conditions','time_costly_search','repeated_hazard'].includes(value.retry_policy),'Retry policy required');
      need(['allowed','instruction_required','related'].includes(value.untrained_policy.mode),'Untrained policy required');
      need(value.resolution_kind==='opposed' ? value.difficulty===null : Number.isSafeInteger(value.difficulty),'Invalid difficulty');
      need(value.resolution_kind!=='opposed' || value.opposed_tie_policy==='preserve_existing_state' || typeof value.opposed_tie_policy==='object','Tie policy required');
      need(['complexity','signal','opposition','time'].includes(value.difficulty_reason.category),'Unsupported difficulty cause');
      need(!(value.difficulty>24) || value.difficulty_reason.creator_warning===true,'Creator difficulty warning required');
      need(integer(value.helper_capacity,0,15) && integer(value.duration,0),'Invalid capacity/duration');
      need(value.milestones.length<=64,'Unbounded milestones');
      need(value.effect_contracts.length<=64 && value.prerequisites.length<=64,'Unbounded profile');
      need(['abort','owner_revalidate'].includes(value.invalidation_policy),'Invalidation policy required');
      need(['resume_only','owner_expiry'].includes(value.choice_expiry_policy),'Choice expiry policy required');
      for(const band of (value.resolution_kind==='opposed'?['full','failure','initiator_win','responder_win','tie']:['full','failure'])) need(value.quality_bands[band],'Authored result semantics required');
      if(value.opposed_narrow_win_policy) for(const band of Object.values(value.opposed_narrow_win_policy)) need(value.quality_bands[band],'Narrow-win semantics missing');
      if(value.partial_policy!==false) need(value.quality_bands.partial && Array.isArray(value.partial_policy.options),'Partial semantics/options required');
      if(value.critical_policy!==false) {
        need(!value.task_tags.some(x=>['routine','knowledge_recall','binary_access'].includes(x)) && value.resolution_kind!=='passive','Criticals forbidden for this task');
        need(value.quality_bands.exceptional && value.quality_bands.complication,'Critical semantics missing');
      }
      for(const effect of value.effect_contracts) {
        only(effect,['owner','command_type','parameters','preconditions','bands','option','rejection_policy','fallback'],['owner','command_type','parameters','preconditions','bands','rejection_policy']);
        need(OWNERS.includes(effect.owner) && ['abort','ignore','fallback'].includes(effect.rejection_policy),'Invalid effect contract');
        if(effect.rejection_policy==='fallback') {
          only(effect.fallback,['owner','command_type','parameters','preconditions','rejection_policy']);
          need(OWNERS.includes(effect.fallback.owner)&&['abort','ignore'].includes(effect.fallback.rejection_policy),'Bounded fallback required');
        }
      }
    }
    if(command.kind==='mechanical_effect_binding') {
      need(OWNERS.includes(value.source_owner) && integer(value.source_revision,0),'Invalid effect provenance');
      need(['numeric','advantage','disadvantage','affordance','training_policy'].includes(value.effect_kind),'Invalid effect kind');
      need(value.effect_kind!=='numeric'||integer(value.value,-3,3),'Effect outside bounds');
      timestamp(value.starts_at); if(value.ends_at) need(timestamp(value.ends_at)>timestamp(value.starts_at),'Invalid expiry');
      need(value.source_event_id && value.definition_ref && value.stacking_group,'Missing effect provenance');
      this.#predicate(value.task_predicate,[],{},0);
    }
    if(command.kind==='specialization_binding') need(value.evidence_refs.length>0 && value.exact_task_tags.length>0 && value.source_event_id,'Specialization evidence required');
    return this.#transaction(s=> {
      const key=command.kind==='skill_definition' ? ['skill_id','version'] : command.kind==='task_profile' ? ['task_profile_id','profile_version'] : command.kind==='training_plan' ? ['plan_id'] : ['binding_id'];
      const existing=s[command.kind].find(x=>key.every(k=>x[k]===value[k]));
      if(existing) { need(canonical(existing)===canonical(value),'Immutable definition/binding conflict','COMMIT_CONFLICT'); return existing; }
      if(command.kind==='task_profile') need(s.skill_definition.some(x=>x.skill_id===value.primary_skill_id),'Primary skill missing','RULESET_MISSING');
      s[command.kind].push(value); return value;
    });
  }
  initialize(command,principal) {
    only(command,['operation','character_id','simulation_time']); this.#authorize('initialize',command,principal,true);
    const grant=this.#call('identity_creation','initial_profile',command).payload;
    need(grant.authorized===true && grant.character_id===command.character_id && grant.branch_id===this.#branch && grant.history_ref && grant.authority,'Invalid initial grant');
    const attributes=grant.attributes, skills=grant.skills;
    only(attributes,ATTRIBUTES); need(Object.values(attributes).every(v=>integer(v,2,6)),'Creation attributes outside 2..6');
    need(Object.values(attributes).reduce((a,b)=>a+b,0)===28 && Object.values(attributes).reduce((a,b)=>a+Math.max(0,b-4),0)<=4,'Creation reallocation budget');
    need(Object.values(skills).every(v=>integer(v,0,5)) && Object.values(skills).reduce((a,b)=>a+b,0)===24 && Object.values(skills).filter(v=>v===5).length<=2,'Creation skill budget');
    for(const [skill,rank] of Object.entries(skills)) if(rank>3) need(grant.evidence?.[skill]?.length,'Starting rank requires experience');
    timestamp(command.simulation_time);
    return this.#transaction(s=> {
      const existing=s.development_ledger.initial_grants.find(x=>x.character_id===command.character_id);
      if(existing) { need(canonical(existing.ratings)===canonical({attributes,skills}),'Initial grant conflict','COMMIT_CONFLICT'); return existing; }
      need(Object.keys(skills).every(k=>s.skill_definition.some(d=>d.skill_id===k)),'Unknown skill definition','RULESET_MISSING');
      const event=this.#event(s,'CapabilityChanged',{initial_grant:true,character_id:command.character_id},grant.source_event_id,command.simulation_time);
      for(const [attribute_id,value] of Object.entries(attributes)) s.attribute_rating.push({character_id:command.character_id,attribute_id,value,revision:0});
      for(const [skill_id,rank] of Object.entries(skills)) s.skill_rating.push({character_id:command.character_id,skill_id,rank,practice_units:0,revision:0});
      s.capability_profile.push({character_id:command.character_id,revision:0,ruleset_id:s.system.ruleset_id,last_event_id:event});
      const saved={character_id:command.character_id,profile_version:grant.profile_version,authority:grant.authority,source_history:grant.history_ref,ratings:{attributes,skills}};
      s.development_ledger.initial_grants.push(saved); return saved;
    });
  }
  resolve(request,principal) {
    record('resolution_request',request,FIELDS.resolution_request);
    need(request.branch_id===this.#branch,'Branch mismatch');
    for(const key of ['request_id','action_id','actor_id','task_profile','method_id','intent_ref','opportunity_id','audience_context']) need(typeof request[key]==='string' && request[key].length>0,'Invalid request identity');
    timestamp(request.requested_at);
    need(Array.isArray(request.target_refs)&&request.target_refs.length<=16&&request.target_refs.every(x=>typeof x==='string'),'Unbounded targets');
    this.#authorize('resolve',request,principal);
    const resultId=id(this.#branch,request.action_id,request.opportunity_id);
    const prepared=this.#transaction(s=> {
      const existing=s.resolution_request.find(x=>x.request_id===request.request_id && x.branch_id===this.#branch);
      if(existing) { need(canonical(existing)===canonical(request),'Conflicting request reuse','COMMIT_CONFLICT'); return s.resolution_result.find(x=>x.resolution_id===id(this.#branch,existing.action_id,existing.opportunity_id)); }
      const p=this.#profile(s,request.task_profile);
      need(p.method_id===request.method_id,'Method mismatch');
      const actor=s.capability_profile.find(x=>x.character_id===request.actor_id);
      need(actor && actor.ruleset_id===s.system.ruleset_id,'Actor profile missing or ruleset mismatch','RULESET_MISSING');
      const projections=Object.fromEntries(this.#sources(p,s,request.actor_id).map(owner=>[owner,this.#call(owner,'projection',request)]));
      const core=projections.core_turn.payload, domain=projections[p.owner].payload, knowledge=projections.knowledge.payload;
      need(core.authorized===true && core.actor_id===request.actor_id && core.action_id===request.action_id && core.intent_ref===request.intent_ref && core.opportunity_id===request.opportunity_id,'Intent/opportunity not owner-authorized');
      need(core.simulation_time===request.requested_at && core.method_id===request.method_id,'Intent method/time mismatch');
      need(!(core.dependent_resolution_ids??[]).some(ref=>s.resolution_result.some(r=>r.resolution_id===ref&&r.status!=='COMMITTED')),'Dependent action awaits commitment or owner repair','COMMIT_CONFLICT');
      need(knowledge.opportunity_id===request.opportunity_id && knowledge.registered===true && knowledge.actor_id===request.actor_id,'Unregistered observation opportunity');
      need(domain.objective && domain.target_refs && canonical(domain.target_refs)===canonical(request.target_refs),'Target scope mismatch');
      need(domain.setting_available===true,'Unavailable setting/2012 affordance','MISSING_PREREQUISITE');
      const revisions=Object.fromEntries(Object.entries(projections).map(([owner,v])=>[owner,v.revision])); revisions.actor=actor.revision;
      need(Object.entries(request.expected_revisions).every(([k,v])=>integer(v,0) && revisions[k]===v),'Stale preparation','STALE_REVISION');
      const lineageId=id(this.#branch,request.actor_id,[...request.target_refs].sort(),p.method_family,domain.objective);
      const lineage=s.attempt_lineage.find(x=>x.lineage_id===lineageId);
      if(lineage?.resolution_refs.length) {
        const sameOpportunity=lineage.opportunity_refs.includes(request.opportunity_id);
        if(sameOpportunity) return s.resolution_result.find(x=>x.resolution_id===lineage.resolution_refs[lineage.opportunity_refs.indexOf(request.opportunity_id)]);
        if(canonical(lineage.relevant_revisions)===canonical(knowledge.payload_revisions??revisions)) fail('OPPORTUNITY_SETTLED','Opportunity already settled','return_original_resolution');
        need(knowledge.retry_authorized===true && knowledge.retry_policy===p.retry_policy && knowledge.previous_resolution_id===lineage.resolution_refs.at(-1),'Retry opportunity not authorized','OPPORTUNITY_SETTLED');
        if(['time_costly_search','repeated_hazard'].includes(p.retry_policy)) need(knowledge.coverage_interval && knowledge.within_horizon===true,'Bounded new coverage required','OPPORTUNITY_SETTLED');
        if(['settled','changed_conditions'].includes(p.retry_policy)) need(knowledge.material_change===true,'Settled opportunity unchanged','OPPORTUNITY_SETTLED');
      }
      need(!s.resolution_result.some(x=>x.resolution_id===resultId),'Action identity collision','COMMIT_CONFLICT');
      need(['feasible','access','prerequisites_met'].every(k=>typeof domain[k]==='boolean'),'Incomplete owner feasibility projection');
      const gated = domain.feasible!==true || domain.access!==true || domain.prerequisites_met!==true || !p.prerequisites.every(x=>this.#predicate(x,p.task_tags,projections));
      let admission,reason=null,participants=[];
      if(core.choice_required===true) { admission='NEEDS_CHOICE'; reason='actor_choice_required'; }
      else if(gated) { admission='NO_ROLL_FAILURE'; reason='factual_prerequisite'; }
      else {
        const primary=this.#projection(s,p,request.actor_id,projections,request.requested_at);
        participants.push(primary);
        if(primary.skill_rank===0 && p.untrained_policy.mode==='instruction_required' && domain.instruction_valid!==true) { admission='NO_ROLL_FAILURE'; reason='instruction_required'; }
        else if(domain.deterministic_outcome) { need(['full','failure'].includes(domain.deterministic_outcome),'Invalid deterministic owner outcome'); admission=domain.deterministic_outcome==='full'?'NO_ROLL_SUCCESS':'NO_ROLL_FAILURE'; reason='owner_deterministic_rule'; }
        else if(domain.routine===true || domain.meaningful_uncertainty===false || domain.meaningful_stakes===false || domain.safe_costless_retry===true) { admission='NO_ROLL_SUCCESS'; reason='routine_or_costless'; }
        else if(p.resolution_kind==='passive') { admission='CHECK_REQUIRED'; reason='passive_deterministic'; }
        else if(p.resolution_kind==='opposed') {
          const opponent=domain.opponent;
          need(opponent?.actor_id && opponent.task_profile,'Opponent method required');
          const op=this.#profile(s,opponent.task_profile);
          const opponentRequest={...request,actor_id:opponent.actor_id,task_profile:opponent.task_profile,method_id:op.method_id};
          const opSources=Object.fromEntries(this.#sources(op,s,opponent.actor_id).map(owner=>[owner,this.#call(owner,'projection',opponentRequest)]));
          const opponentDomain=opSources[op.owner].payload;
          need(opponentDomain.feasible===true && opponentDomain.access===true && opponentDomain.prerequisites_met===true && opSources.core_turn.payload.authorized===true && op.prerequisites.every(x=>this.#predicate(x,op.task_tags,opSources)),'Opponent method inadmissible; owner must supply environmental method','MISSING_PREREQUISITE');
          const pp=this.#projection(s,op,opponent.actor_id,opSources,request.requested_at);
          need(!(pp.skill_rank===0&&op.untrained_policy.mode==='instruction_required'&&opponentDomain.instruction_valid!==true),'Opponent lacks instruction','MISSING_PREREQUISITE');
          participants.push(pp);
          for(const [owner,projection] of Object.entries(opSources)) revisions[opponent.actor_id+':'+owner]=projection.revision;
          revisions[opponent.actor_id+':actor']=s.capability_profile.find(x=>x.character_id===opponent.actor_id)?.revision;
          need(Number.isSafeInteger(revisions[opponent.actor_id+':actor']),'Missing opponent profile','MISSING_PREREQUISITE');
          admission='CHECK_REQUIRED';
        } else if(2+primary.B>=p.difficulty && domain.consequential_quality_variation!==true) { admission='NO_ROLL_SUCCESS'; reason='all_rolls_full'; }
        else if(20+primary.B < p.difficulty-(p.partial_policy===false?0:3)) { admission='NO_ROLL_FAILURE'; reason='no_attainable_success'; }
        else admission='CHECK_REQUIRED';
      }
      const reservation=this.#call('core_turn','reserve',{request,duration:p.duration,options:admission==='NEEDS_CHOICE'?core.options??[]:p.partial_policy.options??[]});
      need(reservation.payload.accepted===true && reservation.receipt,'Reservation denied','COMMIT_CONFLICT');
      if(p.milestones.length) need(domain.milestone?.authorized===true && p.milestones.some(x=>x.scope===domain.milestone.scope),'Extended task requires an owner-authorized milestone checkpoint');
      const frozen={profile:p,owner_revisions:revisions,domain,knowledge};
      const snapshot={snapshot_hash:'',profile_version:p.profile_version,ruleset_version:s.system.ruleset_version,consumed_revisions:revisions,prerequisite_evidence:domain.prerequisite_evidence??[],admission_decision:admission,suppressed_check_reason:reason,difficulty:p.difficulty,participant_projections:participants,reservation_refs:[reservation.receipt],frozen_result_policy:frozen};
      snapshot.snapshot_hash=digest({...snapshot,snapshot_hash:null});
      const samples=[];
      if(admission==='CHECK_REQUIRED' && p.resolution_kind!=='passive') for(const participant of participants) {
        const identity={branch_randomness_lineage:this.#branch,action_id:request.action_id,opportunity_id:request.opportunity_id,participant_id:participant.participant_id,sample_slot:'primary'};
        const supplied=this.#call('randomness','sample',{...identity,mode:participant.random_mode}).payload;
        need(supplied.algorithm_version && supplied.nonce && Array.isArray(supplied.dice),'Malformed randomness fixture');
        const arithmetic=evaluateDice(supplied.dice,participant.random_mode,participant.B,0,false);
        const sample={sample_id:id(identity),resolution_id:resultId,...identity,algorithm_version:supplied.algorithm_version,nonce:supplied.nonce,dice:supplied.dice,keep_indices:arithmetic.keep_indices,integrity_hash:digest(supplied.dice)};
        samples.push(sample);
      }
      const result={resolution_id:resultId,status:'PREPARED',admission_decision:admission,profile_version:p.profile_version,snapshot_hash:snapshot.snapshot_hash,consumed_revisions:revisions,sample_ref:samples.length?samples.map(x=>x.sample_id):{reason:reason??'no_sample'},total:null,opposed_totals:null,margin:null,outcome_band:null,critical_label:'none',quality:null,effect_proposals:[],observation_proposals:[],practice_eligibility:{eligible:false,reason:'awaiting_completion'},continuation_options:[],public_projection_ref:null,domain_receipts:[],blocked_reason:null,abort_reason:null};
      if(admission==='NEEDS_CHOICE') { result.status='AWAITING_CHOICE'; result.continuation_options=core.options??[]; }
      else this.#compute(result,snapshot,samples,request);
      this.#db.prepare('INSERT INTO request_identity VALUES (?,?,?)').run(this.#branch,request.request_id,digest(request));
      s.resolution_request.push(clone(request)); s.resolution_snapshot.push(snapshot); s.random_sample.push(...samples); s.resolution_result.push(result);
      s.delivery_and_recovery.sample_reservations.push(...samples.map(x=>x.sample_id));
      if(lineage) { lineage.relevant_revisions=knowledge.payload_revisions??revisions; lineage.opportunity_refs.push(request.opportunity_id); lineage.resolution_refs.push(resultId); if(knowledge.coverage_interval) lineage.coverage_and_hazard_intervals.push(knowledge.coverage_interval); }
      else s.attempt_lineage.push({lineage_id:lineageId,branch_id:this.#branch,actor_id:request.actor_id,target_refs:request.target_refs,method_family:p.method_family,objective:domain.objective,relevant_revisions:knowledge.payload_revisions??revisions,opportunity_refs:[request.opportunity_id],resolution_refs:[resultId],coverage_and_hazard_intervals:knowledge.coverage_interval?[knowledge.coverage_interval]:[]});
      this.#event(s,'ResolutionPrepared',{resolution_id:resultId,snapshot_hash:snapshot.snapshot_hash,gates:snapshot.prerequisite_evidence},request.action_id,request.requested_at);
      for(const sample of samples) this.#event(s,'ResolutionSampled',sample,request.action_id,request.requested_at);
      if(admission.startsWith('NO_ROLL')) this.#event(s,'ResolutionSuppressed',{resolution_id:resultId,reason},request.action_id,request.requested_at);
      if(result.status==='AWAITING_CHOICE') {
        s.delivery_and_recovery.pending_choices.push({frozen_resolution:resultId,options:result.continuation_options,expiry_policy:p.choice_expiry_policy});
        this.#event(s,'ResolutionAwaitingChoice',{resolution_id:resultId,options:result.continuation_options},request.action_id,request.requested_at);
      }
      return result;
    });
    if(['PREPARED','COMMITTING'].includes(prepared.status)) {
      const canonicalRequest=this.#read().resolution_request.find(x=>id(this.#branch,x.action_id,x.opportunity_id)===prepared.resolution_id);
      this.#commit(prepared.resolution_id,canonicalRequest);
    }
    return this.#view(prepared.resolution_id,request,principal);
  }
  #compute(result,snapshot,samples,request) {
    const p=snapshot.frozen_result_policy.profile, participant=snapshot.participant_projections[0];
    if(result.admission_decision.startsWith('NO_ROLL')) result.outcome_band=result.admission_decision==='NO_ROLL_SUCCESS'?'full':'failure';
    else if(p.resolution_kind==='passive') {
      result.total=11+participant.B;
      const previous=snapshot.frozen_result_policy.knowledge.concealment_quality;
      result.margin=result.total-(previous ?? snapshot.difficulty);
      result.outcome_band=result.margin>=0?'full':p.partial_policy!==false&&result.margin>=-3?'partial':'failure';
      if(previous!==undefined && result.margin===0) { const tie=snapshot.frozen_result_policy.knowledge.tie_result; need(['full','failure'].includes(tie),'Passive detection tie rule missing'); result.outcome_band=tie; }
    } else if(p.resolution_kind==='opposed') {
      const totals=samples.map((sample,i)=>sample.keep_indices.reduce((sum,k)=>sum+sample.dice[k],0)+snapshot.participant_projections[i].B);
      const delta=totals[0]-totals[1]; result.margin=delta; result.opposed_totals=totals;
      result.outcome_band=delta>0?'initiator_win':delta<0?'responder_win':'tie';
      if(delta!==0 && Math.abs(delta)<=3 && p.opposed_narrow_win_policy) result.outcome_band=p.opposed_narrow_win_policy[delta>0?'initiator':'responder'];
      if(p.critical_policy!==false && delta!==0) {
        const winner=delta>0?0:1, loser=1-winner;
        if(Math.abs(delta)>=5 && samples[winner].keep_indices.every(i=>samples[winner].dice[i]===10)) result.critical_label='exceptional';
        if(samples[loser].keep_indices.every(i=>samples[loser].dice[i]===1)) result.critical_label='complication';
      }
    } else {
      const arithmetic=evaluateDice(samples[0].dice,participant.random_mode,participant.B,snapshot.difficulty,p.partial_policy!==false,p.critical_policy!==false);
      for(const key of ['total','margin','outcome_band','critical_label']) result[key]=arithmetic[key];
    }
    const semantics=p.quality_bands[result.critical_label==='none'?result.outcome_band:result.critical_label];
    need(semantics,'Missing outcome semantics','RULESET_MISSING'); result.quality=clone(semantics);
    if(result.outcome_band==='partial' && p.partial_policy.options.length) { result.status='AWAITING_CHOICE'; result.continuation_options=clone(p.partial_policy.options); }
    result.effect_proposals=p.effect_contracts.filter(x=>x.bands.includes(result.outcome_band)||x.bands.includes(result.critical_label)).filter(x=>!x.option).map((effect,i)=>({owner:effect.owner,command_type:effect.command_type,parameters:effect.parameters,idempotency_key:id(result.resolution_id,'effect',i,effect),preconditions:effect.preconditions,originating_resolution_id:result.resolution_id}));
    const proposals=snapshot.frozen_result_policy.knowledge.observation_proposals?.[result.outcome_band]??[];
    need(proposals.length<=(p.information_caps.max_observations??0),'Observation cap exceeded');
    for(const observation of proposals) {
      record('observation_proposal',observation,FIELDS.observation_proposal);
      need(observation.observer===request.actor_id && observation.source_event && observation.knowledge_owner_receipt,'Unapproved evidence');
      need(p.reference_conditions.sensory_channels.includes(observation.acquisition_channel),'Unavailable observation channel');
      result.observation_proposals.push(clone(observation));
    }
  }
  #commit(resolution_id,request) {
    let s=this.#read(), result=s.resolution_result.find(x=>x.resolution_id===resolution_id);
    if(!result || !['PREPARED','COMMITTING'].includes(result.status)) return;
    const snapshot=s.resolution_snapshot.find(x=>x.snapshot_hash===result.snapshot_hash), p=snapshot.frozen_result_policy.profile;
    const validation=this.#call(p.owner,'validate_commit',{request,resolution:result,snapshot});
    if(validation.payload.accepted!==true) {
      const accepted=result.domain_receipts.some(x=>x.accepted===true);
      if(accepted) { this.#transaction(st=>{st.resolution_result.find(x=>x.resolution_id===resolution_id).blocked_reason='owner_repair_required';}); return; }
      return this.#abort(resolution_id,request,'owner_context_invalid');
    }
    if(validation.payload.revisions_changed===true && !(p.invalidation_policy==='owner_revalidate' && validation.payload.frozen_result_admissible===true)) return this.#abort(resolution_id,request,'stale_post_sample_context');
    this.#transaction(st=>{st.resolution_result.find(x=>x.resolution_id===resolution_id).status='COMMITTING';});
    // Lookup-before-send makes recovery after a lost reply idempotent.
    for(const effect of result.effect_proposals) {
      let receipt=this.#read().delivery_and_recovery.domain_acknowledgments.find(x=>x.command_id===effect.idempotency_key);
      if(!receipt) {
        const lookup=this.#call(effect.owner,'lookup_receipt',{idempotency_key:effect.idempotency_key});
        const response=lookup.payload.found===true ? lookup : this.#call(effect.owner,'command',effect);
        need(response.receipt && typeof response.payload.accepted==='boolean','Missing authoritative command receipt','COMMIT_CONFLICT');
        receipt={command_id:effect.idempotency_key,receipt:response.receipt,accepted:response.payload.accepted,owner:effect.owner};
        this.#transaction(st=> {
          if(!st.delivery_and_recovery.domain_acknowledgments.some(x=>x.command_id===receipt.command_id)) st.delivery_and_recovery.domain_acknowledgments.push(receipt);
          const r=st.resolution_result.find(x=>x.resolution_id===resolution_id);
          if(!r.domain_receipts.some(x=>x.command_id===receipt.command_id)) r.domain_receipts.push(receipt);
        });
      }
      if(!receipt.accepted) {
        const definition=p.effect_contracts.flatMap(x=>x.fallback?[x,x.fallback]:[x]).find(x=>x.owner===effect.owner&&x.command_type===effect.command_type&&canonical(x.parameters)===canonical(effect.parameters));
        if(definition?.rejection_policy==='ignore') continue;
        if(definition?.rejection_policy==='fallback') {
          const fallback={...definition.fallback,idempotency_key:id(effect.idempotency_key,'fallback'),originating_resolution_id:resolution_id};
          delete fallback.rejection_policy;
          this.#transaction(st=>{const r=st.resolution_result.find(x=>x.resolution_id===resolution_id);if(!r.effect_proposals.some(x=>x.idempotency_key===fallback.idempotency_key))r.effect_proposals.push(fallback);});
          if(!result.effect_proposals.some(x=>x.idempotency_key===fallback.idempotency_key)) result.effect_proposals.push(fallback);
          continue;
        }
        const accepted=this.#read().resolution_result.find(x=>x.resolution_id===resolution_id).domain_receipts.some(x=>x.accepted);
        if(accepted) this.#transaction(st=>{st.resolution_result.find(x=>x.resolution_id===resolution_id).blocked_reason='owner_compensation_or_repair_required';});
        else this.#abort(resolution_id,request,'effect_rejected');
        return;
      }
    }
    const completion=this.#call('core_turn','complete',{resolution_id,reservation_refs:snapshot.reservation_refs,idempotency_key:id(resolution_id,'complete')});
    need(completion.payload.accepted===true&&completion.receipt,'Completion pending','COMMIT_CONFLICT');
    this.#transaction(st=> {
      const r=st.resolution_result.find(x=>x.resolution_id===resolution_id); if(r.status==='COMMITTED') return;
      r.status='COMMITTED'; r.blocked_reason=null;
      r.domain_receipts.push({command_id:id(resolution_id,'complete'),receipt:completion.receipt,accepted:true,owner:'core_turn'});
      r.practice_eligibility={eligible:p.resolution_kind!=='passive',reason:p.resolution_kind==='passive'?'passive_existence':'requires_validated_learning_receipt'};
      r.public_projection_ref=id(resolution_id,'audience_projection');
      const event=this.#event(st,'ResolutionCommitted',{resolution_id,outcome:r.outcome_band,domain_receipts:r.domain_receipts},request.action_id,request.requested_at);
      for(const recipient of ['knowledge','memory','narrative']) st.delivery_and_recovery.outbox_entries.push({event:{event_id:event,resolution_id,observation_proposals:r.observation_proposals},recipient});
    });
  }
  #abort(resolution_id,request,reason) {
    const r=this.#read().resolution_result.find(x=>x.resolution_id===resolution_id);
    need(!r.domain_receipts.some(x=>x.accepted),'Cannot blindly compensate accepted owner effects','COMMIT_CONFLICT');
    const release=this.#call('core_turn','release',{resolution_id,idempotency_key:id(resolution_id,'release')});
    need(release.payload.accepted===true,'Reservation release pending','COMMIT_CONFLICT');
    this.#transaction(s=>{const result=s.resolution_result.find(x=>x.resolution_id===resolution_id); result.status='ABORTED'; result.abort_reason=reason; result.practice_eligibility={eligible:false,reason:'aborted'}; s.delivery_and_recovery.pending_choices=s.delivery_and_recovery.pending_choices.filter(x=>x.frozen_resolution!==resolution_id); this.#event(s,'ResolutionAborted',{resolution_id,reason,sample_retained:true},request.action_id,request.requested_at);});
  }
  resume(request,principal) {
    record('resolution_request',request,FIELDS.resolution_request); this.#authorize('resume',request,principal);
    const s=this.#read(), original=s.resolution_request.find(x=>x.request_id===request.request_id);
    need(original && canonical(original)===canonical(request),'Unknown/conflicting pending request','COMMIT_CONFLICT');
    const resultId=id(this.#branch,request.action_id,request.opportunity_id), r=s.resolution_result.find(x=>x.resolution_id===resultId);
    if(r.status==='AWAITING_CHOICE') {
      const choice=this.#call('core_turn','choice',{request,resolution_id:resultId}).payload;
      need(choice.authorized===true && choice.actor_id===request.actor_id && choice.resolution_id===resultId,'Unauthorized choice');
      if(r.admission_decision==='NEEDS_CHOICE') {
        // No performance has occurred. Owner must issue an explicitly chosen method.
        need(choice.action==='release_for_chosen_method','Admission choice must select a method');
        this.#abort(resultId,request,'method_choice_released');
      } else this.#transaction(st=> {
        const result=st.resolution_result.find(x=>x.resolution_id===resultId), snapshot=st.resolution_snapshot.find(x=>x.snapshot_hash===result.snapshot_hash), p=snapshot.frozen_result_policy.profile;
        need(result.continuation_options.some(x=>x.id===choice.option_id),'Choice is not a frozen option');
        const acceptedChoice=st.delivery_and_recovery.domain_acknowledgments.find(x=>x.command_id===id(resultId,'choice'));
        if(acceptedChoice) { need(acceptedChoice.receipt===choice.option_id,'Choice already settled','COMMIT_CONFLICT'); return; }
        for(const effect of p.effect_contracts.filter(x=>x.option===choice.option_id)) result.effect_proposals.push({owner:effect.owner,command_type:effect.command_type,parameters:effect.parameters,idempotency_key:id(resultId,'choice_effect',effect),preconditions:effect.preconditions,originating_resolution_id:resultId});
        st.delivery_and_recovery.domain_acknowledgments.push({command_id:id(resultId,'choice'),receipt:choice.option_id,accepted:true,owner:'core_turn'});
        st.delivery_and_recovery.pending_choices=st.delivery_and_recovery.pending_choices.filter(x=>x.frozen_resolution!==resultId);
        result.status='PREPARED'; result.continuation_options=[];
      });
    }
    this.#commit(resultId,request); return this.#view(resultId,request,principal);
  }
  #gate(s,r) {
    const definition=s.skill_definition.find(x=>x.skill_id===r.skill_id);
    need(definition,'Skill definition missing','RULESET_MISSING');
    const rubric=definition.training_milestones[r.rank];
    need(rubric && Array.isArray(rubric.criteria),'Explicit milestone rubric missing','RULESET_MISSING');
    const mandatory=[null,null,null,'independent_work','varied_technique','advanced_assessment','advanced_assessment','expert_assessment','exceptional_specialty','exceptional_assessment'][r.rank];
    if(mandatory) need(rubric.criteria.includes(mandatory),'Rubric omits required milestone','RULESET_MISSING');
    if(r.rank===6) need(rubric.criteria.includes('varied_evidence'),'Rank 6 requires varied evidence','RULESET_MISSING');
    if(r.rank===0 && definition.untrained_eligibility==='instruction_required') need(rubric.criteria.includes('basic_safe_instruction'),'Safe instruction rubric missing','RULESET_MISSING');
    const evidence=s.development_ledger.milestone_evidence.filter(x=>x.character_id===r.character_id&&x.skill_id===r.skill_id&&x.rank===r.rank&&x.accepted===true&&!x.consumed_by);
    const refs=s.practice_receipt.filter(x=>x.character_id===r.character_id&&x.skill_id===r.skill_id).map(x=>x.receipt_id);
    const contexts=new Set(s.practice_evidence_and_allocation.filter(x=>refs.includes(x.evidence_id)).flatMap(x=>x.task_context_refs));
    return {satisfied:(r.rank!==2||contexts.size>=2)&&rubric.criteria.every(c=>evidence.some(x=>x.criterion===c)),evidence:evidence.filter(x=>rubric.criteria.includes(x.criterion)),source_receipts:refs};
  }
  #promote(s,r,action,time) {
    if(r.rank===10 || r.practice_units<20*(r.rank+1)) return null;
    const gate=this.#gate(s,r); if(!gate.satisfied) return null;
    const previous=r.rank, units=20*(previous+1);
    r.practice_units-=units; r.rank++; r.revision++;
    const event=this.#event(s,'CapabilityChanged',{character_id:r.character_id,skill_id:r.skill_id,previous,new_value:r.rank,units_consumed:units,source_receipts:gate.source_receipts},action,time);
    for(const evidence of gate.evidence) evidence.consumed_by=event;
    s.development_ledger.advancement_events.push({event_id:event,character_id:r.character_id,skill_id:r.skill_id,previous_rank:previous,new_rank:r.rank,units_consumed:units,source_receipts:gate.source_receipts});
    const profile=s.capability_profile.find(x=>x.character_id===r.character_id); profile.revision++; profile.last_event_id=event;
    return event;
  }
  practice(command,principal) {
    only(command,['operation','source_event_id','character_id','simulation_time']); this.#authorize('practice',command,principal);
    const source=this.#call('npc_autonomy','practice_evidence',command).payload;
    need(source.source_event_id===command.source_event_id && source.character_id===command.character_id && source.branch_id===this.#branch,'Practice evidence identity mismatch');
    need(source.completed===true&&source.authorized===true&&source.learning_potential===true&&source.accepted_domain_receipt_ref&&source.learning_objective_ref,'Incomplete/nonlearning activity');
    need(Array.isArray(source.allocations)&&source.allocations.length>0&&source.allocations.length<=2,'Practice requires one or two explicitly allocated skills');
    need(new Set(source.allocations.map(x=>x.skill_id)).size===source.allocations.length,'Duplicate allocated skill');
    const start=timestamp(source.simulation_interval.start), end=timestamp(source.simulation_interval.end);
    need(end>start&&end<=timestamp(command.simulation_time),'Invalid effort interval');
    const ownerReceipt=this.#call(source.owner,'verify_practice_receipt',{receipt:source.accepted_domain_receipt_ref,source_event_id:source.source_event_id,character_id:source.character_id}).payload;
    need(ownerReceipt.accepted===true && ownerReceipt.completed===true,'Owner rejected practice receipt');
    const calendar=this.#call('core_turn','learning_day',{character_id:source.character_id,interval:source.simulation_interval}).payload;
    need(calendar.simulation_day_ref===source.simulation_day_ref&&calendar.within_single_day===true&&integer(calendar.event_sequence,0)&&calendar.event_sequence===source.event_sequence,'Canonical day/order certification required');
    return this.#transaction(s=> {
      const existing=s.practice_receipt.filter(x=>x.source_event_id===source.source_event_id&&x.character_id===source.character_id);
      if(existing.length) return {practice_receipt:existing};
      if(source.resolution_id) { const r=s.resolution_result.find(x=>x.resolution_id===source.resolution_id); need(r?.status==='COMMITTED'&&r.practice_eligibility.eligible===true,'Uncommitted, aborted, or passive activity'); }
      const relevant=s.practice_receipt.filter(x=>x.character_id===source.character_id), receiptIds=new Set(relevant.map(x=>x.receipt_id));
      const past=s.practice_evidence_and_allocation.filter(x=>receiptIds.has(x.evidence_id));
      need(!past.some(x=>x.effort_block_ref===source.effort_block_ref),'Effort block already consumed','COMMIT_CONFLICT');
      need(!past.some(x=>timestamp(x.simulation_interval.start)<end&&timestamp(x.simulation_interval.end)>start),'Overlapping effort blocks','COMMIT_CONFLICT');
      const today=past.filter(x=>x.simulation_day_ref===source.simulation_day_ref);
      need(today.every(x=>x.event_sequence<source.event_sequence),'Practice must arrive in canonical event order','COMMIT_CONFLICT');
      let base=1;
      if(source.kind==='brief_incident') need(source.verified_novel_objective===true,'Incident lacks verified new learning');
      else {
        need(['solo','supervised','work'].includes(source.kind),'Invalid practice category');
        need(end-start===30*60*1000,'Submit each certified 30-minute effort block separately');
        if(source.kind==='work') need(source.nontrivial_objective===true,'Trivial work grants no units');
        if(source.kind==='supervised') {
          need(source.instructor_ref && source.training_profile_valid===true,'Supervision requires a valid training profile');
          const eligible=source.allocations.every(x=>findRating(s,'skill_rating',source.instructor_ref,x.skill_id).rank>=findRating(s,'skill_rating',source.character_id,x.skill_id).rank+2);
          if(eligible) base=2;
        }
      }
      need(source.allocations.every(x=>integer(x.units,0,base)) && source.allocations.reduce((n,x)=>n+x.units,0)===base,'Explicit integer split must conserve the block award');
      let total=today.reduce((n,x)=>n+x.credited_units,0); const receipts=[];
      for(const allocation of source.allocations) {
        const rating=findRating(s,'skill_rating',source.character_id,allocation.skill_id);
        const skillReceipts=new Set(relevant.filter(x=>x.skill_id===allocation.skill_id).map(x=>x.receipt_id));
        const skillToday=today.filter(x=>skillReceipts.has(x.evidence_id));
        const skillTotal=skillToday.reduce((n,x)=>n+x.credited_units,0);
        const noveltyUsed=skillToday.some(x=>x.novel_incident_credit_used);
        let units=Math.min(allocation.units,6-skillTotal,12-total), reasons=[];
        if(units<allocation.units) reasons.push('daily_cap');
        if(source.kind==='brief_incident'&&noveltyUsed) { units=0; reasons.push('novel_incident_daily_cap'); }
        if(rating.rank===10) { units=0; reasons.push('maximum_rank'); }
        else if(!this.#gate(s,rating).satisfied) { const escrow=Math.max(0,20*(rating.rank+1)-rating.practice_units); if(units>escrow) reasons.push('milestone_escrow'); units=Math.min(units,escrow); }
        const receipt={receipt_id:id(this.#branch,source.source_event_id,source.character_id,allocation.skill_id),source_event_id:source.source_event_id,character_id:source.character_id,skill_id:allocation.skill_id,units,ruleset_id:s.system.ruleset_id};
        this.#db.prepare('INSERT INTO practice_identity VALUES (?,?,?,?)').run(receipt.source_event_id,receipt.character_id,receipt.skill_id,receipt.receipt_id);
        s.practice_receipt.push(receipt); receipts.push(receipt); total+=units;
        const evidence={evidence_id:receipt.receipt_id,accepted_domain_receipt_ref:source.accepted_domain_receipt_ref,effort_block_ref:source.effort_block_ref,simulation_interval:source.simulation_interval,simulation_day_ref:source.simulation_day_ref,event_sequence:source.event_sequence,learning_objective_ref:source.learning_objective_ref,learning_potential:true,task_context_refs:source.task_context_refs,instructor_ref:source.instructor_ref??null,instructor_rank_snapshot:source.instructor_ref?findRating(s,'skill_rating',source.instructor_ref,allocation.skill_id).rank:null,requested_units:allocation.units,credited_units:units,cap_deductions:{units:allocation.units-units,reasons},skill_daily_total:skillTotal+units,character_daily_total:total,novel_incident_credit_used:source.kind==='brief_incident'&&units>0,day_sequence_guard:source.event_sequence};
        s.practice_evidence_and_allocation.push(evidence); rating.practice_units+=units; rating.revision++;
        const practiceEvent=this.#event(s,'PracticeValidated',{receipt,evidence},source.source_event_id,command.simulation_time);
        const profile=s.capability_profile.find(x=>x.character_id===source.character_id); profile.revision++; profile.last_event_id=practiceEvent;
        this.#promote(s,rating,source.source_event_id,command.simulation_time);
      }
      return {practice_receipt:receipts};
    });
  }
  advance(command,principal) {
    only(command,['operation','character_id','skill_id','source_event_id','simulation_time']); this.#authorize('advance',command,principal);
    const assessment=this.#call('npc_autonomy','assessment',command).payload;
    need(assessment.accepted===true&&assessment.character_id===command.character_id&&assessment.skill_id===command.skill_id&&assessment.source_event_id===command.source_event_id&&assessment.branch_id===this.#branch,'Invalid assessment evidence');
    return this.#transaction(s=> {
      const rating=findRating(s,'skill_rating',command.character_id,command.skill_id);
      const old=s.development_ledger.milestone_evidence.filter(x=>x.source_event_id===command.source_event_id);
      if(!old.length) for(const criterion of assessment.criteria) {
        need(typeof criterion==='string'&&criterion.length>0,'Invalid criterion');
        s.development_ledger.milestone_evidence.push({character_id:command.character_id,skill_id:command.skill_id,rank:rating.rank,criterion,source_event_id:command.source_event_id,accepted:true,consumed_by:null});
      }
      const event=this.#promote(s,rating,command.source_event_id,command.simulation_time);
      return {skill_rating:rating,advancement_event:event};
    });
  }
  attributeProgram(command,principal) {
    only(command,['operation','record','simulation_time']); this.#authorize('attribute_program',command,principal,true);
    const program=command.record;
    only(program,['character_id','attribute_id','policy_ref','validated_session_refs','program_start_time','last_increase_time','health_feasibility_receipt','assessment_receipt']);
    const assessment=this.#call('health','attribute_program',program).payload;
    need(assessment.accepted===true&&assessment.assessment_receipt===program.assessment_receipt&&assessment.health_feasibility_receipt===program.health_feasibility_receipt,'Attribute feasibility/assessment rejected');
    const now=timestamp(command.simulation_time);
    return this.#transaction(s=> {
      const old=s.development_ledger.attribute_programs.find(x=>x.assessment_receipt===program.assessment_receipt);
      if(old) return old;
      const rating=findRating(s,'attribute_rating',program.character_id,program.attribute_id);
      need(rating.value<7,'Attribute cap');
      const prior=s.development_ledger.attribute_programs.filter(x=>x.character_id===program.character_id&&x.attribute_id===program.attribute_id);
      need(prior.every(x=>now-timestamp(x.last_increase_time)>=180*86400000),'Attribute increase cooldown');
      need(prior.every(x=>x.validated_session_refs.every(ref=>!program.validated_session_refs.includes(ref))),'Attribute session reused');
      need(new Set(program.validated_session_refs).size===program.validated_session_refs.length,'Duplicate attribute sessions');
      if(['Strength','Coordination','Endurance'].includes(program.attribute_id)) {
        need(program.validated_session_refs.length>=90 && now-timestamp(program.program_start_time)>=120*86400000,'Physical attribute program duration/session gate');
        need(assessment.sessions?.length===program.validated_session_refs.length,'Certified sessions missing');
        const ordered=[...assessment.sessions].sort((a,b)=>timestamp(a.start)-timestamp(b.start));
        for(const [index,session] of ordered.entries()) {
          need(program.validated_session_refs.includes(session.ref)&&session.completed===true&&timestamp(session.end)-timestamp(session.start)>=45*60000&&timestamp(session.end)<=now,'Invalid attribute session');
          if(index) need(timestamp(ordered[index-1].end)<=timestamp(session.start),'Overlapping attribute sessions');
        }
        need(timestamp(ordered.at(-1).end)-timestamp(ordered[0].start)>=120*86400000,'Validated sessions must span 120 simulation days');
      } else need(assessment.rubric_ref===program.policy_ref&&assessment.rubric_satisfied===true,'Nonphysical attribute requires its own rubric');
      const previous=rating.value; rating.value++; rating.revision++;
      const saved={...program,last_increase_time:command.simulation_time}; s.development_ledger.attribute_programs.push(saved);
      const event=this.#event(s,'CapabilityChanged',{character_id:program.character_id,attribute_id:program.attribute_id,previous,new_value:rating.value,assessment_receipt:program.assessment_receipt},program.assessment_receipt,command.simulation_time);
      const profile=s.capability_profile.find(x=>x.character_id===program.character_id); profile.revision++; profile.last_event_id=event;
      return saved;
    });
  }
  correct(command,principal) {
    only(command,['operation','record','simulation_time']); this.#authorize('correct',command,principal,true);
    const correction=command.record;
    only(correction,['supersedes_event_id','before','after','reason','authority','branch']);
    need(correction.branch===this.#branch&&correction.authority&&correction.reason,'Correction provenance required');
    return this.#transaction(s=> {
      need(s.event_envelope.some(x=>x.event_id===correction.supersedes_event_id),'Correction source missing');
      const before=correction.before, after=correction.after;
      const kind=Object.hasOwn(before,'skill_id')?'skill_rating':'attribute_rating';
      record(kind,before,FIELDS[kind]); record(kind,after,FIELDS[kind]);
      const capability=before.skill_id??before.attribute_id;
      const current=findRating(s,kind,before.character_id,capability);
      if(s.development_ledger.corrections.some(x=>canonical(x)===canonical(correction))) return current;
      need(canonical(current)===canonical(before),'Correction stale','STALE_REVISION');
      need(after.character_id===before.character_id&&(after.skill_id??after.attribute_id)===capability&&after.revision===before.revision+1,'Correction cannot change identity');
      Object.assign(current,after); s.development_ledger.corrections.push(clone(correction));
      const event=this.#event(s,'CapabilityChanged',{correction,earned:false},correction.supersedes_event_id,command.simulation_time);
      const profile=s.capability_profile.find(x=>x.character_id===before.character_id); profile.revision++; profile.last_event_id=event;
      return current;
    });
  }
  aggregate(command,principal) {
    only(command,['operation','record','simulation_time']); this.#authorize('aggregate',command,principal);
    record('aggregation_certificate',command.record,FIELDS.aggregation_certificate);
    const certificate=command.record;
    need(certificate.interruptions.length===0,'Split aggregation at interruption boundaries');
    need(new Set(certificate.effort_blocks).size===certificate.effort_blocks.length,'Duplicate effort blocks');
    need(timestamp(certificate.interval.end)>timestamp(certificate.interval.start),'Invalid aggregation interval');
    const validation=this.#call('npc_autonomy','certify_aggregation',certificate).payload;
    need(validation.accepted===true&&validation.event_id===certificate.event_id&&validation.equivalent_opportunities===true,'Invalid aggregation certificate');
    return this.#transaction(s=> {
      for(const ref of certificate.task_profile_versions) this.#profile(s,ref);
      const old=s.aggregation_certificate.find(x=>x.event_id===certificate.event_id);
      if(old) { need(canonical(old)===canonical(certificate),'Certificate identity conflict','COMMIT_CONFLICT'); return old; }
      need(s.aggregation_certificate.every(x=>!x.effort_blocks.some(b=>certificate.effort_blocks.includes(b))),'Aggregation effort overlap');
      s.aggregation_certificate.push(clone(certificate));
      // Certificates never award ranks or fabricate task results. Their component
      // requests/receipts enter resolve()/practice() through the identical paths.
      return certificate;
    });
  }
  flush(command,principal) {
    only(command,['operation']); this.#authorize('flush',command,principal,true);
    const entries=this.#read().delivery_and_recovery.outbox_entries;
    for(const entry of entries) {
      const key=id(entry.event.event_id,entry.recipient), state=this.#read();
      if(state.delivery_and_recovery.domain_acknowledgments.some(x=>x.command_id===key)) continue;
      const event=entry.recipient==='narrative' ? this.#call('knowledge','project_event',{event:entry.event,audience:'narrator'}).payload.public_projection : entry.event;
      need(event && typeof event==='object','Approved narrative projection missing');
      const delivery=this.#call(entry.recipient,'deliver',{idempotency_key:key,event});
      need(delivery.payload.accepted===true&&delivery.receipt,'Outbox delivery unacknowledged','COMMIT_CONFLICT');
      this.#transaction(s=> {
        if(s.delivery_and_recovery.domain_acknowledgments.some(x=>x.command_id===key)) return;
        s.delivery_and_recovery.domain_acknowledgments.push({command_id:key,receipt:delivery.receipt,accepted:true,owner:entry.recipient});
        s.delivery_and_recovery.consumer_cursors[entry.recipient]=entry.event.sequence??s.delivery_and_recovery.consumer_cursors[entry.recipient]??0;
      });
    }
    return {consumer_cursors:this.#read().delivery_and_recovery.consumer_cursors};
  }
  restore(command,principal) {
    only(command,['operation','source_event_id']); this.#authorize('restore',command,principal,true);
    const imported=this.#call('persistence','restore',command).payload;
    need(imported.validated===true&&imported.branch_id===this.#branch,'Restore requires owner-validated same-branch snapshot');
    const incoming=clone(imported.state); incoming.system.display_number=10; this.#validateState(incoming);
    need(incoming.system.ruleset_id==='capability_resolution/v1','Pinned ruleset missing','RULESET_MISSING');
    need(incoming.event_envelope.every(x=>x.branch_id===this.#branch),'Cross-branch receipt import prohibited');
    return this.#transaction(s=> {
      need(s.event_envelope.length===0&&s.resolution_request.length===0&&s.practice_receipt.length===0,'Restore requires fresh module storage');
      for(const request of incoming.resolution_request) {
        record('resolution_request',request,FIELDS.resolution_request);
        need(request.branch_id===this.#branch,'Foreign branch request');
        this.#profile(incoming,request.task_profile);
        this.#db.prepare('INSERT INTO request_identity VALUES (?,?,?)').run(this.#branch,request.request_id,digest(request));
      }
      for(const receipt of incoming.practice_receipt) this.#db.prepare('INSERT INTO practice_identity VALUES (?,?,?,?)').run(receipt.source_event_id,receipt.character_id,receipt.skill_id,receipt.receipt_id);
      Object.assign(s,incoming); return {restored:true};
    });
  }
  fork(command,principal) {
    only(command,['operation','branch_id','source_event_id']); this.#authorize('fork',command,principal,true);
    need(command.branch_id!==this.#branch,'Fork requires a new branch identity');
    const s=this.#read(); need(s.event_envelope.some(x=>x.event_id===command.source_event_id),'Unknown fork point');
    // Branch storage is external. Request an immutable fork; never rewrite this DB.
    return this.#call('persistence','fork',{source_branch_id:this.#branch,branch_id:command.branch_id,source_event_id:command.source_event_id,state:s}).payload;
  }
}
