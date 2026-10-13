/** Isolated System 24 coordinator.
 *
 * dispatch(command) accepts/returns JSON only. save() is a privileged host API,
 * never an actor query. Dependencies are immutable dummy-response endpoints.
 * No external module is imported, queried, modified, or simulated.
 *
 * Reference encoding profile:
 * - template versions: JSON.stringify([template ID, version]);
 * - stage references: JSON.stringify([action reference, stage]);
 * - audit payload references: inline JSON URNs, restricted to the coordinator.
 * Inline references make retries and save/reload self-contained without adding
 * a payload store or any other persistent state variable.
 */
import { z } from 'zod';
import { System24State, StateSchema, Schemas, Command, Boundary, Manifest, Action,
  Fact, Context, Ref, Integer, Condition, DEFAULT_LIMITS, GateError, requireThat,
  canonical, json, key, unique, runtime, leaves, validateCondition, validateTables
} from './contracts.mjs';
import { createMockDependencies } from './dependencies.mjs';

const terminal = new Set(['resolved', 'transformed', 'archived']);
const live = w => ['armed', 'fired', 'waiting_on_workflow'].includes(w.status);
const stageRef = (action, stage) => JSON.stringify([action, stage]);
const templateRef = t => JSON.stringify([t.id, t.version]);
const auditRef = data => `urn:system24:json:${Buffer.from(canonical(data)).toString('base64url')}`;
const auditData = ref => JSON.parse(Buffer.from(ref.slice('urn:system24:json:'.length), 'base64url'));
const list = z.array(Ref);
const payload = fields => z.strictObject(fields);
const withSituation = { situation_id: Ref };
const unsafeDelegation = new Set(['romance', 'testimony', 'crime', 'affiliation']);
const reasons = new Set(['missing_access', 'unavailable_binding', 'unsupported_method',
  'stale_state', 'disabled_content', 'pending_workflow', 'scope_limit', 'choice_required',
  'idempotency_conflict', 'invalid_contract']);

/** @typedef {{type:string, authority_ref:string, expected_revision:number|null,
 * canonical_time:number, correlation_id:string, idempotency_key:string,
 * payload:Record<string, import('zod').core.JSONType>}} CommandJSON
 */
