/** Stateless dummy JSON contracts only. No foreign system, database, model, UI,
 * network, filesystem, or transport is implemented or contacted here.
 * All acknowledgments explicitly identify mock execution. Fault tests may replace
 * a stub with another synchronous stub. Real adapters are intentionally disallowed.
 */
export const requestOwnerContract = _request => ({ mock: true, supported: true, adapter_version: 'dummy-v1' });
export const requestCharacterRelationshipKnowledge = _request => ({ mock: true, payload: { owner_record_ref: 'dummy-character-record' } });
export const requestResolutionGeneration = _request => ({ mock: true, payload: { resolved_result_ref: 'dummy-resolved-result' } });
export const requestSystem11 = _request => ({ mock: true, approved: true, payload: { timing_contract_ref: 'dummy-timing-contract' } });
export const requestOtherDomains = _request => ({ mock: true, payload: { owner_record_ref: 'dummy-domain-record' } });
export const validateOwnerState = _request => ({ mock: true, valid: true, required_refs: [] });
export const approveOwnerMutation = _request => ({ mock: true, approved: true });
export const validateMigration = _request => ({ mock: true, valid: true, equivalent: true, owner_approved: true });
export const validateNamespace = _request => ({ mock: true, valid: true, strategy: 'campaign_scoped_ids' });
export const requestSystem24Validation = _request => ({ mock: true, valid: true, declarative_only: true });
export const restoreOwnerState = _request => ({ mock: true, accepted: true });
export const deliverOwnerTask = _request => ({ mock: true, acknowledged: true, effect_ref: 'dummy-effect-reference' });
export const requestKnownView = _request => ({ mock: true, known_facts: [], feasible_choices: [], known_history: [] });
export const requestAI = _request => ({ mock: true, available: false, candidate: null });
export const authorizeUI = _request => ({ mock: true, authorized: true });
export const publishUI = _request => ({ mock: true, accepted: true });
export const commitStorage = _request => ({
  mock: true, acknowledged: true, simulated_durable_commit: true, durable: false
});
export const requestStorageSnapshot = _request => ({ mock: true, consistent_view: true, available: true });
export const requestStorageRecovery = _request => ({ mock: true, valid: true, available: true });
export const requestStorageCapacity = _request => ({ mock: true, available: true, bytes_available: null });
export const requestSync = _request => ({ mock: true, acknowledged: false, remote_revision: null, conflict: false });
export const requestBackup = _request => ({ mock: true, completed: false, validated: false, destination: null });

export const MOCK_DEPENDENCIES = Object.freeze({
  requestOwnerContract, requestCharacterRelationshipKnowledge, requestResolutionGeneration,
  requestSystem11, requestOtherDomains, validateOwnerState, approveOwnerMutation,
  validateMigration, validateNamespace, requestSystem24Validation, restoreOwnerState,
  deliverOwnerTask, requestKnownView, requestAI, authorizeUI, publishUI, commitStorage,
  requestStorageSnapshot, requestStorageRecovery, requestStorageCapacity, requestSync, requestBackup
});
