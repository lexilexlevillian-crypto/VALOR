/** Fixed JSON stubs only. These functions do not implement any external system. */
import { clone, json, requireRule } from "./schema.mjs";
const pending = (owner) => ({
  status: "pending",
  canonical_event_refs: [],
  validated_payload: { owner },
});
export const requestSystem1 = () => pending("system1");
export const requestSystem2 = () => pending("system2");
export const requestSystem3 = () => pending("system3");
export const requestSystem4 = () => pending("system4");
export const requestSystem5 = () => pending("system5");
export const requestSystem6 = () => pending("system6");
export const requestSystem7 = () => pending("system7");
export const requestSystem8 = () => pending("system8");
export const requestSystem9 = () => pending("system9");
export const requestSystem10 = () => pending("system10");
export const requestSystem11 = () => pending("system11");
export const requestSystem12 = () => pending("system12");
export const requestEconomy = () => pending("economy");
export const requestInventorySecurity = () => pending("inventory_security");
export const requestHealth = () => pending("health");
export const requestLegalInstitutions = () => pending("legal_institutions");
export const requestDemandArtifacts = () => pending("demand_artifacts");
export const OWNER_STUBS = Object.freeze({
  system1: requestSystem1,
  system2: requestSystem2,
  system3: requestSystem3,
  system4: requestSystem4,
  system5: requestSystem5,
  system6: requestSystem6,
  system7: requestSystem7,
  system8: requestSystem8,
  system9: requestSystem9,
  system10: requestSystem10,
  system11: requestSystem11,
  system12: requestSystem12,
  economy: requestEconomy,
  inventory_security: requestInventorySecurity,
  health: requestHealth,
  legal_institutions: requestLegalInstitutions,
  demand_artifacts: requestDemandArtifacts,
});

/**
 * Host-supplied immutable test fixtures, never client-command data.
 * snapshots[owner] is a fixed JSON object with proofs keyed by source reference.
 * replies[idempotency_key] is one fixed accepted/rejected/pending owner response.
 * Missing fixtures fail closed. Receipt lookup reads the same fixture; it performs no effect.
 */
export class FixedOwnerStubs {
  #snapshots;
  #replies;
  constructor({ snapshots = {}, replies = {} } = {}) {
    json(snapshots);
    json(replies);
    this.#snapshots = clone(snapshots);
    this.#replies = clone(replies);
  }
  read(owner) {
    requireRule(Object.hasOwn(OWNER_STUBS, owner), "UNKNOWN_OWNER");
    return clone(this.#snapshots[owner] ?? OWNER_STUBS[owner]());
  }
  request(owner, request) {
    requireRule(Object.hasOwn(OWNER_STUBS, owner), "UNKNOWN_OWNER");
    return clone(
      this.#replies[request.idempotency_key] ?? OWNER_STUBS[owner](),
    );
  }
  lookup(owner, request) {
    return this.request(owner, request);
  }
}