export function createSystem24({ saved = null, dependencies = createMockDependencies() } = {}) {
  let state = new System24State(saved);
  assertState(state);
  // Serialization is process coordination, not additional simulation state.
  let tail = Promise.resolve();
  const api = Object.freeze({
    /** @param {CommandJSON} input @returns {Promise<object>} */
    dispatch(input) {
      const operation = tail.then(() => dispatch(input));
      tail = operation.catch(() => {});
      return operation;
    },
    /** Host-only persistence; contains restricted coordinator information. */
    save() { return state.toJSON(); }
  });

  async function dispatch(input) {
    let command;
    try { command = Command.parse(json(input)); }
    catch { return { status: 'rejected', reason: 'invalid_contract' }; }
    const draft = new System24State(state.toJSON());
    const environment = { draft, command, cache: new Map(), manifests: new Map(), boundary: null };
    try {
      const auth = await call('agency', 'read', { operation: 'authorize',
        authority_ref: command.authority_ref, command_type: command.type,
        situation_id: command.payload.situation_id ?? null });
      requireThat(auth.status === 'ok' && auth.authorized === true, 'missing_access');
      environment.auth = auth;
      const handler = handlers[command.type];
      requireThat(handler, 'unsupported_method');
      const actorCommand = ['GetKnownStory', 'GetAvailableOffers', 'GetKnownQuestions',
        'GetAcceptedCommitments', 'GetKnownSituationHistory', 'RespondToOffer', 'HideJournal'];
      if (!actorCommand.includes(command.type)) requireThat(auth.scope === 'coordinator', 'missing_access');
      const old = Object.values(draft.story_event).find(e => e.idempotency_key === command.idempotency_key);
      if (old) {
        const receipt = auditData(old.payload_ref);
        requireThat(receipt.command_hash === key('command', command), 'idempotency_conflict');
        const resumable = ['ResumeWorkflow', 'SurfaceOffer', 'RespondToOffer'].includes(command.type) &&
          ['pending', 'deferred', 'choice_required'].includes(receipt.response.status);
        if (!resumable) return json(receipt.response);
        // A pending receipt is a durable cursor, not a permanently cached failure.
        // Continue the same logical command while revalidating live owner state.
        environment.retry_receipt = true;
        delete draft.story_event[old.id];
      }
      if (command.payload.situation_id && !actorCommand.includes(command.type) && !environment.retry_receipt) {
        const instance = situation(environment, command.payload.situation_id);
        requireThat(command.expected_revision === instance.revision, 'stale_state');
      }
      const result = await handler(environment);
      if (command.type.startsWith('Get')) return json(result);
      const now = environment.boundary?.canonical_time ?? command.canonical_time;
      const event = {
        id: key('receipt', command.idempotency_key),
        situation_id: command.payload.situation_id ?? null,
        watcher_ref: command.payload.watcher_id ?? null,
        cause_refs: command.payload.cause_refs ?? [], occurred_at: command.canonical_time,
        processed_at: now, policy_version: 'system24-contract-v1',
        idempotency_key: command.idempotency_key,
        payload_ref: auditRef({ command_hash: key('command', command), response: result })
      };
      draft.story_event[event.id] = event;
      recount(draft);
      assertState(draft);
      state = draft;
      return json(result);
    } catch (error) {
      // Never return a predicate, hidden participant, owner exception or stack.
      return { status: 'rejected', reason: reasons.has(error.reason) ? error.reason : 'invalid_contract' };
    }
  }

  async function call(owner, direction, request) {
    try {
      const endpoint = dependencies[owner]?.[direction];
      if (!endpoint) return { status: 'pending' };
      return json(await endpoint(json(request)));
    } catch { return { status: 'pending' }; }
  }

  function situation(e, id) {
    const item = e.draft.situation[id];
    requireThat(item, 'unavailable_binding');
    return item;
  }
  function touch(e, id) { situation(e, id).revision++; }
  function queue(e, ref) {
    const r = e.draft.presentation_and_runtime.partition ??= runtime();
    r.deferred_review_refs = unique([...r.deferred_review_refs, ref]);
  }
  function dequeue(e, ref) {
    const r = e.draft.presentation_and_runtime.partition ??= runtime();
    r.deferred_review_refs = r.deferred_review_refs.filter(v => v !== ref);
  }
  function audit(e, name, sid, wid, causes, data, occurredAt = null) {
    const id = key('audit', name, sid, wid, causes, data);
    e.draft.story_event[id] ??= { id, situation_id: sid, watcher_ref: wid,
      cause_refs: causes, occurred_at: occurredAt ?? e.boundary?.canonical_time ?? e.command.canonical_time,
      processed_at: e.boundary?.canonical_time ?? e.command.canonical_time,
      policy_version: sid ? e.draft.instance_metadata[sid].activation_policy_version : 'system24-contract-v1',
      idempotency_key: id, payload_ref: auditRef({ name, ...data }) };
    return id;
  }

  async function clock(e, ref = 'current') {
    if (e.boundary) return e.boundary;
    const b = await call('system11', 'read', { operation: 'boundary', ref });
    requireThat(b.status === 'ok', 'pending_workflow');
    e.boundary = Boundary.parse(b);
    requireThat(e.command.canonical_time === b.canonical_time, 'stale_state');
    requireThat(new Set(b.events.map(x => x.id)).size === b.events.length, 'invalid_contract');
    // Time supplies order. Reject inconsistent chronology; never invent tie ordering.
    for (let i = 0; i < b.events.length; i++) {
      requireThat(b.events[i].occurred_at <= b.canonical_time, 'stale_state');
      if (i) requireThat(b.events[i - 1].occurred_at <= b.events[i].occurred_at, 'stale_state');
    }
    return e.boundary;
  }

  async function manifest(e, sid) {
    const s = situation(e, sid);
    if (e.manifests.has(s.template_version)) return e.manifests.get(s.template_version);
    const response = await call('authoring', 'read', { operation: 'manifest', ref: s.template_version });
    requireThat(response.status === 'ok', 'pending_workflow');
    const m = parseManifest(response.manifest, e.draft.versioned_policy_defaults);
    requireThat(m.version === s.template_version &&
      m.policy_version === e.draft.instance_metadata[sid].activation_policy_version, 'stale_state');
    const published = e.draft.story_event[key('manifest', s.template_version)];
    requireThat(published && auditData(published.payload_ref).manifest_hash === key('manifest-content', m), 'stale_state');
    // Disabled prospective content does not erase active instances or their effects.
    e.manifests.set(s.template_version, m);
    return m;
  }

  async function evaluate(e, ast, m, context = 'simulation') {
    validateCondition(ast, m, e.draft.versioned_policy_defaults);
    const b = await clock(e);
    const revisions = []; const missing = [];
    async function visit(node) {
      if (node.op !== 'predicate') {
        const values = [];
        for (const child of node.op === 'not' ? [node.arg] : node.args) values.push(await visit(child));
        if (node.op === 'not') return m.truth_tables.not[String(values[0])];
        return values.slice(1).reduce((a, v) => m.truth_tables[node.op][`${a},${v}`], values[0]);
      }
      const cacheKey = canonical([b.snapshot_ref, context, node]);
      let fact = e.cache.get(cacheKey);
      if (!fact) {
        let access = null;
        if (context !== 'simulation') {
          access = await call('knowledge', 'read', { operation: 'predicate_access',
            ref: node.access_ref, actor_id: context.actor_id, entity_ref: node.entity_ref,
            predicate_ref: node.predicate_ref, snapshot_ref: b.snapshot_ref });
          if (access.status !== 'ok' || access.allowed !== true || access.actor_id !== context.actor_id)
            return 'unknown';
        }
        const response = await call(node.owner, 'read', { operation: 'predicate',
          ref: node.predicate_ref, entity_ref: node.entity_ref, scope_ref: node.scope_ref,
          read_context: context, snapshot_ref: b.snapshot_ref, canonical_time: b.canonical_time,
          joins: node.joins });
        if (response.status !== 'ok') return 'unknown';
        fact = Fact.parse(response);
        requireThat(fact.owner === node.owner && fact.entity_ref === node.entity_ref &&
          fact.predicate_ref === node.predicate_ref && fact.scope_ref === node.scope_ref &&
          canonical(fact.read_context) === canonical(context) && fact.snapshot_ref === b.snapshot_ref &&
          fact.canonical_time === b.canonical_time, 'stale_state');
        requireThat(b.revisions.some(r => r.owner === fact.owner && r.entity_ref === fact.entity_ref &&
          r.revision === fact.revision), 'stale_state');
        if (context !== 'simulation') {
          requireThat(fact.value === 'unknown' || (fact.acquired_source_refs.length > 0 &&
            fact.acquired_source_refs.every(r => access.acquired_source_refs?.includes(r))), 'missing_access');
        }
        e.cache.set(cacheKey, fact);
      }
      revisions.push({ owner: fact.owner, entity_ref: fact.entity_ref, revision: fact.revision });
      if (!fact.exists) { missing.push(node.entity_ref); return 'unknown'; }
      return fact.value;
    }
    return { value: await visit(ast), missing,
      revisions: [...new Map(revisions.map(r => [canonical(r), r])).values()] };
  }

  async function committedCauses(e, refs) {
    requireThat(refs.length > 0, 'unavailable_binding');
    const r = await call('authoring', 'read', { operation: 'committed_causes', refs });
    requireThat(r.status === 'ok' && r.committed === true &&
      refs.every(ref => r.event_refs?.includes(ref)), 'pending_workflow');
  }

  async function validBindings(e, sid, bindings = null) {
    const instance = situation(e, sid);
    const source = bindings ?? bindingList(e.draft, instance.bindings_ref);
    const m = await manifest(e, sid);
    requireThat(m.required_roles.every(role => source.some(b => b.role_ref === role)), 'unavailable_binding');
    requireThat(new Set(source.map(b => b.role_ref)).size === source.length, 'unavailable_binding');
    for (const binding of source) {
      const response = await call('agency', 'read', { operation: 'binding',
        ref: binding.participant_ref, binding, canonical_time: e.command.canonical_time });
      requireThat(response.status === 'ok' && response.exists === true && response.compatible === true &&
        response.authorized === true && response.knowledge_valid === true && response.task_accepted === true,
      'unavailable_binding');
    }
  }

  async function publishTemplate(e) {
    const p = payload({ template: Schemas.situation_template }).parse(e.command.payload);
    const ref = templateRef(p.template);
    const response = await call('authoring', 'read', { operation: 'manifest', ref });
    requireThat(response.status === 'ok', 'pending_workflow');
    const m = parseManifest(response.manifest, e.draft.versioned_policy_defaults);
    requireThat(m.version === ref && m.enabled && m.supported, 'disabled_content');
    requireThat(!e.draft.situation_template[ref], 'stale_state');
    e.draft.situation_template[ref] = p.template;
    const id = key('manifest', ref);
    e.draft.story_event[id] = { id, situation_id: null, watcher_ref: null, cause_refs: [],
      occurred_at: e.command.canonical_time, processed_at: e.command.canonical_time,
      policy_version: m.policy_version, idempotency_key: id,
      payload_ref: auditRef({ manifest_hash: key('manifest-content', m) }) };
    return { status: 'ok', template_version: ref };
  }

  async function instantiate(e) {
    const p = payload({ instance: Schemas.situation, metadata: Schemas.instance_metadata,
      bindings: z.array(Schemas.participant_binding), cause_refs: list }).parse(e.command.payload);
    requireThat(!e.draft.situation[p.instance.id] && e.draft.situation_template[p.instance.template_version], 'stale_state');
    requireThat(p.instance.state === 'proposed' && p.instance.revision === 0 &&
      p.metadata.outcome_history_refs.length === 0 &&
      p.metadata.lineage_refs.length === 0 && p.metadata.migration_event_refs.length === 0 &&
      p.metadata.pending_choice_ref === null);
    requireThat(canonical(p.cause_refs) === canonical(p.metadata.creation_cause_refs));
    await clock(e); await committedCauses(e, p.cause_refs);
    for (const ref of p.instance.owner_commitments) {
      const r = await call('agency', 'read', { operation: 'existing_commitment', ref });
      requireThat(r.status === 'ok' && r.committed === true && r.accepted_terms_ref, 'pending_workflow');
    }
    e.draft.situation[p.instance.id] = p.instance;
    e.draft.instance_metadata[p.instance.id] = p.metadata;
    const m = await manifest(e, p.instance.id);
    requireThat(m.enabled && m.supported, 'disabled_content');
    await validBindings(e, p.instance.id, p.bindings);
    const checked = await evaluate(e, m.activation_condition, m);
    requireThat(checked.value === true && checked.missing.length === 0, 'unavailable_binding');
    requireThat(canonical(p.metadata.initial_snapshot_refs) === canonical(checked.revisions), 'stale_state');
    for (const ref of p.metadata.restricted_fact_refs) {
      const r = await call('authoring', 'read', { operation: 'seeded_fact', ref });
      requireThat(r.status === 'ok' && r.committed === true, 'pending_workflow');
    }
    requireThat(p.instance.pressure_refs.length > 0, 'unavailable_binding');
    for (const ref of p.instance.pressure_refs) {
      const r = await call('authoring', 'read', { operation: 'pressure_definition', ref });
      requireThat(r.status === 'ok', 'pending_workflow');
      const d = Schemas.pressure_and_outcome_definitions.parse(r.definition);
      requireThat(d.cause_refs.length > 0 && d.cause_refs.every(x => p.cause_refs.includes(x)));
      const previous = e.draft.pressure_and_outcome_definitions[ref];
      requireThat(!previous || canonical(previous) === canonical(d), 'stale_state');
      e.draft.pressure_and_outcome_definitions[ref] = d;
    }
    for (const binding of p.bindings) {
      const id = key('binding', p.instance.bindings_ref, binding.role_ref);
      requireThat(!e.draft.participant_binding[id], 'stale_state');
      e.draft.participant_binding[id] = binding;
    }
    p.instance.state = 'active';
    touch(e, p.instance.id);
    return { status: 'ok', situation_id: p.instance.id, revision: p.instance.revision };
  }

  async function registerWatcher(e) {
    const p = payload({ ...withSituation, watcher: Schemas.watcher,
      metadata: Schemas.watcher_metadata }).parse(e.command.payload);
    const s = situation(e, p.situation_id); const w = p.watcher; const meta = p.metadata;
    requireThat(!terminal.has(s.state) && !e.draft.watcher[w.id], 'stale_state');
    requireThat(w.situation_id === s.id && w.status === 'dormant' && w.edge_ordinal === 0 &&
      w.last_value === 'unknown' && w.last_revision === null && w.pending_workflow === null);
    requireThat(meta.last_evaluated_at === null && meta.snapshot_revision_refs.length === 0 &&
      meta.fired_cause_ids.length === 0 && meta.edge_history_refs.length === 0 &&
      meta.trigger_key === null && meta.suspension_reason_ref === null && meta.retirement_reason_ref === null);
    const m = await manifest(e, s.id); const rule = m.watcher_rules[w.version];
    requireThat(rule && rule.kind === meta.kind && rule.trigger_policy === w.trigger_policy &&
      canonical(rule.condition) === canonical(w.condition_ast) && rule.rearm_policy_ref === meta.rearm_policy_ref);
    requireThat(meta.allowed_output_categories.length === 1 &&
      meta.allowed_output_categories[0] === rule.output_category);
    if (w.read_context === 'simulation') requireThat(meta.visibility === 'internal', 'missing_access');
    const ast = validateCondition(w.condition_ast, m, e.draft.versioned_policy_defaults);
    const subscriptions = leaves(ast).flatMap(l => l.dependency_events);
    requireThat(subscriptions.every(x => w.subscriptions.some(y => canonical(x) === canonical(y))));
    requireThat(w.subscriptions.every(x => subscriptions.some(y => canonical(x) === canonical(y))));
    requireThat(leaves(ast).every(l => l.scope_ref === w.scope_ref));
    if (w.trigger_policy === 'cadenced_level') requireThat(rule.cadence !== null && meta.next_review_at !== null);
    if (w.trigger_policy === 'due_time') {
      requireThat(rule.deadline_ref && e.draft.deadline[rule.deadline_ref]);
      meta.next_review_at = e.draft.deadline[rule.deadline_ref].due_at;
    }
    await validBindings(e, s.id);
    e.draft.watcher[w.id] = w; e.draft.watcher_metadata[w.id] = meta;
    if (hasCapacity(e.draft, s.id)) w.status = 'armed';
    else queue(e, `watcher:${w.id}`);
    touch(e, s.id);
    return { status: w.status === 'armed' ? 'ok' : 'deferred', watcher_id: w.id };
  }

  async function processBoundary(e) {
    const p = payload({ boundary_ref: Ref }).parse(e.command.payload);
    const b = await clock(e, p.boundary_ref);
    const r = e.draft.presentation_and_runtime[`boundary:${b.boundary_ref}`] ??= runtime();
    for (const w of Object.values(e.draft.watcher)) if (w.status === 'dormant' && hasCapacity(e.draft, w.situation_id)) {
      w.status = 'armed'; dequeue(e, `watcher:${w.id}`);
    }
    // Rebuildable, entity-scoped subscription index. Never scan foreign city state.
    const index = new Map();
    for (const w of Object.values(e.draft.watcher)) if (live(w) || w.status === 'dormant')
      for (const sub of w.subscriptions) {
        const k = canonical(sub); const ids = index.get(k) ?? new Set(); ids.add(w.id); index.set(k, ids);
      }
    const selected = new Map();
    for (const event of b.events) {
      const eventKey = key('owner-event', event.id);
      const previous = e.draft.story_event[eventKey];
      if (previous) requireThat(auditData(previous.payload_ref).event_hash === key('event', event), 'stale_state');
      else e.draft.story_event[eventKey] = { id: eventKey, situation_id: null, watcher_ref: null,
        cause_refs: event.cause_refs, occurred_at: event.occurred_at, processed_at: b.canonical_time,
        policy_version: 'system24-contract-v1', idempotency_key: eventKey,
        payload_ref: auditRef({ event_hash: key('event', event), event }) };
      queue(e, `event:${eventKey}`);
    }
    const pendingEvents = (e.draft.presentation_and_runtime.partition?.deferred_review_refs ?? [])
      .filter(ref => ref.startsWith('event:'));
    for (const ref of pendingEvents) {
      const stored = e.draft.story_event[ref.slice('event:'.length)];
      requireThat(stored, 'invalid_contract');
      const event = auditData(stored.payload_ref).event;
      for (const id of index.get(canonical({ owner: event.owner, entity_ref: event.entity_ref,
        event_type: event.event_type })) ?? []) selected.set(id, unique([...(selected.get(id) ?? []), event.id]));
    }
    for (const w of Object.values(e.draft.watcher)) {
      const meta = e.draft.watcher_metadata[w.id];
      if ((live(w) || w.status === 'dormant') && meta.next_review_at !== null && meta.next_review_at <= b.canonical_time)
        selected.set(w.id, selected.get(w.id) ?? []);
      const pending = e.draft.presentation_and_runtime.partition?.deferred_review_refs ?? [];
      if (pending.includes(`watcher:${w.id}`) && ['armed', 'fired'].includes(w.status)) selected.set(w.id, selected.get(w.id) ?? []);
    }
    if (b.paused || b.choice_required || b.material_interruption) {
      for (const id of selected.keys()) queue(e, `watcher:${id}`);
      return { status: b.paused ? 'paused' : 'choice_required' };
    }
    const deadlineResults = await dueDeadlines(e);
    const reports = [];
    if (r.follow_on_rounds_at_boundary >= e.draft.versioned_policy_defaults.max_follow_on_rounds_per_boundary) {
      for (const id of selected.keys()) queue(e, `watcher:${id}`);
      return { status: 'deferred', deadlines: deadlineResults };
    }
    r.follow_on_rounds_at_boundary++;
    for (const [id, causes] of selected) {
      const w = e.draft.watcher[id];
      if (w.status === 'dormant') { queue(e, `watcher:${id}`); continue; }
      if (w.status === 'waiting_on_workflow') { queue(e, `workflow:${w.pending_workflow}`); continue; }
      try { reports.push(await evaluateWatcher(e, w, causes)); }
      catch (error) {
        queue(e, `watcher:${id}`);
        audit(e, 'watcher_pending', w.situation_id, id, causes, { reason: reasons.has(error.reason) ? error.reason : 'invalid_contract' });
      }
    }
    for (const ref of pendingEvents) {
      const event = auditData(e.draft.story_event[ref.slice('event:'.length)].payload_ref).event;
      const targets = index.get(canonical({ owner: event.owner, entity_ref: event.entity_ref, event_type: event.event_type })) ?? [];
      const pending = e.draft.presentation_and_runtime.partition.deferred_review_refs;
      if ([...targets].every(id => !pending.includes(`watcher:${id}`))) dequeue(e, ref);
    }
    return { status: 'ok', reviews: reports, deadlines: deadlineResults };
  }

  async function evaluateWatcher(e, w, causes) {
    const m = await manifest(e, w.situation_id); const rule = m.watcher_rules[w.version];
    const meta = e.draft.watcher_metadata[w.id]; const b = e.boundary;
    const evaluated = await evaluate(e, w.condition_ast, m, w.read_context);
    if (evaluated.missing.length) {
      queue(e, `binding-review:${w.situation_id}`);
      audit(e, 'missing_binding', w.situation_id, w.id, causes, { snapshot_ref: b.snapshot_ref });
    }
    const revision = key('evaluation', evaluated.revisions, evaluated.value);
    const previous = w.last_value;
    if (canonical(meta.snapshot_revision_refs) === canonical(evaluated.revisions) && w.last_revision !== null &&
      evaluated.revisions.length > 0 && !evaluated.missing.length)
      requireThat(previous === evaluated.value, 'stale_state');
    const due = rule.deadline_ref ? e.draft.deadline[rule.deadline_ref] : null;
    if (due) {
      const current = await call(due.owner_ref, 'read', { operation: 'current_deadline', ref: due.id });
      requireThat(current.status === 'ok', 'pending_workflow');
      if (current.version !== due.version || current.cancelled === true) {
        w.status = 'retired'; meta.retirement_reason_ref = 'deadline_version_superseded';
        meta.next_review_at = null; dequeue(e, `watcher:${w.id}`);
        return { watcher_id: w.id, status: 'retired' };
      }
    }
    const dueKey = due ? key('deadline-edge', due.id, due.version) : null;
    const cadenceKey = key('cadence', w.id, meta.next_review_at);
    let fire = evaluated.value === true;
    if (w.trigger_policy === 'rising_edge') fire &&= previous !== true && revision !== w.last_revision;
    else if (w.trigger_policy === 'single_fire') fire &&= meta.edge_history_refs.length === 0;
    else if (w.trigger_policy === 'due_time') fire &&= !!due && b.canonical_time >= due.due_at &&
      !meta.fired_cause_ids.includes(dueKey);
    else fire &&= meta.next_review_at !== null && b.canonical_time >= meta.next_review_at &&
      !meta.fired_cause_ids.includes(cadenceKey) && (revision !== w.last_revision || causes.length > 0);
    w.last_value = evaluated.value; w.last_revision = revision;
    meta.last_evaluated_at = b.canonical_time; meta.snapshot_revision_refs = evaluated.revisions;
    dequeue(e, `watcher:${w.id}`);
    const retry = w.status === 'fired' && evaluated.value === true;
    if (!fire && !retry) return { watcher_id: w.id, status: 'observed' };
    const cause = dueKey ?? (w.trigger_policy === 'cadenced_level' ? cadenceKey : key('causes', causes));
    if (due && causes.length === 0) causes = [...due.cause_refs];
    if (retry && causes.length === 0) causes = [...meta.fired_cause_ids];
    const loop = key('proposal-state', w.id, revision, rule.output_category,
      situation(e, w.situation_id).state, cause);
    if (!retry && e.draft.story_event[loop]) {
      w.status = 'disarmed'; meta.suspension_reason_ref = 'unchanged_proposal_loop';
      return { watcher_id: w.id, status: 'suspended' };
    }
    if (!retry) {
      e.draft.story_event[loop] = { id: loop, situation_id: w.situation_id, watcher_ref: w.id,
      cause_refs: causes, occurred_at: b.canonical_time, processed_at: b.canonical_time,
      policy_version: m.policy_version, idempotency_key: loop,
        payload_ref: auditRef({ name: 'proposal_guard', revision, cause }) };
      w.edge_ordinal++;
      meta.trigger_key = key('trigger', w.id, w.edge_ordinal, cause);
      const edge = audit(e, 'watcher_edge', w.situation_id, w.id, causes,
        { value: evaluated.value, previous, revisions: evaluated.revisions, trigger_key: meta.trigger_key });
      meta.edge_history_refs.push(edge); meta.fired_cause_ids = unique([...meta.fired_cause_ids, ...causes, cause]);
      if (rule.cadence) meta.next_review_at = b.canonical_time + rule.cadence;
      w.status = 'fired';
    }
    if (rule.output_category === 'review_outcome') {
      const result = await assess(e, w.situation_id, rule.outcome_scope, causes);
      if (result.status === 'ok') {
        if (w.trigger_policy === 'single_fire') { w.status = 'retired'; meta.retirement_reason_ref = result.assessment_id; }
        else w.status = 'armed';
      } else { queue(e, `watcher:${w.id}`); }
      return { watcher_id: w.id, ...result };
    }
    if (rule.action_ref) {
      const workflow = await startWorkflow(e, w.situation_id, w.id, rule.action_ref, causes);
      w.pending_workflow = workflow.id; w.status = 'waiting_on_workflow';
      queue(e, `workflow:${workflow.id}`);
      return { watcher_id: w.id, status: 'pending', workflow_id: workflow.id };
    }
    // Internal review only; never emit hidden truth to the UI or NPC planner.
    queue(e, `review:${meta.trigger_key}`);
    w.status = 'armed';
    return { watcher_id: w.id, status: 'proposed', proposal_ref: meta.trigger_key };
  }

  async function assess(e, sid, scope, causes) {
    const m = await manifest(e, sid); const definition = m.outcomes[scope];
    requireThat(definition, 'unsupported_method');
    const result = await evaluate(e, definition.condition, m);
    if (result.value !== true) return { status: 'pending', reason: 'pending_workflow' };
    const basis = await call('authoring', 'read', { operation: 'outcome_basis', ref: scope,
      situation_id: sid, snapshot_ref: e.boundary.snapshot_ref, revisions: result.revisions });
    requireThat(basis.status === 'ok' && basis.committed === true && basis.owner_event_refs?.length > 0 &&
      basis.snapshot_ref === e.boundary.snapshot_ref, 'pending_workflow');
    const id = key('assessment', sid, scope, definition.predicate_version, result.revisions);
    if (!e.draft.outcome_assessment[id]) {
      e.draft.outcome_assessment[id] = { id, situation_id: sid, scope_ref: scope,
        predicate_version: definition.predicate_version, owner_event_refs: basis.owner_event_refs,
        conclusion: definition.conclusion, limitations_ref: definition.limitations_ref,
        occurred_at: e.boundary.canonical_time };
      e.draft.instance_metadata[sid].outcome_history_refs.push(id);
      audit(e, 'outcome_assessed', sid, null, causes, { assessment_id: id, revisions: result.revisions });
      touch(e, sid);
    }
    dequeue(e, `outcome:${sid}:${scope}`);
    // Assessment is scoped; it does not infer a full-instance transition or reward.
    return { status: 'ok', assessment_id: id };
  }

  async function reviewOutcome(e) {
    const p = payload({ ...withSituation, scope_ref: Ref, cause_refs: list }).parse(e.command.payload);
    await clock(e); await committedCauses(e, p.cause_refs);
    return assess(e, p.situation_id, p.scope_ref, p.cause_refs);
  }

  async function transition(e) {
    const p = payload({ ...withSituation, to: Schemas.situation.shape.state,
      cause_refs: list, lineage_refs: list }).parse(e.command.payload);
    const s = situation(e, p.situation_id); const m = await manifest(e, s.id);
    await clock(e); await committedCauses(e, p.cause_refs);
    requireThat(p.to !== s.state, 'stale_state');
    const rule = m.transition_rules.find(r => r.from === s.state && r.to === p.to);
    requireThat(rule, 'unsupported_method');
    const basis = await evaluate(e, rule.condition, m);
    requireThat(basis.value === true && !basis.missing.length, 'pending_workflow');
    if (p.to === 'active') await validBindings(e, s.id);
    if (p.to === 'resolved') {
      requireThat(rule.outcome_scope, 'unsupported_method');
      requireThat((await assess(e, s.id, rule.outcome_scope, p.cause_refs)).status === 'ok', 'pending_workflow');
    }
    if (p.to === 'resolving') requireThat(Object.values(e.draft.durable_workflow)
      .some(w => w.situation_id === s.id && JSON.parse(w.pending_stage_ref)[1] !== 'complete'), 'pending_workflow');
    if (p.to === 'transformed') {
      requireThat(p.lineage_refs.length > 0, 'unavailable_binding');
      for (const id of p.lineage_refs) {
        requireThat(id !== s.id && e.draft.situation[id], 'unavailable_binding');
        const child = e.draft.instance_metadata[id];
        requireThat(child.creation_cause_refs.some(c => p.cause_refs.includes(c)), 'unavailable_binding');
        child.lineage_refs = unique([...child.lineage_refs, s.id]);
      }
    } else requireThat(p.lineage_refs.length === 0);
    const meta = e.draft.instance_metadata[s.id];
    meta.lineage_refs = unique([...meta.lineage_refs, ...p.lineage_refs]);
    audit(e, 'transition', s.id, null, p.cause_refs, { from: s.state, to: p.to,
      remaining_scopes: rule.remaining_scopes, lineage_refs: p.lineage_refs, revisions: basis.revisions });
    s.state = p.to; touch(e, s.id);
    if (terminal.has(s.state)) terminalCleanup(e, s.id);
    return { status: 'ok', state: s.state, revision: s.revision };
  }

  function terminalCleanup(e, sid) {
    for (const w of Object.values(e.draft.watcher)) if (w.situation_id === sid) {
      w.status = 'retired'; e.draft.watcher_metadata[w.id].retirement_reason_ref = `situation:${situation(e, sid).state}`;
      // Foreign workflows stay pending and can settle after retirement.
      if (w.pending_workflow) queue(e, `workflow:${w.pending_workflow}`);
    }
    for (const w of Object.values(e.draft.durable_workflow)) if (w.situation_id === sid &&
      (w.reservation_refs.length || JSON.parse(w.pending_stage_ref)[1] !== 'complete')) {
      w.terminal_cleanup_state_ref = 'release_unused_pending';
      queue(e, `workflow:${w.id}`);
    }
  }

  async function actionDefinition(e, sid, ref) {
    const m = await manifest(e, sid);
    requireThat(m.allowed_action_refs.includes(ref), 'unsupported_method');
    const r = await call('authoring', 'read', { operation: 'action', ref });
    requireThat(r.status === 'ok', 'pending_workflow');
    const a = Action.parse(r.action);
    requireThat(a.action_ref === ref && !['authoring', 'ui', 'knowledge'].includes(a.owner));
    const id = key('action-definition', ref); const previous = e.draft.story_event[id];
    const hash = key('action-content', a);
    if (previous) requireThat(auditData(previous.payload_ref).action_hash === hash, 'stale_state');
    else e.draft.story_event[id] = { id, situation_id: sid, watcher_ref: null, cause_refs: [],
      occurred_at: e.command.canonical_time, processed_at: e.command.canonical_time,
      policy_version: m.policy_version, idempotency_key: id, payload_ref: auditRef({ action_hash: hash }) };
    return a;
  }

  async function actionGates(e, workflow, a) {
    await validBindings(e, workflow.situation_id);
    const response = await call('agency', 'read', { operation: 'validate_action', ref: a.action_ref,
      authority_ref: workflow.authority_ref, expected_revision_refs: workflow.expected_revision_refs,
      canonical_time: e.boundary.canonical_time, explicit_response_ref: a.explicit_response_ref,
      delegation_ref: a.delegation_ref });
    requireThat(response.status === 'ok' && response.authorized === true &&
      response.prerequisites_valid === true && response.revisions_current === true &&
      response.content_allowed === true, 'pending_workflow');
    if (a.actor_action) {
      const knowledge = await call('knowledge', 'read', { operation: 'action_basis',
        ref: a.action_ref, actor_id: a.actor_id, acquired_source_refs: a.knowledge_basis_refs,
        canonical_time: e.boundary.canonical_time });
      requireThat(knowledge.status === 'ok' && knowledge.valid === true &&
        knowledge.actor_id === a.actor_id && a.knowledge_basis_refs.length > 0, 'missing_access');
    }
    if (a.player_action || a.requires_choice) {
      const explicit = a.explicit_response_ref && response.explicit_response_ref === a.explicit_response_ref &&
        response.explicit === true && response.action_ref === a.action_ref && response.actor_id === a.actor_id;
      const delegated = a.delegation_ref && response.delegation_valid === true && !a.requires_choice &&
        !a.scope_expanded && !unsafeDelegation.has(a.category);
      if (!explicit && !delegated) {
        e.draft.instance_metadata[workflow.situation_id].pending_choice_ref = a.action_ref;
        throw new GateError('choice_required');
      }
    }
  }

  async function startWorkflow(e, sid, watcherID, actionRef, causes) {
    const a = await actionDefinition(e, sid, actionRef);
    requireThat(causes.length > 0, 'pending_workflow');
    // Owner effects deduplicate by their agreement/task scope across watchers AND instances.
    const effect = key('effect', a.owner, a.effect_scope_ref, a.operation, a.terms_ref);
    const id = key('workflow', sid, effect);
    const existing = e.draft.durable_workflow[id];
    if (existing) return existing;
    const w = { id, situation_id: sid, watcher_ref: watcherID, cause_refs: causes,
      authority_ref: e.command.authority_ref, knowledge_basis_refs: a.knowledge_basis_refs,
      expected_revision_refs: e.boundary.revisions, canonical_time: e.boundary.canonical_time,
      correlation_id: e.command.correlation_id, idempotency_key: key('workflow-command', id),
      effect_keys: [effect], reservation_refs: [], completed_stage_refs: [],
      pending_stage_ref: stageRef(actionRef, 'validate'), committed_owner_result_refs: [],
      pending_delivery_refs: [], terminal_cleanup_state_ref: null };
    e.draft.durable_workflow[id] = w;
    return w;
  }

  async function beginWorkflow(e) {
    const p = payload({ ...withSituation, action_ref: Ref, cause_refs: list }).parse(e.command.payload);
    await clock(e); await committedCauses(e, p.cause_refs);
    requireThat(!terminal.has(situation(e, p.situation_id).state), 'unavailable_binding');
    const w = await startWorkflow(e, p.situation_id, null, p.action_ref, p.cause_refs);
    queue(e, `workflow:${w.id}`); touch(e, p.situation_id);
    return { status: 'pending', workflow_id: w.id };
  }

  async function resumeWorkflow(e) {
    const p = payload({ ...withSituation, workflow_id: Ref, response_ref: Ref.optional() }).parse(e.command.payload);
    const w = e.draft.durable_workflow[p.workflow_id];
    requireThat(w && w.situation_id === p.situation_id, 'unavailable_binding');
    await clock(e);
    const [ref] = JSON.parse(w.pending_stage_ref);
    // Persist every completed stage even if a later dependency is unavailable.
    try {
      const a = await actionDefinition(e, w.situation_id, ref);
      const choice = w.completed_stage_refs.find(x => x.startsWith('choice:'));
      if (choice) a.explicit_response_ref = JSON.parse(choice.slice('choice:'.length));
      if (p.response_ref) {
        requireThat(!choice || a.explicit_response_ref === p.response_ref, 'stale_state');
        a.explicit_response_ref = p.response_ref;
      }
      for (;;) {
        const [, stage] = JSON.parse(w.pending_stage_ref);
        const envelope = { situation_id: w.situation_id, watcher_id: w.watcher_ref,
          cause_refs: w.cause_refs, authority_ref: w.authority_ref,
          expected_revision_refs: w.expected_revision_refs, canonical_time: e.boundary.canonical_time,
          correlation_id: w.correlation_id, idempotency_key: w.idempotency_key,
          effect_key: w.effect_keys[0], knowledge_basis_refs: w.knowledge_basis_refs, ref };
        if (stage === 'cancelled') return { status: 'cancelled', workflow_id: w.id };
        if (stage === 'complete') {
          await cleanupReservations(e, w, a, envelope);
          settleWatchers(e, w);
          dequeue(e, `workflow:${w.id}`);
          return { status: 'ok', workflow_id: w.id };
        }
        if (terminal.has(situation(e, w.situation_id).state) && ['validate', 'reserve', 'request'].includes(stage)) {
          // Before cancellation, reconcile a possibly committed, unacknowledged
          // request. Never roll back a material effect merely to close a story.
          const effect = e.draft.story_event[key('effect-commit', w.effect_keys[0])];
          if (effect) {
            w.committed_owner_result_refs = auditData(effect.payload_ref).owner_event_refs;
            w.pending_stage_ref = stageRef(ref, 'attach');
            continue;
          }
          if (stage === 'request') {
            const status = await call(a.owner, 'read', { operation: 'effect_status', ref: w.effect_keys[0] });
            if (status.status === 'committed') {
              requireThat(status.effect_key === w.effect_keys[0] && status.owner_event_refs?.length, 'pending_workflow');
              w.committed_owner_result_refs = list.parse(status.owner_event_refs);
              const id = key('effect-commit', w.effect_keys[0]);
              e.draft.story_event[id] = { id, situation_id: w.situation_id, watcher_ref: w.watcher_ref,
                cause_refs: w.cause_refs, occurred_at: Integer.parse(status.occurred_at),
                processed_at: e.boundary.canonical_time, policy_version: (await manifest(e, w.situation_id)).policy_version,
                idempotency_key: id, payload_ref: auditRef({ owner_event_refs: w.committed_owner_result_refs }) };
              w.pending_stage_ref = stageRef(ref, 'attach');
              continue;
            }
            requireThat(status.status === 'not_committed', 'pending_workflow');
          }
          if (w.reservation_refs.length) await cleanupReservations(e, w, a, envelope);
          else w.terminal_cleanup_state_ref = 'unused_released';
          w.pending_stage_ref = stageRef(ref, 'cancelled');
          settleWatchers(e, w); dequeue(e, `workflow:${w.id}`);
          return { status: 'cancelled', workflow_id: w.id };
        }
        if (stage === 'validate' || stage === 'reserve' || stage === 'request') {
          await actionGates(e, w, a);
          if (a.explicit_response_ref) w.completed_stage_refs = unique([...w.completed_stage_refs,
            `choice:${JSON.stringify(a.explicit_response_ref)}`]);
        }
        if (stage === 'validate') finishStage(w, ref, stage, 'reserve');
        else if (stage === 'reserve') {
          if (a.resource_refs.length && !e.draft.story_event[key('effect-commit', w.effect_keys[0])]) {
            const r = await call(a.owner, 'write', { ...envelope, operation: 'reserve', resource_refs: a.resource_refs,
              effect_key: key('reservation', w.effect_keys[0]) });
            requireThat(r.status === 'committed' && r.reservation_refs?.length > 0, 'pending_workflow');
            w.reservation_refs = unique([...w.reservation_refs, ...list.parse(r.reservation_refs)]);
          }
          finishStage(w, ref, stage, 'request');
        } else if (stage === 'request') {
          const effectAudit = e.draft.story_event[key('effect-commit', w.effect_keys[0])];
          let eventRefs;
          if (effectAudit) eventRefs = auditData(effectAudit.payload_ref).owner_event_refs;
          else {
            const r = await call(a.owner, 'write', { ...envelope, operation: 'request_action',
              action_operation: a.operation, reservation_refs: w.reservation_refs,
              terms_ref: a.terms_ref, explicit_response_ref: a.explicit_response_ref });
            requireThat(r.status === 'committed' && r.effect_key === w.effect_keys[0] &&
              r.owner_event_refs?.length > 0, 'pending_workflow');
            eventRefs = list.parse(r.owner_event_refs);
            const id = key('effect-commit', w.effect_keys[0]);
            e.draft.story_event[id] = { id, situation_id: w.situation_id, watcher_ref: w.watcher_ref,
              cause_refs: w.cause_refs, occurred_at: Integer.parse(r.occurred_at),
              processed_at: e.boundary.canonical_time, policy_version: (await manifest(e, w.situation_id)).policy_version,
              idempotency_key: id, payload_ref: auditRef({ owner_event_refs: eventRefs }) };
          }
          w.committed_owner_result_refs = unique([...w.committed_owner_result_refs, ...eventRefs]);
          finishStage(w, ref, stage, 'attach');
        } else if (stage === 'attach') {
          audit(e, 'owner_outcome_attached', w.situation_id, w.watcher_ref, w.cause_refs,
            { workflow_id: w.id, owner_event_refs: w.committed_owner_result_refs });
          if (a.notification_ref) w.pending_delivery_refs = unique([...w.pending_delivery_refs, a.notification_ref]);
          finishStage(w, ref, stage, 'notify');
        } else if (stage === 'notify') {
          for (const notice of [...w.pending_delivery_refs]) {
            const r = await call('system16', 'write', { ...envelope, operation: 'schedule_delivery', ref: notice,
              effect_key: key('notice', w.effect_keys[0], notice) });
            requireThat(r.status === 'committed' && r.task_ref, 'pending_workflow');
            // Scheduling a notice never creates an acquisition or journal update.
            w.pending_delivery_refs = w.pending_delivery_refs.filter(x => x !== notice);
            w.completed_stage_refs.push(Ref.parse(r.task_ref));
          }
          finishStage(w, ref, stage, 'complete');
          settleWatchers(e, w);
          if (e.draft.instance_metadata[w.situation_id].pending_choice_ref === ref)
            e.draft.instance_metadata[w.situation_id].pending_choice_ref = null;
          touch(e, w.situation_id);
        } else throw new GateError();
        // save() can observe this durable stage before the next external call.
        // A host may persist the snapshot; retries keep the same effect keys.
        recount(e.draft); assertState(e.draft); state = new System24State(e.draft.toJSON());
      }
    } catch (error) {
      queue(e, `workflow:${w.id}`);
      return { status: error.reason === 'choice_required' ? 'choice_required' : 'pending', workflow_id: w.id };
    }
  }

  function settleWatchers(e, workflow) {
    for (const watcher of Object.values(e.draft.watcher)) if (watcher.pending_workflow === workflow.id) {
      watcher.pending_workflow = null;
      if (watcher.status === 'retired' || watcher.trigger_policy === 'single_fire' ||
        terminal.has(situation(e, watcher.situation_id).state)) {
        watcher.status = 'retired'; e.draft.watcher_metadata[watcher.id].retirement_reason_ref ??= workflow.id;
      } else watcher.status = 'armed';
    }
  }

  async function cleanupReservations(e, w, a, envelope) {
    if (w.terminal_cleanup_state_ref !== 'release_unused_pending') return;
    const r = await call(a.owner, 'write', { ...envelope, operation: 'release_unused_reservations',
      reservation_refs: w.reservation_refs, effect_key: key('release-unused', w.id) });
    if (r.status === 'committed') w.terminal_cleanup_state_ref = 'unused_released';
    else { queue(e, `workflow:${w.id}`); throw new GateError('pending_workflow'); }
  }

  async function registerDeadline(e) {
    const p = payload({ ...withSituation, deadline: Schemas.deadline }).parse(e.command.payload);
    const m = await manifest(e, p.situation_id); const d = p.deadline;
    requireThat(m.deadline_policy_refs.includes(d.review_policy_ref));
    requireThat(d.starts_at <= d.due_at);
    await clock(e); await committedCauses(e, d.cause_refs);
    const owner = await call(d.owner_ref, 'read', { operation: 'deadline', ref: d.id, version: d.version });
    requireThat(owner.status === 'ok' && owner.committed === true &&
      canonical(owner.deadline) === canonical(d), 'pending_workflow');
    const ref = key('deadline', d.id, d.version);
    requireThat(!e.draft.deadline[ref], 'stale_state');
    // Every version remains in history; due processing asks the owner which is current.
    e.draft.deadline[ref] = d;
    audit(e, 'deadline_registered', p.situation_id, null, d.cause_refs, { deadline_ref: ref });
    touch(e, p.situation_id);
    return { status: 'ok', deadline_ref: ref };
  }

  async function dueDeadlines(e) {
    const results = [];
    for (const [ref, d] of Object.entries(e.draft.deadline)) {
      if (d.due_at > e.boundary.canonical_time) continue;
      const effect = key('deadline-review', d.id, d.version);
      if (e.draft.story_event[effect]) continue;
      const registration = Object.values(e.draft.story_event).find(x => {
        const a = auditData(x.payload_ref); return a.name === 'deadline_registered' && a.deadline_ref === ref;
      });
      if (!registration) continue;
      const current = await call(d.owner_ref, 'read', { operation: 'current_deadline', ref: d.id });
      if (current.status !== 'ok') { queue(e, `deadline:${ref}`); continue; }
      if (current.version !== d.version || current.cancelled === true) { dequeue(e, `deadline:${ref}`); continue; }
      // Request a review only. The coordinator imposes no deadline consequence.
      const r = await call(d.owner_ref, 'write', { operation: 'review_deadline', ref: d.id,
        version: d.version, situation_id: registration.situation_id, watcher_id: null,
        cause_refs: d.cause_refs, expected_revision_refs: e.boundary.revisions,
        canonical_time: e.boundary.canonical_time, authority_ref: e.command.authority_ref,
        correlation_id: e.command.correlation_id, idempotency_key: effect, effect_key: effect });
      if (r.status !== 'committed' || !r.task_ref) { queue(e, `deadline:${ref}`); continue; }
      e.draft.story_event[effect] = { id: effect, situation_id: registration.situation_id,
        watcher_ref: null, cause_refs: d.cause_refs, occurred_at: d.due_at,
        processed_at: e.boundary.canonical_time, policy_version: d.review_policy_ref,
        idempotency_key: effect, payload_ref: auditRef({ task_ref: r.task_ref }) };
      dequeue(e, `deadline:${ref}`); results.push({ deadline_ref: ref, status: 'review_scheduled' });
    }
    return results;
  }

  async function surfaceOffer(e) {
    const p = payload({ ...withSituation, offer_ref: Ref }).parse(e.command.payload);
    const m = await manifest(e, p.situation_id);
    requireThat(m.offer_refs.includes(p.offer_ref));
    await clock(e); await validBindings(e, p.situation_id);
    const r = await call('authoring', 'read', { operation: 'offer', ref: p.offer_ref });
    requireThat(r.status === 'ok' && r.feasible === true, 'pending_workflow');
    const offer = Schemas.story_offer.parse(r.offer); const meta = Schemas.offer_metadata.parse(r.metadata);
    requireThat(offer.status === 'available' && offer.delivered_refs.length === 0 &&
      meta.explicit_response_ref === null && meta.accepted_terms_ref === null &&
      meta.expiry_or_withdrawal_cause_ref === null);
    requireThat(offer.available_until === null || offer.available_until > e.boundary.canonical_time, 'unavailable_binding');
    const existing = e.draft.story_offer[offer.id];
    if (existing) {
      requireThat(existing.terms_ref === offer.terms_ref && existing.recipient_ref === offer.recipient_ref, 'stale_state');
      return { status: 'ok', offer_id: existing.id };
    }
    const presentation = await presentationContext(e, offer.recipient_ref);
    if (!r.urgent && !r.accepted_obligation && !r.physical_hazard && r.unsolicited_major) {
      if (!presentation || presentation.unsolicited_major_offers_surfaced >= e.draft.versioned_policy_defaults.max_new_unsolicited_major_offers_per_game_day) {
        queue(e, `offer:${p.situation_id}:${p.offer_ref}`); return { status: 'deferred' };
      }
    }
    const delivery = await call('system16', 'write', { operation: 'deliver_offer', ref: p.offer_ref,
      situation_id: p.situation_id, watcher_id: null, cause_refs: e.draft.instance_metadata[p.situation_id].creation_cause_refs,
      authority_ref: e.command.authority_ref, expected_revision_refs: e.boundary.revisions,
      canonical_time: e.boundary.canonical_time, correlation_id: e.command.correlation_id,
      idempotency_key: key('offer-delivery', offer.id), effect_key: key('offer-delivery', offer.id),
      issuer_ref: offer.issuer_ref, recipient_ref: offer.recipient_ref, terms_ref: offer.terms_ref,
      channel_ref: offer.channel_ref });
    if (delivery.status !== 'committed' || !delivery.delivered_refs?.length) {
      queue(e, `offer:${p.situation_id}:${p.offer_ref}`); return { status: 'pending' };
    }
    offer.delivered_refs = list.parse(delivery.delivered_refs); offer.status = 'delivered';
    e.draft.story_offer[offer.id] = offer; e.draft.offer_metadata[offer.id] = meta;
    audit(e, 'offer_delivered', p.situation_id, null, [], { offer_id: offer.id });
    if (presentation && r.unsolicited_major && !r.urgent && !r.accepted_obligation && !r.physical_hazard)
      presentation.unsolicited_major_offers_surfaced++;
    dequeue(e, `offer:${p.situation_id}:${p.offer_ref}`); touch(e, p.situation_id);
    return { status: 'ok', offer_id: offer.id };
  }

  async function respondOffer(e) {
    const p = payload({ ...withSituation, offer_id: Ref, response_ref: Ref }).parse(e.command.payload);
    const offer = e.draft.story_offer[p.offer_id]; const meta = e.draft.offer_metadata[p.offer_id];
    requireThat(offer && offer.recipient_ref === e.auth.actor_id, 'missing_access');
    requireThat(offerBelongs(e.draft, offer.id, p.situation_id), 'missing_access');
    if (e.retry_receipt) requireThat(meta.explicit_response_ref === p.response_ref, 'stale_state');
    requireThat(!['accepted', 'expired', 'withdrawn'].includes(offer.status), 'stale_state');
    await clock(e); await validBindings(e, p.situation_id);
    if (offer.available_until !== null && offer.available_until <= e.boundary.canonical_time)
      return { status: 'rejected', reason: 'unavailable_binding' };
    const response = await call('agency', 'read', { operation: 'explicit_response', ref: p.response_ref,
      actor_id: e.auth.actor_id, offer_id: offer.id, terms_ref: offer.terms_ref });
    requireThat(response.status === 'ok' && response.explicit === true && response.actor_id === e.auth.actor_id &&
      response.offer_id === offer.id && response.terms_ref === offer.terms_ref &&
      ['ask', 'decline', 'defer', 'ignore', 'alternative', 'accept'].includes(response.choice), 'missing_access');
    meta.explicit_response_ref = p.response_ref; offer.status = 'response';
    audit(e, 'offer_response', p.situation_id, null, [], { offer_id: offer.id,
      response_ref: p.response_ref, choice: response.choice });
    if (response.choice === 'accept') {
      const r = await call('agency', 'write', { operation: 'commit_offer_terms', ref: p.response_ref,
        situation_id: p.situation_id, watcher_id: null,
        cause_refs: offer.delivered_refs, authority_ref: e.command.authority_ref,
        expected_revision_refs: e.boundary.revisions, canonical_time: e.boundary.canonical_time,
        correlation_id: e.command.correlation_id, idempotency_key: key('accept', offer.id, p.response_ref),
        effect_key: key('accept', offer.id, p.response_ref), offer_id: offer.id, terms_ref: offer.terms_ref });
      if (r.status !== 'committed' || r.terms_ref !== offer.terms_ref || !r.commitment_ref) {
        queue(e, `accept:${offer.id}:${p.response_ref}`); touch(e, p.situation_id);
        return { status: 'pending', offer_id: offer.id };
      }
      meta.accepted_terms_ref = Ref.parse(r.terms_ref); offer.status = 'accepted';
      const s = situation(e, p.situation_id);
      s.owner_commitments = unique([...s.owner_commitments, Ref.parse(r.commitment_ref)]);
      dequeue(e, `accept:${offer.id}:${p.response_ref}`);
    }
    touch(e, p.situation_id);
    return { status: 'ok', offer_id: offer.id, offer_status: offer.status };
  }

  async function refreshOffer(e) {
    const p = payload({ ...withSituation, offer_id: Ref }).parse(e.command.payload);
    const offer = e.draft.story_offer[p.offer_id]; requireThat(offer && offerBelongs(e.draft, offer.id, p.situation_id));
    await clock(e);
    const r = await call('agency', 'read', { operation: 'offer_availability', ref: offer.id,
      canonical_time: e.boundary.canonical_time });
    requireThat(r.status === 'ok' && r.committed === true && ['expired', 'withdrawn'].includes(r.stage) &&
      r.cause_ref && r.offer_id === offer.id, 'pending_workflow');
    requireThat(offer.status !== 'accepted', 'unsupported_method');
    offer.status = r.stage; e.draft.offer_metadata[offer.id].expiry_or_withdrawal_cause_ref = Ref.parse(r.cause_ref);
    touch(e, p.situation_id);
    return { status: 'ok', offer_id: offer.id };
  }

  async function presentationContext(e, actor) {
    const r = await call('ui', 'read', { operation: 'presentation_context', ref: actor });
    if (r.status !== 'ok' || r.actor_id !== actor || !r.scene_ref || !r.preferences_ref) return null;
    const stateRef = key('presentation', actor);
    const p = e.draft.presentation_and_runtime[stateRef] ??= runtime();
    if (p.game_day_ref !== e.boundary.game_day_ref) {
      p.game_day_ref = e.boundary.game_day_ref; p.unsolicited_major_offers_surfaced = 0;
    }
    if (p.ordinary_scene_ref !== r.scene_ref) {
      p.ordinary_scene_ref = Ref.parse(r.scene_ref); p.low_urgency_updates_surfaced = 0;
    }
    p.player_preferences_ref = Ref.parse(r.preferences_ref);
    return p;
  }

  async function acquireJournal(e) {
    const p = payload({ ...withSituation, actor_id: Ref, acquisition_refs: list }).parse(e.command.payload);
    await clock(e);
    const r = await call('knowledge', 'read', { operation: 'known_story', ref: p.situation_id,
      actor_id: p.actor_id, acquisition_refs: p.acquisition_refs, canonical_time: e.boundary.canonical_time });
    requireThat(r.status === 'ok' && r.allowed === true, 'missing_access');
    const journal = Schemas.journal_projection.parse(r.projection);
    requireThat(journal.situation_id === p.situation_id && journal.actor_id === p.actor_id &&
      journal.acquired_source_refs.length > 0 && journal.last_update_at <= e.boundary.canonical_time &&
      p.acquisition_refs.every(x => journal.acquired_source_refs.includes(x)), 'missing_access');
    const old = e.draft.journal_projection[journal.id];
    requireThat(!old || (old.actor_id === journal.actor_id && old.situation_id === journal.situation_id &&
      old.last_update_at <= journal.last_update_at), 'stale_state');
    e.draft.journal_projection[journal.id] = journal;
    if (!old || canonical(old) !== canonical(journal)) audit(e, 'journal_acquisition', p.situation_id, null,
      p.acquisition_refs, { projection: journal }, journal.last_update_at);
    // Pacing affects notification only, never acquired truth or the queried view.
    const pacing = await presentationContext(e, p.actor_id);
    const urgent = r.urgent === true || r.accepted_obligation === true || r.physical_hazard === true;
    const already = old && canonical(old) === canonical(journal);
    if (already && !(e.draft.presentation_and_runtime.partition?.deferred_review_refs ?? []).includes(`journal:${journal.id}`))
      return { status: 'ok', surfaced: false };
    if (!urgent && (!pacing || pacing.low_urgency_updates_surfaced >= e.draft.versioned_policy_defaults.max_low_urgency_surfaced_updates_per_ordinary_scene)) {
      queue(e, `journal:${journal.id}`); return { status: 'ok', surfaced: false };
    }
    const notify = await call('ui', 'write', { operation: 'known_update', ref: journal.id,
      actor_id: p.actor_id, projection: journal, idempotency_key: key('journal-update', journal),
      effect_key: key('journal-update', journal), situation_id: p.situation_id, watcher_id: null,
      cause_refs: p.acquisition_refs, authority_ref: e.command.authority_ref,
      expected_revision_refs: e.boundary.revisions, canonical_time: e.boundary.canonical_time,
      correlation_id: e.command.correlation_id });
    if (notify.status !== 'committed') { queue(e, `journal:${journal.id}`); return { status: 'ok', surfaced: false }; }
    if (!urgent && pacing) pacing.low_urgency_updates_surfaced++;
    dequeue(e, `journal:${journal.id}`);
    return { status: 'ok', surfaced: true };
  }

  async function knownStory(e) {
    const p = payload({ ...withSituation, actor_id: Ref }).parse(e.command.payload);
    requireThat(e.auth.actor_id === p.actor_id, 'missing_access');
    const permission = await call('knowledge', 'read', { operation: 'story_access', ref: p.situation_id,
      actor_id: p.actor_id });
    requireThat(permission.status === 'ok' && permission.allowed === true &&
      permission.actor_id === p.actor_id, 'missing_access');
    const records = Object.values(e.draft.journal_projection).filter(j => j.actor_id === p.actor_id && j.situation_id === p.situation_id);
    const sources = new Set(permission.acquired_source_refs ?? []);
    const journals = records.filter(j => j.acquired_source_refs.every(x => sources.has(x)));
    const offers = Object.values(e.draft.story_offer).filter(o => o.recipient_ref === p.actor_id &&
      offerBelongs(e.draft, o.id, p.situation_id) && o.delivered_refs.some(ref => sources.has(ref)))
      .map(o => ({ id: o.id, issuer_ref: o.issuer_ref, terms_ref: o.terms_ref, channel_ref: o.channel_ref,
        delivered_refs: o.delivered_refs.filter(x => sources.has(x)) }));
    // Never expose internal status/expiry changes until acquired by the actor.
    if (e.command.type === 'GetAvailableOffers') {
      const r = await call('knowledge', 'read', { operation: 'known_available_offers', ref: p.situation_id,
        actor_id: p.actor_id, offer_refs: offers.map(o => o.id) });
      return { status: 'ok', offers: r.status === 'ok' ? offers.filter(o => r.offer_refs?.includes(o.id)) : [] };
    }
    if (e.command.type === 'GetKnownQuestions') return { status: 'ok', questions: unique(journals.flatMap(j => j.known_questions)) };
    if (e.command.type === 'GetAcceptedCommitments') {
      const r = await call('knowledge', 'read', { operation: 'known_commitments', ref: p.situation_id,
        actor_id: p.actor_id });
      const commitments = r.status === 'ok' && r.actor_id === p.actor_id && Array.isArray(r.commitments)
        ? r.commitments.map(x => payload({ commitment_ref: Ref, terms_ref: Ref, acquired_source_refs: list }).parse(x))
          .filter(x => x.acquired_source_refs.length && x.acquired_source_refs.every(ref => sources.has(ref))) : [];
      return { status: 'ok', commitments };
    }
    if (e.command.type === 'GetKnownSituationHistory') {
      const history = Object.values(e.draft.story_event).filter(x => x.situation_id === p.situation_id)
        .map(x => auditData(x.payload_ref)).filter(x => x.name === 'journal_acquisition')
        .map(x => x.projection).filter(x => x.actor_id === p.actor_id &&
          x.acquired_source_refs.every(ref => sources.has(ref)))
        .sort((a, b) => a.last_update_at - b.last_update_at);
      return { status: 'ok', history };
    }
    const available = await call('knowledge', 'read', { operation: 'known_available_offers', ref: p.situation_id,
      actor_id: p.actor_id, offer_refs: offers.map(o => o.id) });
    return { status: 'ok', journals, offers,
      hidden: e.draft.presentation_and_runtime[key('journal-display', p.actor_id, p.situation_id)]?.journal_hidden_by_actor ?? false,
      choices: offers.filter(o => available.status === 'ok' && available.offer_refs?.includes(o.id))
        .flatMap(o => ['ask', 'decline', 'defer', 'ignore', 'alternative', 'accept']
        .map(response => ({ type: 'offer_response', offer_id: o.id, response }))) };
  }

  async function hideJournal(e) {
    const p = payload({ ...withSituation, actor_id: Ref, hidden: z.boolean() }).parse(e.command.payload);
    requireThat(p.actor_id === e.auth.actor_id, 'missing_access');
    const ref = key('journal-display', p.actor_id, p.situation_id);
    (e.draft.presentation_and_runtime[ref] ??= runtime()).journal_hidden_by_actor = p.hidden;
    return { status: 'ok', hidden: p.hidden };
  }

  async function retireWatcher(e) {
    const p = payload({ ...withSituation, watcher_id: Ref, reason_ref: Ref }).parse(e.command.payload);
    const w = e.draft.watcher[p.watcher_id]; requireThat(w?.situation_id === p.situation_id, 'unavailable_binding');
    const r = await call('authoring', 'read', { operation: 'retirement', ref: p.reason_ref,
      watcher_id: w.id, situation_id: p.situation_id });
    requireThat(r.status === 'ok' && r.valid === true, 'pending_workflow');
    w.status = 'retired'; e.draft.watcher_metadata[w.id].retirement_reason_ref = p.reason_ref;
    if (w.pending_workflow) queue(e, `workflow:${w.pending_workflow}`);
    touch(e, p.situation_id); return { status: 'ok' };
  }

  async function rebind(e) {
    const p = payload({ ...withSituation, binding: Schemas.participant_binding,
      cause_refs: list }).parse(e.command.payload);
    const s = situation(e, p.situation_id); await clock(e); await committedCauses(e, p.cause_refs);
    const id = key('binding', s.bindings_ref, p.binding.role_ref);
    const previous = e.draft.participant_binding[id]; requireThat(previous, 'unavailable_binding');
    await validBindings(e, s.id, bindingList(e.draft, s.bindings_ref)
      .map(b => b.role_ref === p.binding.role_ref ? p.binding : b));
    const event = audit(e, 'rebind', s.id, null, p.cause_refs,
      { old_participant: previous.participant_ref, new_participant: p.binding.participant_ref });
    p.binding.rebind_event_refs = unique([...previous.rebind_event_refs, ...p.binding.rebind_event_refs, event]);
    e.draft.participant_binding[id] = p.binding;
    touch(e, s.id); return { status: 'ok', revision: s.revision };
  }

  async function linkLineage(e) {
    const p = payload({ ...withSituation, related_ids: list.min(1), cause_refs: list,
      authorization_ref: Ref }).parse(e.command.payload);
    await committedCauses(e, p.cause_refs);
    const r = await call('authoring', 'read', { operation: 'lineage_change', ref: p.authorization_ref,
      situation_id: p.situation_id, related_ids: p.related_ids });
    requireThat(r.status === 'ok' && r.authorized === true, 'missing_access');
    for (const id of p.related_ids) requireThat(id !== p.situation_id && e.draft.situation[id], 'unavailable_binding');
    for (const id of unique([p.situation_id, ...p.related_ids])) {
      const m = e.draft.instance_metadata[id];
      m.lineage_refs = unique([...m.lineage_refs, ...[p.situation_id, ...p.related_ids].filter(x => x !== id)]);
      touch(e, id);
    }
    audit(e, 'lineage_change', p.situation_id, null, p.cause_refs, { authorization_ref: p.authorization_ref });
    // Shared owner commitments and pending workflows retain their original IDs.
    return { status: 'ok' };
  }

  const handlers = Object.freeze({ PublishTemplate: publishTemplate, InstantiateSituation: instantiate,
    RegisterWatcher: registerWatcher, ProcessBoundary: processBoundary, ReviewOutcome: reviewOutcome,
    ProposeTransition: transition, TransformSituation: transition, BeginWorkflow: beginWorkflow,
    ResumeWorkflow: resumeWorkflow, RegisterDeadline: registerDeadline, SurfaceOffer: surfaceOffer,
    RespondToOffer: respondOffer, RefreshOffer: refreshOffer, AcquireJournal: acquireJournal,
    GetKnownStory: knownStory, GetAvailableOffers: knownStory, GetKnownQuestions: knownStory,
    GetAcceptedCommitments: knownStory, GetKnownSituationHistory: knownStory,
    HideJournal: hideJournal, RetireWatcher: retireWatcher, RebindParticipant: rebind,
    LinkSituationLineage: linkLineage });
  return api;
}

