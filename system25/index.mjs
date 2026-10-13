/** Public entry point.
 *
 * Usage:
 *   import { PersistenceSystem25, makeArtifact } from './system25/index.mjs';
 *   const engine = new PersistenceSystem25();
 *   const result = engine.stateMachine({ command, context, args, now });
 *
 * Each mutation requires campaign/timeline IDs, authority {role, session_id,
 * actor_id}, operation_id, idempotency_key, expected_head_revision,
 * expected_entity_revisions, and session_fence. Creation starts at revision/fence
 * zero; use the returned revision/fence for subsequent writes. Inspection never
 * switches the writer. Historical continuation uses ResumeCheckpointAsBranch.
 *
 * CreateCampaign.args supplies content_policy.required_state_families, a complete
 * opaque owner frame, and its artifact envelopes. FRAME_FIELDS and FIELDS declare
 * the complete schema. makeArtifact creates a content-checked inline reference;
 * canonical owner data is never inferred from narration or optional assets.
 *
 * CommitBatch.args supplies {frame, artifacts?, event?}. The frame is a complete
 * owner-approved resolved representation, not a request to run owner logic.
 * RequestCheckpoint.args supplies {desired_cut?, save_kind?, label?, publish?}.
 * publish:false stages a fixed cut; PublishCheckpoint.args is {checkpoint_id}.
 * Autosave.args supplies {trigger, stable_choice_boundary?, active_play_seconds?}.
 * The host delivers real-time ticks; this module does not run a simulation clock.
 *
 * Full exports require acknowledge_hidden_state:true. JSON packages are bounded
 * and self-contained; archives, paths, remote URL references and executable code
 * are never interpreted. ValidateImport returns validated_operation; activation
 * creates a separately scoped family and preserves the source. Migration accepts
 * an externally supplied equivalent migrated_frame and owner validation only.
 *
 * Optional portrait/cache bytes may use content_ref:'unavailable:declared_fallback'
 * only when required_kind is 'optional_visual' or 'derived_cache'. Required
 * material data and owner contracts cannot use that fallback.
 *
 * DeliverTask supports retry_policy.max_attempts and
 * retry_policy.backoff_real_milliseconds when explicitly configured. Unspecified
 * values introduce no invented limit or backoff. Retry clocks are real metadata.
 *
 * All dependency functions are dummy JSON stubs; even storage is mocked. Every
 * response reports mock:true and durable:false. The module makes no disk, network,
 * AI or foreign-domain calls. SerializeState is an explicitly privileged query for
 * passing state to another isolated instance; it is not a durable save operation.
 *
 * Executable examples and failure fixtures: system25/system25.test.mjs.
 * Run: node --test system25/system25.test.mjs
 * Types: system25/index.d.mts
 */
export { PersistenceSystem25 } from './engine.mjs';
export { PersistenceState, ContractError, makeArtifact, FIELDS, FRAME_FIELDS, BASELINE, hash, canonical } from './schema.mjs';
export * from './dependencies.mjs';
