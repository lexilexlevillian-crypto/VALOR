# SYSTEM 14 — Lore, Semantic Retrieval, Knowledge, Beliefs, and Memories

Status: implemented and tested.

## Epistemic model

Authoritative truth, observer knowledge, personal belief, and episodic memory are separate persisted layers:

| Layer | Meaning | Canonical effect |
| --- | --- | --- |
| Proposition (`world_facts`) | Server/Creator assertion about a subject, predicate, object/value, and qualifiers | May be verified, asserted, disputed, false, or superseded; never becomes observer knowledge automatically |
| Knowledge (`character_knowledge`) | One observer learned a specific fact from a named source | Grants that observer access while the knowledge and underlying fact are valid and audience-permitted |
| Belief (`character_beliefs`) | One observer's possibly false proposition | Remains belief through gossip; correction links it to a fact and marks it disproven rather than rewriting history |
| Memory (`character_memories`) | One observer's event-linked recollection and interpretation | Recall depends on privacy, current salience, expiry, and authored entity/tag/place/time conditions |

A proposition persists subject, predicate, optional object, JSON value and qualifiers, source, truth status, audience, confidence, observed/learned time, validity interval, source event(s), evidence, tags, creation time, and retirement. Beliefs preserve the same structured proposition shape independently of truth. Knowledge records its observer, fact, source, confidence, observation/learning times, expiry, and evidence.

Gossip copies a source observer's belief to a target observer, records `gossip-from:<source>:<event>` provenance, limits the new audience to the target, and deterministically attenuates confidence. It does not create a fact or knowledge row. Correction creates/retains knowledge of an existing fact, links `correctedBy`, and changes belief status to `disproven`; it never edits the proposition into canon. Retiring truth marks the old fact `superseded` and creates a new versioned proposition.

Memories persist observer, source event and additional event references, recollection, personal interpretation, emotional salience, decay per day, private/shared policy, recall conditions, last refresh time, refresh count, expiry, and tags. Effective salience is calculated from the last refresh anchor and never falls below zero. Refresh preserves the memory ID and event provenance while resetting its decay anchor and incrementing the refresh count.

## Lore and Story Cards

Lore and Story Cards use the typed entity contract and immutable `lore_versions` snapshots. Every material create/edit/archive records the entity revision, kind, name, visibility, full validated data, archive state, and timestamp. Stored lore supports schema version, source and source references, validity dates, tags, stable links plus typed link details, priority, optional embedding, subject, and the existing stable-ID custom sections/fields. Version rows reject direct updates and reject direct deletes while their parent entity exists; parent lifecycle cleanup remains controlled by database foreign keys.

Story Card scope can attach to the campaign or exact place, people, relationship, domain event, and faction IDs. Activation declares a mode and any combination of time window, legacy place/person selector, attachment selectors, keywords, and required query tags. Deactivation declares `never`, `any`, or `all`, plus an exact time, event IDs, keywords/tags, and an authored reason. Retrieval provenance always reports the evaluated activation/deactivation contract and one of: `active`, `not-yet-valid`, `expired`, `scope-mismatch`, `activation-conditions-unmet`, or `deactivated`.

## Retrieval contract

`GET /game/timelines/:id/retrieval` accepts `characterId`, `query`, and a JSON-encoded `filters` object. Filters support exact entity, tag, validity interval, place, person, relationship, event, evidence, faction, and source-kind constraints. `GET /game/timelines/:id/developer/retrieval` uses the same contract but requires Creator/admin write authority and adds rejected-source decisions.

Retrieval proceeds in this order:

1. Build the observer view and remove archived, Creator-only, owner-inaccessible, secret, expired, and audience-denied material.
2. Apply exact structured filters and Story Card scope/lifecycle checks.
3. Rank the surviving bounded set using lexical matches, structured-match weight, authored priority, and cosine similarity from supplied compatible vectors or the deterministic local 96-dimension embedding.
4. Sort by descending score and then stable source ID, enforcing deterministic ties and the result limit.
5. Retrieve that observer's still-valid beliefs and recall-eligible memories under the same exact filters.

Permission filtering therefore happens before semantic scoring and before anything can enter model context. Timeline state supplies the active clock and the timeline's inherited/current event IDs, so validity and event activation are branch-aware. Canon retrieval remains restricted to published, campaign-visible, non-archived records valid at the active timeline time.

Each returned lore source carries kind, entity revision, visibility, source references, typed links, validity interval, lifecycle decision, and lexical/semantic/structured match components. Developer Mode additionally reports source IDs, kinds, and rejection reasons without copying rejected secret text into the result. The System 12 context manifest consumes this same retrieval/lifecycle policy and records included, omitted, and rejected sources.

## Guardrails

- Truth does not imply universal knowledge; only explicit observer knowledge exposes a fact.
- An unwitnessed event does not teach an absent NPC.
- Belief/gossip never authors canon, and false rumors remain attributable beliefs.
- Audience and entity visibility checks precede relevance scoring.
- Corrected beliefs remain in history but are excluded from active context as stale/disproven.
- Recall conditions and expiry gate memories; decay affects relevance without deleting history.
- Story Cards guide context only when their typed scope and lifecycle conditions pass; they retain the System 12 agency, consent, truth, and secrecy guardrails.
- Imported lore, Story Card text, memory text, and belief text remain untrusted content, not executable instructions or tool authority.
- Lore versions are append-only audit records; entity IDs and per-entity revisions provide stable provenance.

## Verification

`tests/system14-epistemics.test.ts` covers:

- an absent NPC not knowing an unwitnessed proposition;
- structured proposition fields and evidence provenance surviving persistence;
- a false rumor remaining a belief after gossip, with deterministic confidence loss and no manufactured fact;
- explicit correction linking belief to fact without rewriting belief history;
- memory decay to zero, recall-condition filtering, refresh, and refresh-count persistence;
- exact place/tag/evidence filtering before ranking;
- stable ID tie-breaking for equal scores;
- player exclusion of Creator-only lore, including absence of secret text;
- Developer Mode permission/scope/deactivation rejection reasons;
- Story Card activation/deactivation provenance;
- append-only lore version creation and immutable-version enforcement.

The existing crime/report test independently verifies that police do not learn an unwitnessed crime until a player reports the fact. System 12 tests continue to verify secret filtering, stale-belief rejection, bounded context, and Developer Mode source inspection. Migration, local SQLite, libSQL/Turso adapter, branch/save/import, turn-pipeline, and full application suites are run as regressions.
