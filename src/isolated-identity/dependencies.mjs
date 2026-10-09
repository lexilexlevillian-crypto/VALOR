/**
 * Stateless dummy JSON boundaries. These functions do not implement or simulate
 * any external system. Tests may replace a function with a fixed failure fixture.
 * Trusted adapter injection is application configuration, never request JSON.
 */
import { clone, hash, OWNERS, stableId } from './contracts.mjs';

export function readPlayerAuthority() {
  return { principal_id: 'mock-player', world_id: 'mock-world', branch_id: 'mock-branch', role: 'player', authorized: true };
}
export function readWorldConfiguration() {
  return { available: true, revision: 'mock-world-v1', simulation_time: '2012-06-15T12:00:00Z', timezone: 'UTC', grant_policy: 'mock-grant-policy-v1', compatible: true, budgets_valid: true, placement_valid: true, ancestry_edges: [], field_definitions: [], required_fields: [], generation_templates: { preferred_name: ['Alex', 'Sam', 'Robin'], hair: ['brown', 'black', 'blond'] } };
}
export function readSystem3Knowledge() { return { available: true, revision: 'mock-knowledge-v1', known_fact_ids: [], known_claim_refs: [], known_event_refs: [], visible_fields: [] }; }
export function readSystem4Memory() { return { available: true, memory_refs: [], revision: 'mock-memory-v1' }; }
export function readSystem5Personality() { return { available: true, compatible: true, revision: 'mock-personality-v1' }; }
export function readSystem6Schedules() { return { available: true, compatible: true, participation_refs: [], revision: 'mock-schedules-v1' }; }
export function readSystem7Relationships() { return { available: true, compatible: true, revision: 'mock-relationships-v1' }; }
export function readSystem8Romance() { return { available: true, compatible: true, revision: 'mock-romance-v1' }; }
export function readSystem10Capabilities() {
  return { available: true, revision: 'mock-capability-v1', preset: { reference: 'grounded-pc-v1', attributes: { count: 7, initial_value: 4, max_one_point_reallocations: 4, minimum: 2, maximum: 6 }, skills: { starting_ranks: 24, maximum_rank: 5, maximum_rank_5_skills: 2, evidence_required_above_rank: 3 } } };
}
export function readJobsAndInstitutions() { return { available: true, compatible: true, revision: 'mock-jobs-institutions-v1' }; }
export function readLegalLicensing() { return { available: true, compatible: true, revision: 'mock-legal-v1' }; }
export function readEconomy() { return { available: true, budgets_valid: true, revision: 'mock-economy-v1' }; }
export function readResources() { return { available: true, compatible: true, revision: 'mock-resources-v1' }; }
export function readHealthAppearance() { return { available: true, appearance_effects: [], revision: 'mock-health-v1' }; }
export function readPerception() { return { available: true, visible_field_keys: ['preferred_name', 'hair', 'eyes'], location_compatible: true, revision: 'mock-perception-v1' }; }
export function readAudience() { return { viewer: 'mock-player', channel: 'author', audience_entitlement: 'author', selected_export_audience: 'author', authorized: true }; }
export function resolvePerson() { return { available: true, exists: true, compatible: true, age_constraint: { min: 18, max: 90 } }; }
export function validateOwnerRequest() { return { available: true, accepted: true, validated: true, reservation_required: true, revision: 'mock-owner-v1' }; }
export function reserveOwnerRequest(request) { return { available: true, valid: true, reservation_ref: stableId('mock-reservation', request.owner_domain, request.idempotency_key), expected_owner_revision: request.expected_owner_revision }; }
export function checkReservation() { return { available: true, valid: true }; }
export function releaseReservation() { return { available: true, released: true }; }
export function submitOwnerRequest(request) {
  return { owner_domain: request.owner_domain, command_hash: hash(request), status: 'accepted', canonical_event_refs: [stableId('mock-owner-event', request.owner_domain, request.idempotency_key)], resultant_revision: 'mock-owner-result-v1' };
}
export function lookupOwnerRequest() { return { available: true, found: false }; }
export function authenticateOwnerReceipt() { return { authenticated: true, revision_valid: true }; }
export function compensateOwnerRequest() { return { available: true, compensated: true, current_revision_valid: true }; }
export function fetchOwnerEvent() { return { available: true, authenticated: false, event: null }; }
export function evaluateHookPredicates() { return { available: true, satisfied: false, evaluated_predicates: [], knowledge_valid: false, opportunity_valid: false }; }
export function validateAdapter() { return { available: true, accepted: false, requested_command: null, reason: 'No mock adapter registered' }; }
export function persistIdentitySnapshot() { return { available: true, saved: true }; }
export function loadIdentitySnapshot() { return { available: true, found: false, snapshot: null }; }
export function publishIdentityEvent() { return { available: true, delivered: true }; }
export function publishOpening() { return { available: true, delivered: true }; }
export function requestDependencyRepair() { return { available: true, accepted: true, repair_ref: 'mock-repair-001' }; }
export function readAiProposals() { return { available: true, proposals: [], model: 'mock-ai-disabled', version: '1' }; }
export function validateConfigurationChange() { return { available: true, accepted: true, storage_performance_tests_passed: true }; }
export function mapLegacyReceipt() { return { available: true, mapped: false, request: null }; }

export function createMockDependencies(overrides = {}) {
  const result = {
    readPlayerAuthority, readWorldConfiguration, readSystem3Knowledge, readSystem4Memory,
    readSystem5Personality, readSystem6Schedules, readSystem7Relationships, readSystem8Romance,
    readSystem10Capabilities, readJobsAndInstitutions, readLegalLicensing, readEconomy,
    readResources, readHealthAppearance, readPerception, readAudience, resolvePerson,
    validateOwnerRequest, reserveOwnerRequest, checkReservation, releaseReservation,
    submitOwnerRequest, lookupOwnerRequest, authenticateOwnerReceipt, compensateOwnerRequest,
    fetchOwnerEvent, evaluateHookPredicates, validateAdapter, persistIdentitySnapshot,
    loadIdentitySnapshot, publishIdentityEvent, publishOpening, requestDependencyRepair,
    readAiProposals, validateConfigurationChange, mapLegacyReceipt,
  };
  for (const [name, fn] of Object.entries(overrides)) {
    if (!(name in result) || typeof fn !== 'function') throw new TypeError(`Unknown dependency: ${name}`);
    result[name] = fn;
  }
  return Object.freeze(result);
}

/** Each numbered-system output crosses this dummy owner contract. */
export const requestSystem3Knowledge = request => submitOwnerRequest({ ...clone(request), owner_domain: 'system3' });
export const requestSystem4Memory = request => submitOwnerRequest({ ...clone(request), owner_domain: 'system4' });
export const requestSystem5Personality = request => submitOwnerRequest({ ...clone(request), owner_domain: 'system5' });
export const requestSystem6Schedules = request => submitOwnerRequest({ ...clone(request), owner_domain: 'system6' });
export const requestSystem7Relationships = request => submitOwnerRequest({ ...clone(request), owner_domain: 'system7' });
export const requestSystem8Romance = request => submitOwnerRequest({ ...clone(request), owner_domain: 'system8' });
export const requestSystem10Capabilities = request => submitOwnerRequest({ ...clone(request), owner_domain: 'system10' });
export const EXTERNAL_OWNER_DOMAINS = OWNERS;