function parseManifest(raw, limits) {
  // Preflight recursive fields before Zod can traverse hostile trees.
  requireThat(raw && typeof raw === 'object');
  const asts = [raw.activation_condition,
    ...(raw.transition_rules ?? []).map(x => x.condition),
    ...Object.values(raw.outcomes ?? {}).map(x => x.condition),
    ...Object.values(raw.watcher_rules ?? {}).map(x => x.condition)];
  for (const ast of asts) validateCondition(ast, raw, limits);
  const m = Manifest.parse(raw); validateTables(m.truth_tables);
  for (const r of Object.values(m.watcher_rules)) {
    if (r.trigger_policy === 'cadenced_level') requireThat(r.cadence !== null);
    if (r.trigger_policy === 'due_time') requireThat(r.deadline_ref !== null);
    if (r.output_category === 'review_outcome') requireThat(r.outcome_scope && m.outcomes[r.outcome_scope]);
    if (r.action_ref) requireThat(m.allowed_action_refs.includes(r.action_ref));
  }
  return m;
}
function finishStage(w, ref, current, next) {
  w.completed_stage_refs = unique([...w.completed_stage_refs, stageRef(ref, current)]);
  w.pending_stage_ref = stageRef(ref, next);
}
function bindingList(state, bindingsRef) {
  return Object.entries(state.participant_binding).filter(([id, b]) =>
    id === key('binding', bindingsRef, b.role_ref)).map(([, b]) => b);
}
function hasCapacity(state, sid) {
  const all = Object.values(state.watcher).filter(live);
  return all.length < state.versioned_policy_defaults.max_active_watchers_per_loaded_partition &&
    all.filter(w => w.situation_id === sid).length < state.versioned_policy_defaults.max_active_watchers_per_situation;
}
function recount(state) {
  const all = Object.values(state.watcher).filter(live);
  (state.presentation_and_runtime.partition ??= runtime()).active_watchers_per_partition = all.length;
  for (const id of Object.keys(state.situation))
    (state.presentation_and_runtime[`situation:${id}`] ??= runtime()).active_watchers_per_situation = all.filter(w => w.situation_id === id).length;
}
function offerBelongs(state, offer, sid) {
  return Object.values(state.story_event).some(e => {
    const a = auditData(e.payload_ref);
    return e.situation_id === sid && a.name === 'offer_delivered' && a.offer_id === offer;
  });
}
function assertState(state) {
  StateSchema.parse(state.toJSON());
  for (const [id, s] of Object.entries(state.situation)) {
    requireThat(id === s.id && state.situation_template[s.template_version] && state.instance_metadata[id]);
    requireThat(s.pressure_refs.every(ref => state.pressure_and_outcome_definitions[ref]));
  }
  for (const [id, w] of Object.entries(state.watcher)) {
    requireThat(id === w.id && state.situation[w.situation_id] && state.watcher_metadata[id]);
    requireThat(!w.pending_workflow || state.durable_workflow[w.pending_workflow]);
  }
  for (const w of Object.values(state.durable_workflow)) {
    requireThat(state.situation[w.situation_id]);
    const [ref, stage] = JSON.parse(w.pending_stage_ref);
    Ref.parse(ref); requireThat(['validate', 'reserve', 'request', 'attach', 'notify', 'complete', 'cancelled'].includes(stage));
    if (['attach', 'notify', 'complete'].includes(stage)) requireThat(w.committed_owner_result_refs.length > 0);
  }
  for (const [id, o] of Object.entries(state.story_offer)) requireThat(id === o.id && state.offer_metadata[id]);
  for (const a of Object.values(state.outcome_assessment)) requireThat(state.situation[a.situation_id]);
  const events = Object.values(state.story_event);
  requireThat(new Set(events.map(e => e.idempotency_key)).size === events.length);
  for (const e of events) { requireThat(e.id && e.occurred_at <= e.processed_at); auditData(e.payload_ref); }
  for (const [name, value] of Object.entries(state.versioned_policy_defaults))
    requireThat(value <= DEFAULT_LIMITS[name]); // This encoding profile ships baseline ceilings.
}
