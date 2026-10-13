/** Closed black boxes. All reads and writes return dummy JSON, never execute
 * another system's logic, never mutate a fixture, and never claim a real effect.
 * Tests can supply immutable response fixtures per endpoint and request.
 */
import { Owners, json, canonical } from './contracts.mjs';

export function requestCharacterAgency() { return { status: 'pending', owner: 'agency' }; }
export function requestSystem10() { return { status: 'pending', owner: 'system10' }; }
export function requestSystem11() { return { status: 'pending', owner: 'system11' }; }
export function requestSystem12() { return { status: 'pending', owner: 'system12' }; }
export function requestSystem13() { return { status: 'pending', owner: 'system13' }; }
export function requestSystem14() { return { status: 'pending', owner: 'system14' }; }
export function requestSystem15() { return { status: 'pending', owner: 'system15' }; }
export function requestSystem16() { return { status: 'pending', owner: 'system16' }; }
export function requestSystem17() { return { status: 'pending', owner: 'system17' }; }
export function requestSystem18() { return { status: 'pending', owner: 'system18' }; }
export function requestSystem19() { return { status: 'pending', owner: 'system19' }; }
export function requestSystem20() { return { status: 'pending', owner: 'system20' }; }
export function requestSystem21() { return { status: 'pending', owner: 'system21' }; }
export function requestSystem22() { return { status: 'pending', owner: 'system22' }; }
export function requestSystem23() { return { status: 'pending', owner: 'system23' }; }
export function requestRelationships() { return { status: 'pending', owner: 'relationships' }; }
export function requestConsent() { return { status: 'pending', owner: 'consent' }; }
export function requestKnowledge() { return { status: 'pending', owner: 'knowledge' }; }
export function requestAuthoring() { return { status: 'pending', owner: 'authoring' }; }
export function requestUI() { return { status: 'pending', owner: 'ui' }; }

const defaults = [requestCharacterAgency, requestSystem10, requestSystem11, requestSystem12,
  requestSystem13, requestSystem14, requestSystem15, requestSystem16, requestSystem17,
  requestSystem18, requestSystem19, requestSystem20, requestSystem21, requestSystem22,
  requestSystem23, requestRelationships, requestConsent, requestKnowledge,
  requestAuthoring, requestUI];

/** Fixture routing only; no external decisions or state machines are simulated.
 * fixture keys: full canonical request, then "operation:ref", then operation.
 * Missing fixtures fail closed as pending, including outbound effects.
 */
export function createMockDependencies(fixtures = {}) {
  const fixed = json(fixtures);
  return Object.freeze(Object.fromEntries(Owners.map((owner, i) => [owner, Object.freeze({
    read: async request => reply(owner, 'read', request, defaults[i]),
    write: async request => reply(owner, 'write', request, defaults[i])
  })])));
  function reply(owner, direction, request, fallback) {
    const table = fixed[owner]?.[direction] ?? {};
    const result = table[canonical(request)] ?? table[`${request.operation}:${request.ref ?? ''}`]
      ?? table[request.operation];
    return json(result ?? fallback());
  }
}
